/**
 * Workflow activations as the kernel protocol (`orcher.kernel.v1`) carries them.
 *
 * The kernel hands a workflow activation over as a `RunActivation`: the run's
 * history already resolved into the outcomes its code observes. `loadActivation`
 * loads those into a fresh `WorkflowContext`; the worker runs the workflow's
 * code in it, and `answerActivation` turns what the code did into a
 * `RunActivationResult`: every durable call the code made, in issue order,
 * those answered from history marked satisfied, with the queries and updates
 * answered.
 *
 * Step ids are the ones this SDK has always made (`TS_V0`): a task's
 * `${name}_${seq}`, a timer's `timer_${seq}`, a child's workflow id, and so
 * on. They travel in `Command.stepId`, or in `StartChild.workflowId` for a
 * child.
 *
 * @module @orcher/sdk/worker/activation
 * @internal
 */

import { TASK_FAILED_SENTINEL_KEY, type TaskFailureCode } from '../errors';
import { toPayload } from '../core/bridge/payload';
import { WorkflowCommandType, WorkflowContext, type ReachedStep } from '../workflow/context';
import { DEFAULT_MAX_ATTEMPTS, ParentClosePolicy } from '../workflow/types';
import type { Duration } from '../core/generated/google/protobuf/duration';
import type { Timestamp } from '../core/generated/google/protobuf/timestamp';
import {
  CompleteRun,
  End,
  FailureCode,
  OrphanPolicy,
  RunTask,
  StartChild,
  StartTimer,
  type Command,
  type Failure,
  type Payload,
  type QueryAnswer,
  type RetryPolicy,
  type Resolution,
  type RunActivation,
  type RunActivationResult,
  type UpdateAnswer,
} from '../core/generated/kernel';

/** A query the activation asks the workflow to answer. */
export interface AskedQuery {
  queryId: string;
  queryType: string;
}

/** An update the activation delivers to the workflow. */
export interface AskedUpdate {
  updateId: string;
  updateType: string;
  /** The update's argument, as its JSON encoding; absent when it has none. */
  args?: Uint8Array;
}

/** What a `RunActivation` holds for the workflow's code, loaded. */
export interface LoadedActivation {
  context: WorkflowContext;
  /** The run's id, which names the activation's result. */
  executionId: string;
  workflowType: string;
  /** The run's input, as the value the client started it with. */
  input: unknown;
  queries: AskedQuery[];
  updates: AskedUpdate[];
}

/**
 * A query or update answer as the worker's handlers produce it: a payload
 * whose bytes are number arrays.
 */
type HandlerPayload = { data: number[]; metadata: Record<string, number[]> };

export type HandlerQueryResponse = {
  query_id: string;
  result: { Success: { output: HandlerPayload } } | { Failed: { message: string } };
};

export type HandlerUpdateResponse = {
  update_id: string;
  result:
    | { Completed: { output: HandlerPayload } }
    | { Rejected: { message: string } }
    | { Failed: { message: string } };
};

/** What running the workflow's code produced, as the executor reports it. */
export interface ActivationOutcome {
  success: boolean;
  error?: { message?: string; type?: string };
  commands?: any[];
  reached?: ReachedStep[];
}

/** A command the kernel protocol cannot carry: the activation is answered with a protocol error. */
export class ProtocolRefusal extends Error {}

/**
 * Where a resolution comes in the order the run observes its outcomes: the
 * sequence the kernel numbered it with. Which of two outcomes came first, a
 * wait's result or a cancellation request, is decided by it, never by their
 * times, which tie within a millisecond. A resolution the kernel did not
 * number (one built by hand) keeps its place in the list, the same order.
 */
function orderOf(position: number, resolution: Resolution): number {
  const sequence = Number(resolution.sequence ?? 0);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : position + 1;
}

/**
 * Loads an activation's resolutions into a context for its run, as the
 * history holds them.
 *
 * `namespace` is the one the worker polled, for an activation that does not
 * name its own.
 */
export function loadActivation(activation: RunActivation, namespace: string): LoadedActivation {
  const run = activation.run;
  if (!run) {
    throw new ProtocolRefusal('the activation names no run');
  }
  const startedResolution = activation.resolutions.find((r) => r.what.oneofKind === 'started');
  const started =
    startedResolution?.what.oneofKind === 'started' ? startedResolution.what.started : undefined;
  const startedAt = started?.startedAt ?? startedResolution?.at;
  const inputPayload = started?.input[0];
  const input = inputPayload ? (decodeJson(inputPayload.data) ?? undefined) : undefined;

  // A run reading back what it already did replays: a step, child or timer
  // the history settled.
  const replaying = activation.resolutions.some(
    (r) =>
      r.what.oneofKind === 'step' || r.what.oneofKind === 'child' || r.what.oneofKind === 'timer'
  );
  const context = new WorkflowContext(
    {
      workflowId: run.workflowId || run.runId,
      runId: run.runId,
      workflowType: run.workflowType,
      // The engine counts a run's attempt from 1 (2 for the run of its first
      // workflow-level retry) and the kernel hands it over as is. Engines
      // before orcher#356 numbered the first run 0; it reads as 1, so a first
      // run is still the first attempt there. On a current engine the floor
      // never applies.
      attempt: Math.max(started?.attempt ?? 1, 1),
      namespace: run.namespace || namespace,
      taskQueue: run.taskQueue,
    },
    replaying,
    '1.0.0',
    // The workflow's clock starts when the engine recorded the start; an
    // activation that records none starts it now.
    startedAt ? millis(startedAt) : Date.now()
  );

  // When each outcome was recorded, and where it comes in the order the run
  // observes its outcomes, keyed as the context holds it: the first outcome
  // of a key is the one the run observes.
  const resolvedAt: Record<string, number> = {};
  const resolvedOrder: Record<string, number> = {};
  const noteResolvedAt = (key: string, at: Timestamp | undefined, order: number) => {
    if (at && !(key in resolvedAt)) {
      resolvedAt[key] = millis(at);
    }
    if (!(key in resolvedOrder)) {
      resolvedOrder[key] = order;
    }
  };

  const results: Array<[string, unknown]> = [];
  const events: Array<{
    name: string;
    payload: unknown;
    position: number;
    atMs?: number;
    order: number;
  }> = [];
  const updates: AskedUpdate[] = [];
  let cancelOrder: number | undefined;

  activation.resolutions.forEach((resolution, position) => {
    const what = resolution.what;
    const stepId = resolution.stepId;
    const order = orderOf(position, resolution);
    switch (what.oneofKind) {
      case 'step': {
        noteResolvedAt(stepId, resolution.at, order);
        const outcome = what.step.outcome;
        if (outcome?.result.oneofKind === 'value') {
          const value = decodeStepResult(outcome.result.value.data);
          if (value.ok) {
            results.push([stepId, value.value]);
          }
        } else if (outcome?.result.oneofKind === 'failure') {
          const failure = outcome.result.failure;
          results.push([
            stepId,
            {
              [TASK_FAILED_SENTINEL_KEY]: true,
              message: failure.message,
              error_type: failure.errorType,
              // Why it failed: 'application' for a task that threw,
              // 'cancelled' for one that was cancelled, and so on.
              code: failureCodeName(failure.code, outcome.end),
              attempts: outcome.attempts,
            },
          ]);
        }
        break;
      }
      case 'child': {
        const workflowId = what.child.childWorkflowId;
        const key = `child:${workflowId}`;
        noteResolvedAt(key, resolution.at, order);
        const outcome = what.child.outcome;
        const failure =
          outcome?.result.oneofKind === 'failure' ? outcome.result.failure : undefined;
        switch (outcome?.end ?? End.UNSPECIFIED) {
          case End.FAILED:
            results.push([key, childFailed(failure?.message || 'Child workflow failed')]);
            break;
          case End.CANCELLED:
            results.push([key, childFailed('child workflow was canceled')]);
            break;
          case End.TERMINATED:
            // The failure's message is the reason given for the termination,
            // empty when none was.
            results.push([
              key,
              childFailed(
                failure?.message
                  ? `child workflow was terminated: ${failure.message}`
                  : 'child workflow was terminated'
              ),
            ]);
            break;
          case End.TIMED_OUT:
            results.push([key, childFailed('child workflow timed out')]);
            break;
          default:
            if (outcome?.result.oneofKind === 'value') {
              const value = decodeStepResult(outcome.result.value.data);
              if (value.ok) {
                results.push([key, value.value]);
              }
            }
        }
        break;
      }
      case 'timer':
        if (stepId) {
          noteResolvedAt(`timer:${stepId}`, resolution.at, order);
          // Where it fired among the outcomes: a wait with a deadline takes
          // whichever of its event and its timer the run observed first.
          results.push([`timer:${stepId}`, { firedAt: position }]);
        }
        break;
      case 'event':
        if (what.event.name) {
          const data = what.event.payload?.data;
          events.push({
            name: what.event.name,
            payload: data && data.length > 0 ? (decodeJsonOr(data, null) ?? null) : null,
            position,
            atMs: resolution.at ? millis(resolution.at) : undefined,
            order,
          });
        }
        break;
      case 'update':
        updates.push({
          updateId: what.update.updateId,
          updateType: what.update.name,
          args: what.update.args[0]?.data,
        });
        break;
      case 'cancel':
        // The first request is the one the run is told of.
        if (cancelOrder === undefined) {
          cancelOrder = order;
        }
        break;
      // A child history records as started keeps the id it was started under,
      // which this SDK always gives it again: nothing to load.
      case 'childStarted':
      case 'started':
      case undefined:
        break;
    }
  });

  context.recordResolvedAt(resolvedAt);
  context.recordResolvedOrder(resolvedOrder);
  if (cancelOrder !== undefined) {
    context.noteCancelRequested(cancelOrder);
  }
  for (const [key, value] of results) {
    context.injectStepResult(key, value);
  }
  for (const { name, payload, position, atMs, order } of events) {
    context.bufferEvent(name, payload, position, atMs, order);
  }

  return {
    context,
    executionId: run.runId,
    workflowType: run.workflowType,
    input,
    queries: activation.queries.map((query) => ({
      queryId: query.queryId,
      queryType: query.name,
    })),
    updates,
  };
}

/**
 * A failure code's name in lower case, as a task failure error reports it. A
 * failure with no code (or one this SDK does not know) takes it from how its
 * step ended, when that was a cancellation or a timeout, and is otherwise
 * `'unspecified'`.
 */
export function failureCodeName(code: FailureCode, end: End = End.UNSPECIFIED): TaskFailureCode {
  const name =
    code === FailureCode.UNSPECIFIED ? undefined : (FailureCode[code] as string | undefined);
  if (name !== undefined) {
    return name.toLowerCase() as TaskFailureCode;
  }
  switch (end) {
    case End.CANCELLED:
      return 'cancelled';
    case End.TIMED_OUT:
      return 'timed_out';
    default:
      return 'unspecified';
  }
}

/**
 * The answer to an activation: what the workflow's code produced, as the
 * kernel protocol's commands, with the queries and updates answered.
 */
export function answerActivation(
  activationId: Uint8Array,
  outcome: ActivationOutcome,
  queries: HandlerQueryResponse[],
  updates: HandlerUpdateResponse[]
): RunActivationResult {
  const answered = {
    activationId,
    queries: queries.map(queryAnswer),
    updates: updates.map(updateAnswer),
  };
  if (!outcome.success) {
    return {
      ...answered,
      outcome: {
        oneofKind: 'workflowFailed',
        workflowFailed: failure({
          message: outcome.error?.message || 'Unknown error',
          nonRetryable: true,
          code:
            outcome.error?.type === 'NonDeterminism'
              ? FailureCode.NON_DETERMINISM
              : FailureCode.APPLICATION,
        }),
      },
    };
  }
  try {
    return {
      ...answered,
      outcome: {
        oneofKind: 'commands',
        commands: { commands: kernelCommands(outcome.commands ?? [], outcome.reached ?? []) },
      },
    };
  } catch (error) {
    if (error instanceof ProtocolRefusal) {
      return protocolError(activationId, error.message);
    }
    throw error;
  }
}

/** An activation the SDK could not process, answered as such. */
export function protocolError(activationId: Uint8Array, message: string): RunActivationResult {
  return {
    activationId,
    outcome: { oneofKind: 'protocolError', protocolError: { message, kind: 0 } },
    queries: [],
    updates: [],
  };
}

/**
 * Every durable call, in issue order: the new commands as issued, with the
 * steps answered from history (reached, but not issued) marked satisfied in
 * their place among them.
 */
export function kernelCommands(issued: any[], reached: ReachedStep[]): Command[] {
  const stepKey = (kind: string, id: string) => `${kind}\u0000${id}`;
  const issuedSteps = new Set<string>();
  for (const command of issued) {
    const step = stepOf(command);
    if (step) {
      issuedSteps.add(stepKey(step.kind, step.id));
    }
  }
  const out: Command[] = [];
  let next = 0;
  const satisfiedUpTo = (until?: ReachedStep) => {
    for (let step = reached[next]; step !== undefined; step = reached[next]) {
      if (until && step.kind === until.kind && step.id === until.id) {
        // The issued call itself.
        next++;
        return;
      }
      next++;
      if (!issuedSteps.has(stepKey(step.kind, step.id))) {
        out.push(satisfied(step));
      }
    }
  };
  for (const command of issued) {
    const step = stepOf(command);
    if (step) {
      // The steps reached before this one that were not issued were answered
      // from history.
      satisfiedUpTo(step);
    }
    out.push(kernelCommand(command));
  }
  satisfiedUpTo();
  return out;
}

/** The step a command issues, if it issues one. */
function stepOf(command: any): ReachedStep | undefined {
  switch (command.type) {
    case WorkflowCommandType.SCHEDULE_TASK:
      return { kind: 'task', id: command.taskId };
    case WorkflowCommandType.START_TIMER:
      return { kind: 'timer', id: command.timerId };
    case WorkflowCommandType.START_CHILD_WORKFLOW:
      return { kind: 'child', id: command.workflowId };
    default:
      return undefined;
  }
}

/** A call answered from history: its kind and id, no payloads. */
function satisfied(step: ReachedStep): Command {
  switch (step.kind) {
    case 'task':
      return call(0, step.id, { oneofKind: 'runTask', runTask: RunTask.create() }, true);
    case 'timer':
      return call(0, step.id, { oneofKind: 'startTimer', startTimer: StartTimer.create() }, true);
    case 'child':
      return call(
        0,
        '',
        { oneofKind: 'startChild', startChild: StartChild.create({ workflowId: step.id }) },
        true
      );
  }
}

/**
 * A new command, as the kernel protocol carries it. The values, and the
 * defaults for those the workflow left unset, are the ones the worker sends
 * sdk-core today.
 */
function kernelCommand(command: any): Command {
  const seq = typeof command.sequence === 'number' ? command.sequence : 0;
  switch (command.type) {
    case WorkflowCommandType.SCHEDULE_TASK: {
      const policy = command.retryPolicy;
      return call(seq, command.taskId, {
        oneofKind: 'runTask',
        runTask: RunTask.create({
          taskType: command.taskType,
          taskQueue: command.taskQueue,
          input: inputPayloads(command.input),
          attemptTimeout: duration(typeof command.timeout === 'number' ? command.timeout : 300_000),
          heartbeatTimeout:
            typeof command.heartbeatTimeoutMs === 'number'
              ? duration(command.heartbeatTimeoutMs)
              : undefined,
          queueTimeout:
            typeof command.queueTimeoutMs === 'number'
              ? duration(command.queueTimeoutMs)
              : undefined,
          retryPolicy: policy ? retryPolicy(policy) : undefined,
        }),
      });
    }
    case WorkflowCommandType.START_TIMER:
      return call(seq, command.timerId, {
        oneofKind: 'startTimer',
        startTimer: { duration: duration(command.durationMs ?? 0) },
      });
    case WorkflowCommandType.CANCEL_TIMER:
      return call(seq, '', {
        oneofKind: 'cancelTimer',
        cancelTimer: { stepId: command.timerId },
      });
    case WorkflowCommandType.START_CHILD_WORKFLOW:
      return call(seq, '', {
        oneofKind: 'startChild',
        startChild: StartChild.create({
          workflowId: command.workflowId,
          workflowType: command.workflowType,
          taskQueue: command.taskQueue,
          input: inputPayloads(command.input),
          executionTimeout:
            typeof command.timeout === 'number' ? duration(command.timeout) : undefined,
          orphanPolicy: orphanPolicy(command.parentClosePolicy),
        }),
      });
    case WorkflowCommandType.CANCEL_CHILD_WORKFLOW:
      return call(0, '', { oneofKind: 'cancelChild', cancelChild: { stepId: command.workflowId } });
    case WorkflowCommandType.SEND_EVENT:
      // Any run of the target receives it.
      return call(0, '', {
        oneofKind: 'sendEvent',
        sendEvent: {
          workflowId: command.targetWorkflowId,
          runId: '',
          name: command.eventName,
          payload: { data: jsonBytes(command.payload), metadata: {} },
          headers: {},
        },
      });
    case WorkflowCommandType.RECORD_STEP_RESULT:
      return call(0, command.stepName, {
        oneofKind: 'recordValue',
        recordValue: {
          outcome: {
            result: {
              oneofKind: 'value',
              value: { data: jsonBytes(command.result), metadata: {} },
            },
            end: End.COMPLETED,
            attempts: 1,
          },
        },
      });
    case WorkflowCommandType.WAIT_FOR_EVENT:
      return call(0, command.stepId, {
        oneofKind: 'awaitEvent',
        awaitEvent: {
          name: command.eventName,
          timeout: typeof command.timeoutMs === 'number' ? duration(command.timeoutMs) : undefined,
        },
      });
    case WorkflowCommandType.COMPLETE_WORKFLOW:
      return call(0, '', {
        oneofKind: 'completeRun',
        completeRun: CompleteRun.create({ result: payloadOf(command.result) }),
      });
    case WorkflowCommandType.FAIL_WORKFLOW:
      return call(0, '', {
        oneofKind: 'failRun',
        failRun: {
          failure: failure({
            message: command.message ?? '',
            errorType: command.errorType ?? '',
          }),
        },
      });
    case WorkflowCommandType.CANCEL_WORKFLOW:
      return call(0, '', { oneofKind: 'endCancelled', endCancelled: { details: '' } });
    case WorkflowCommandType.RESTART_FRESH:
      return call(0, '', {
        oneofKind: 'restartFresh',
        restartFresh: {
          workflowType: command.workflowType ?? '',
          taskQueue: command.taskQueue ?? '',
          input: inputPayloads(command.input),
          executionTimeout:
            typeof command.timeout === 'number' ? duration(command.timeout) : undefined,
        },
      });
    default:
      throw new ProtocolRefusal(
        `the workflow issued a command the kernel protocol does not carry: ${command.type}`
      );
  }
}

function call(seq: number, stepId: string, what: Command['what'], isSatisfied = false): Command {
  return { seq: String(seq), satisfied: isSatisfied, stepId, what };
}

/**
 * A task's, child's or restart's input: one payload, the one value it receives
 * as its argument, or none when there is no input.
 */
function inputPayloads(input: unknown): Payload[] {
  if (input === undefined) {
    return [];
  }
  const payload = toPayload(input);
  return [{ data: payload.data, metadata: { ...payload.metadata } }];
}

/** A payload the executor holds as number arrays. */
function payloadOf(payload: HandlerPayload | undefined): Payload {
  return {
    data: Uint8Array.from(payload?.data ?? []),
    metadata: Object.fromEntries(
      Object.entries(payload?.metadata ?? {}).map(([key, value]) => [key, Uint8Array.from(value)])
    ),
  };
}

function retryPolicy(policy: any): RetryPolicy {
  return {
    maxAttempts: policy.maxAttempts ?? policy.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
    firstDelay: duration(policy.initialInterval ?? policy.initial_interval ?? 1000),
    maxDelay: duration(policy.maxInterval ?? policy.max_interval ?? 60000),
    delayMultiplier: policy.backoffCoefficient ?? policy.backoff_coefficient ?? 2.0,
    // `nonRetryableErrorTypes` is the typed field; the other two spellings
    // are accepted from untyped policies.
    neverRetryTypes:
      policy.nonRetryableErrorTypes ??
      policy.nonRetryableErrors ??
      policy.non_retryable_errors ??
      [],
  };
}

function orphanPolicy(policy: unknown): OrphanPolicy {
  switch (policy) {
    case ParentClosePolicy.TERMINATE:
      return OrphanPolicy.TERMINATE;
    case ParentClosePolicy.ABANDON:
      return OrphanPolicy.ABANDON;
    default:
      return OrphanPolicy.CANCEL;
  }
}

function queryAnswer(response: HandlerQueryResponse): QueryAnswer {
  const result = response.result;
  return {
    queryId: response.query_id,
    answer:
      'Success' in result
        ? { oneofKind: 'value', value: payloadOf(result.Success.output) }
        : { oneofKind: 'failure', failure: failure({ message: result.Failed.message }) },
  };
}

function updateAnswer(response: HandlerUpdateResponse): UpdateAnswer {
  const result = response.result;
  let answer: UpdateAnswer['answer'];
  if ('Completed' in result) {
    answer = { oneofKind: 'value', value: payloadOf(result.Completed.output) };
  } else if ('Rejected' in result) {
    answer = { oneofKind: 'rejected', rejected: failure({ message: result.Rejected.message }) };
  } else {
    answer = { oneofKind: 'failed', failed: failure({ message: result.Failed.message }) };
  }
  return { updateId: response.update_id, answer };
}

function failure(fields: Partial<Failure>): Failure {
  return {
    message: '',
    errorType: '',
    nonRetryable: false,
    code: FailureCode.UNSPECIFIED,
    details: new Uint8Array(),
    ...fields,
  };
}

function childFailed(message: string): { __orcher_child_failed__: true; message: string } {
  return { __orcher_child_failed__: true, message };
}

/** A recorded step result: empty is null; bytes that are not JSON are not a result. */
function decodeStepResult(data: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  if (data.length === 0) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(data)) };
  } catch {
    return { ok: false };
  }
}

function decodeJson(data: Uint8Array): unknown {
  return decodeJsonOr(data, undefined);
}

function decodeJsonOr(data: Uint8Array, fallback: unknown): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return fallback;
  }
}

/** A value's JSON encoding, `null` for none. */
function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value ?? null));
}

function duration(ms: number): Duration {
  return {
    seconds: String(Math.floor(ms / 1000)),
    nanos: Math.round((ms % 1000) * 1_000_000),
  };
}

function millis(t: Timestamp): number {
  return Number(t.seconds) * 1000 + Math.floor(t.nanos / 1_000_000);
}
