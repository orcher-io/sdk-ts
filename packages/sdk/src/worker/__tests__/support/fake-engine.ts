/**
 * A fake engine for driving workflows through the worker as the worker host
 * drives them: kernel activations in, kernel commands out.
 *
 * A small in-memory engine journals what each activation asks for, resolves
 * it, and hands the run's history to the next activation as the kernel
 * would: a `RunActivation` whose resolutions carry the times the journal
 * recorded them at. Every activation runs the workflow from the start against
 * that history, so a step id or a clock reading that depends on how far the
 * run had got shows up as a difference between activations.
 *
 * A test using it mocks `core/native`, so constructing the worker connects to
 * nothing.
 */

import { Worker } from '../../worker';
import type { Logger } from '../../types';
import type { WorkflowContext } from '../../../workflow/context';
import {
  End,
  FailureCode,
  type Command,
  type Outcome,
  type Resolution,
  type RunActivation,
  type RunActivationResult,
} from '../../../core/generated/kernel';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Where the fake engine's clock starts: 2020-09-13, nowhere near the wall
 * clock, so a reading taken from the wall clock cannot pass for it. */
const ENGINE_EPOCH_MS = 1_600_000_000_000;
/** How far the fake engine's clock moves between two journal entries. */
const ENTRY_GAP_MS = 7_000;

/** A value's JSON encoding, as payloads carry it. */
export const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

const decode = (data: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(data));

const at = (ms: number) => ({
  seconds: String(Math.floor(ms / 1000)),
  nanos: (ms % 1000) * 1_000_000,
});

const millis = (d?: { seconds: string; nanos: number }) =>
  d ? Number(d.seconds) * 1000 + d.nanos / 1e6 : 0;

/** A task reference by name, as `@Task` would generate. */
export const taskRef = (taskName: string): any => ({
  taskName,
  handlerClass: class {},
  methodName: 'run',
});

interface Entry {
  atMs: number;
  /** The outcome the kernel resolves the entry into, if any. */
  resolution?: Pick<Resolution, 'stepId' | 'what'>;
}

export type ChildOutcome =
  | { kind: 'completed' }
  | { kind: 'running' }
  | { kind: 'canceled' }
  | { kind: 'terminated'; reason: string }
  | { kind: 'timed_out' };

/** An engine that journals and resolves whatever an activation asks for. */
export class FakeEngine {
  readonly journal: Entry[] = [];
  /** Every command an activation issued (not those it found satisfied), in order. */
  readonly sent: Command[] = [];
  private clockMs = ENGINE_EPOCH_MS;

  constructor(
    private readonly input: unknown = {},
    private readonly child: ChildOutcome = { kind: 'completed' }
  ) {
    this.append();
  }

  private append(resolution?: Entry['resolution']): void {
    this.journal.push({ atMs: this.clockMs, resolution });
    this.clockMs += ENTRY_GAP_MS;
  }

  /** When the entry at `index` was recorded, in ms. */
  entryMs(index: number): number {
    return this.journal[index]!.atMs;
  }

  /** Deliver an event, as a client's SendEvent would. */
  deliverEvent(name: string, payload: unknown): void {
    this.append({
      stepId: '',
      what: {
        oneofKind: 'event',
        event: {
          eventId: String(this.journal.length + 1),
          name,
          payload: { data: bytes(payload), metadata: {} },
        },
      },
    });
  }

  /** The activation the kernel hands the worker for the journal as it is. */
  activation(): RunActivation {
    const startedMs = this.journal[0]!.atMs;
    const resolutions: Resolution[] = [
      {
        stepId: '',
        at: at(startedMs),
        replaying: false,
        what: {
          oneofKind: 'started',
          started: {
            input: [{ data: bytes(this.input), metadata: {} }],
            attempt: 1,
            startedAt: at(startedMs),
            randomSeed: new Uint8Array(),
            headers: {},
            stepIds: 0,
            historyLineage: '',
          },
        },
      },
    ];
    for (const entry of this.journal) {
      if (entry.resolution) {
        resolutions.push({ ...entry.resolution, at: at(entry.atMs), replaying: false });
      }
    }
    return {
      activationId: new Uint8Array([this.journal.length]),
      run: {
        workflowId: 'wf-replay',
        runId: 'run-replay',
        workflowType: 'under_test',
        taskQueue: 'replay',
        namespace: 'default',
      },
      resolutions,
      queries: [],
    };
  }

  /** Journal and resolve what an activation issued. A task's result is its
   * own step id and a child's is its workflow id, so a workflow handed another
   * step's result says so in its output. Timers of a minute or less fire at
   * once. */
  apply(commands: Command[]): void {
    for (const command of commands) {
      if (command.satisfied) continue;
      this.sent.push(command);
      const what = command.what;
      switch (what.oneofKind) {
        case 'runTask':
          this.append();
          this.append({
            stepId: command.stepId,
            what: { oneofKind: 'step', step: { outcome: completed(bytes(command.stepId)) } },
          });
          break;
        case 'startTimer':
          this.append();
          // A timer of a minute or less fires at once; a longer one stays
          // pending, so an event can arrive before it.
          if (millis(what.startTimer.duration) > 60_000) break;
          this.append({ stepId: command.stepId, what: { oneofKind: 'timer', timer: {} } });
          break;
        case 'startChild':
          this.applyChild(what.startChild.workflowId);
          break;
        case 'recordValue':
          this.append({
            stepId: command.stepId,
            what: { oneofKind: 'step', step: { outcome: what.recordValue.outcome } },
          });
          break;
        default:
          break;
      }
    }
  }

  private applyChild(id: string): void {
    const ids = { childWorkflowId: id, childRunId: `run-${id}` };
    this.append({ stepId: '', what: { oneofKind: 'childStarted', childStarted: ids } });
    const settle = (outcome: Outcome) =>
      this.append({ stepId: '', what: { oneofKind: 'child', child: { ...ids, outcome } } });
    switch (this.child.kind) {
      case 'running':
        return;
      case 'completed':
        return settle(completed(bytes(id)));
      case 'canceled':
        return settle(ended(End.CANCELLED));
      case 'terminated':
        return settle(terminated(this.child.reason));
      case 'timed_out':
        return settle(ended(End.TIMED_OUT));
    }
  }
}

function completed(data: Uint8Array): Outcome {
  return {
    result: { oneofKind: 'value', value: { data, metadata: {} } },
    end: End.COMPLETED,
    attempts: 1,
  };
}

function ended(end: End): Outcome {
  return { result: { oneofKind: undefined }, end, attempts: 1 };
}

/** A terminated child, as the kernel resolves it: the reason is the failure's message. */
function terminated(reason: string): Outcome {
  return {
    result: {
      oneofKind: 'failure',
      failure: {
        message: reason,
        errorType: '',
        nonRetryable: false,
        code: FailureCode.TERMINATED,
        details: new Uint8Array(),
      },
    },
    end: End.TERMINATED,
    attempts: 1,
  };
}

/** A step an activation issued: its kind, its id, and the work it names. */
export type Issued = [string, string, string];

/** The steps the commands issue, leaving out those found satisfied. */
export function issuedSteps(commands: Command[]): Issued[] {
  const issued: Issued[] = [];
  for (const command of commands) {
    if (command.satisfied) continue;
    const what = command.what;
    if (what.oneofKind === 'runTask') issued.push(['task', command.stepId, what.runTask.taskType]);
    if (what.oneofKind === 'startTimer') issued.push(['timer', command.stepId, '']);
    if (what.oneofKind === 'startChild') {
      issued.push(['child', what.startChild.workflowId, what.startChild.workflowType]);
    }
    if (what.oneofKind === 'recordValue') issued.push(['closure', command.stepId, '']);
  }
  return issued;
}

/** Every task, timer and child the code reached, answered from history or issued, in order. */
export function reachedSteps(commands: Command[]): string[] {
  const reached: string[] = [];
  for (const command of commands) {
    const what = command.what;
    if (what.oneofKind === 'runTask' || what.oneofKind === 'startTimer') {
      reached.push(command.stepId);
    } else if (what.oneofKind === 'startChild') {
      reached.push(what.startChild.workflowId);
    }
  }
  return reached;
}

/** The value the workflow completed with, if it completed. */
export function completion(commands: Command[]): unknown {
  for (const command of commands) {
    if (command.what.oneofKind === 'completeRun') {
      return decode(command.what.completeRun.result?.data ?? new Uint8Array());
    }
  }
  return undefined;
}

/** An activation's answer, read for a test. */
export interface Answered {
  answer: RunActivationResult;
  successful: boolean;
  /** Why the workflow failed, or the activation was refused. */
  error?: string;
  /** Every command, those found satisfied included. */
  commands: Command[];
  reached: string[];
}

/** A worker running `run` as the workflow `under_test`. */
export function workerFor(run: (ctx: WorkflowContext, input: any) => Promise<unknown>): Worker {
  const workflow = async (ctx: WorkflowContext, input: any) => run(ctx, input);
  Object.defineProperty(workflow, 'name', { value: 'under_test' });
  return new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'replay',
    workflows: [workflow],
    tasks: [],
    logger: silent,
  });
}

/** Run one activation of `run` against the journal as it is, and return
 * its answer, unchecked. */
export function activation(run: (ctx: WorkflowContext, input: any) => Promise<unknown>) {
  const worker = workerFor(run);
  return async (engine: FakeEngine): Promise<Answered> => {
    const answer = await worker.runActivation(engine.activation());
    const outcome = answer.outcome;
    const commands = outcome.oneofKind === 'commands' ? outcome.commands.commands : [];
    return {
      answer,
      successful: outcome.oneofKind === 'commands',
      error:
        outcome.oneofKind === 'workflowFailed'
          ? outcome.workflowFailed.message
          : outcome.oneofKind === 'protocolError'
            ? outcome.protocolError.message
            : undefined,
      commands,
      reached: reachedSteps(commands),
    };
  };
}

export function runner(run: (ctx: WorkflowContext, input: any) => Promise<unknown>) {
  const activate = activation(run);
  return async (engine: FakeEngine): Promise<Command[]> => {
    const result = await activate(engine);
    if (!result.successful) {
      throw new Error(`the activation failed: ${result.error}`);
    }
    // What the core checks before sending: no step id the journal recorded
    // reissued for other work.
    const journaled = new Set(engine.sent.flatMap((c) => issuedSteps([c]).map((s) => s.join('|'))));
    for (const step of issuedSteps(result.commands)) {
      const sameId = [...journaled].find((j) => j.split('|')[1] === step[1]);
      if (sameId && sameId !== step.join('|')) {
        throw new Error(`step ${step[1]} reissued for other work: ${sameId} -> ${step.join('|')}`);
      }
    }
    // And that it reached every step the journal recorded, if it issues new
    // work or ends the workflow: the rule the kernel holds an activation to.
    leftBehind(engine, result);
    return result.commands;
  };
}

/** Throw as the kernel would refuse the activation: a step the journal
 * recorded that the code did not reach, while it issues new work or ends the
 * workflow. */
export function leftBehind(engine: FakeEngine, result: Answered): void {
  const recorded = [
    ...new Set(
      engine.sent
        .flatMap((c) => issuedSteps([c]))
        .filter(([kind]) => kind !== 'closure')
        .map(([, id]) => id)
    ),
  ];
  const issued = issuedSteps(result.commands).filter(([kind]) => kind !== 'closure');
  const reached = new Set<string>(result.reached);
  const newWork = issued.find(([, id]) => !recorded.includes(id));
  const ends = result.commands.find(
    (c) =>
      c.what.oneofKind === 'completeRun' ||
      c.what.oneofKind === 'failRun' ||
      c.what.oneofKind === 'restartFresh'
  );
  const left = recorded.filter((id) => !reached.has(id));
  if ((newWork || ends || !result.successful) && left.length > 0) {
    throw new Error(
      `non-deterministic: recorded ${left.join(', ')} not reached, and the code ${
        newWork ? `issued ${newWork.join(' ')}` : ends ? 'ended the workflow' : 'failed'
      }`
    );
  }
}

/** Drive a workflow to completion, one activation per journal state. */
export async function runToCompletion(
  activate: (engine: FakeEngine) => Promise<Command[]>,
  engine: FakeEngine,
  { maxActivations = 16 } = {}
): Promise<{ issued: Issued[]; output: unknown }> {
  const issued: Issued[] = [];
  for (let i = 0; i < maxActivations; i++) {
    const commands = await activate(engine);
    issued.push(...issuedSteps(commands));
    engine.apply(commands);
    const output = completion(commands);
    if (output !== undefined) return { issued, output };
  }
  throw new Error(`the workflow did not complete; it issued ${JSON.stringify(issued)}`);
}
