/**
 * A workflow activation as the kernel protocol carries it: the run's history
 * resolved into a `RunActivation`, answered with a `RunActivationResult`.
 *
 * The replay check (`contract/replay-check.ts`) holds this path to the answers
 * recorded from real runs; these pin the rules it rests on.
 */

import { Worker } from '../worker';
import { answerActivation, kernelCommands, loadActivation } from '../activation';
import { WorkflowCommandType, type WorkflowContext } from '../../workflow/context';
import { TASK_FAILED_SENTINEL_KEY, WorkflowError, isWorkflowCancellation } from '../../errors';
import {
  End,
  FailureCode,
  type Command,
  type Resolution,
  type RunActivation,
} from '../../core/generated/kernel';
import { taskRef } from './support/fake-engine';
import { SESSION_CREATE_TASK } from '../../workflow/session';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const json = (value: unknown) => ({
  data: new TextEncoder().encode(JSON.stringify(value)),
  metadata: {},
});
const at = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 });

function activationOf(workflowType: string, resolutions: Resolution[]): RunActivation {
  return {
    activationId: new Uint8Array([1, 2, 3]),
    run: {
      workflowId: 'order-7',
      runId: 'run-1',
      workflowType,
      taskQueue: 'orders',
      namespace: 'default',
    },
    resolutions: [
      {
        stepId: '',
        at: at(1_000),
        replaying: false,
        sequence: '0',
        what: {
          oneofKind: 'started',
          started: {
            input: [json({ n: 1 })],
            attempt: 1,
            startedAt: at(1_000),
            randomSeed: new Uint8Array(),
            headers: {},
            stepIds: 0,
            historyLineage: '',
          },
        },
      },
      ...resolutions,
    ],
    queries: [],
  };
}

const settled = (stepId: string, value: unknown, ms: number): Resolution => ({
  stepId,
  at: at(ms),
  replaying: false,
  sequence: '0',
  what: {
    oneofKind: 'step',
    step: {
      outcome: {
        result: { oneofKind: 'value', value: json(value) },
        end: End.COMPLETED,
        attempts: 1,
      },
    },
  },
});

/** Each call as (satisfied, kind, id). */
const calls = (commands: Command[]) =>
  commands.map((c) => {
    const what = c.what;
    const id = what.oneofKind === 'startChild' ? what.startChild.workflowId : c.stepId;
    return [c.satisfied, what.oneofKind, id];
  });

function workerWith(name: string, run: (ctx: WorkflowContext, input: any) => Promise<unknown>) {
  Object.defineProperty(run, 'name', { value: name });
  return new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'orders',
    workflows: [run],
    tasks: [],
    logger: silent,
  });
}

describe('a kernel activation', () => {
  it('sends calls answered from history in their place among new ones', () => {
    const issued = [
      {
        type: WorkflowCommandType.SCHEDULE_TASK,
        sequence: 1,
        taskId: 'ship_1',
        taskType: 'ship',
        taskQueue: 'q',
        input: {},
      },
      { type: WorkflowCommandType.START_TIMER, sequence: 3, timerId: 'timer_3', durationMs: 5_000 },
    ];
    const reached = [
      { kind: 'task' as const, id: 'charge_0' },
      { kind: 'task' as const, id: 'ship_1' },
      { kind: 'child' as const, id: 'child_2' },
      { kind: 'timer' as const, id: 'timer_3' },
      { kind: 'timer' as const, id: 'timer_4' },
    ];
    const commands = kernelCommands(issued, reached);
    expect(calls(commands)).toEqual([
      [true, 'runTask', 'charge_0'],
      [false, 'runTask', 'ship_1'],
      [true, 'startChild', 'child_2'],
      [false, 'startTimer', 'timer_3'],
      [true, 'startTimer', 'timer_4'],
    ]);
    expect(commands[1]?.seq).toBe('1');
    // A satisfied call carries no payloads.
    const first = commands[0]?.what;
    expect(first?.oneofKind === 'runTask' && first.runTask.input).toEqual([]);
  });

  it.each([
    [1, 1],
    [2, 2],
    [0, 1],
  ])('reads attempt %i as %i', (attempt, reads) => {
    // A first run is attempt 1 and the run of its first retry attempt 2, as
    // the engine numbers them. An engine before orcher#356 numbers the first
    // run 0, which reads as 1.
    const activation = activationOf('wf', []);
    const start = activation.resolutions[0]!.what;
    if (start.oneofKind !== 'started') throw new Error('no start');
    start.started.attempt = attempt;
    expect(loadActivation(activation, 'default').context.attempt()).toBe(reads);
  });

  it.each([
    ['an omitted count as the documented default', {}, 3],
    ['an explicit 0 as unlimited', { maxAttempts: 0 }, 0],
    ['an explicit count as given', { maxAttempts: 5 }, 5],
  ])('sends a task retry policy with %s', (_, counts, sent) => {
    const commands = kernelCommands(
      [
        {
          type: WorkflowCommandType.SCHEDULE_TASK,
          sequence: 0,
          taskId: 'ship_0',
          taskType: 'ship',
          taskQueue: 'q',
          input: {},
          retryPolicy: { initialInterval: 1_000, ...counts },
        },
      ],
      [{ kind: 'task' as const, id: 'ship_0' }]
    );
    const what = commands[0]?.what;
    if (what?.oneofKind !== 'runTask') throw new Error('no task');
    expect(what.runTask.retryPolicy?.maxAttempts).toBe(sent);
  });

  it('answers a command the protocol cannot carry with a protocol error', () => {
    const result = answerActivation(
      new Uint8Array(),
      { success: true, commands: [{ type: 'REQUEST_CANCELLATION', sequence: 0 }], reached: [] },
      [],
      []
    );
    expect(result.outcome.oneofKind).toBe('protocolError');
  });

  it('loads failures, children, timers, events and a cancel request as the context holds them', () => {
    const loaded = loadActivation(
      activationOf('wf', [
        {
          stepId: 'charge_0',
          at: at(2_000),
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'step',
            step: {
              outcome: {
                result: {
                  oneofKind: 'failure',
                  failure: {
                    message: 'declined',
                    errorType: 'CardDeclined',
                    nonRetryable: true,
                    code: 1,
                    details: new Uint8Array(),
                  },
                },
                end: End.FAILED,
                attempts: 3,
              },
            },
          },
        },
        {
          stepId: 'child_1',
          at: at(3_000),
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'child',
            child: {
              childWorkflowId: 'child_1',
              childRunId: 'r',
              outcome: { result: { oneofKind: undefined }, end: End.CANCELLED, attempts: 0 },
            },
          },
        },
        {
          stepId: 'timer_2',
          at: at(4_000),
          replaying: false,
          sequence: '0',
          what: { oneofKind: 'timer', timer: {} },
        },
        {
          stepId: '',
          at: at(5_000),
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'event',
            event: { eventId: '9', name: 'go', payload: json({ ok: true }) },
          },
        },
        {
          stepId: '',
          at: at(6_000),
          replaying: false,
          sequence: '0',
          what: { oneofKind: 'cancel', cancel: { reason: 'user', requestedAt: at(6_000) } },
        },
      ]),
      'default'
    );
    const results = loaded.context.getPendingTaskResults();
    expect(results.get('charge_0')).toEqual({
      [TASK_FAILED_SENTINEL_KEY]: true,
      message: 'declined',
      error_type: 'CardDeclined',
      code: 'application',
      attempts: 3,
    });
    expect(results.get('child:child_1')).toEqual({
      __orcher_child_failed__: true,
      message: 'child workflow was canceled',
    });
    // Where the timer fired among the outcomes.
    expect(results.get('timer:timer_2')).toEqual({ firedAt: 3 });
    expect(loaded.input).toEqual({ n: 1 });
    expect(loaded.context.isReplaying()).toBe(true);
    expect(loaded.context.time.now().getTime()).toBe(1_000);
  });

  // A task failure and the cancel request recorded in the same millisecond,
  // listed failure first, numbered as given: the numbers, not the list or the
  // times, say which came first.
  const failedAndAskedToCancel = (failure: string, cancel: string) =>
    activationOf('pay', [
      {
        stepId: 'charge_0',
        at: at(2_000),
        replaying: false,
        sequence: failure,
        what: {
          oneofKind: 'step',
          step: {
            outcome: {
              result: {
                oneofKind: 'failure',
                failure: {
                  message: 'Task cancelled',
                  errorType: 'Cancelled',
                  nonRetryable: true,
                  code: 3,
                  details: new Uint8Array(),
                },
              },
              end: End.CANCELLED,
              attempts: 1,
            },
          },
        },
      },
      {
        stepId: '',
        at: at(2_000),
        replaying: false,
        sequence: cancel,
        what: { oneofKind: 'cancel', cancel: { reason: 'user', requestedAt: at(2_000) } },
      },
    ]);

  const firstWait = async (activation: RunActivation) => {
    const { context } = loadActivation(activation, 'default');
    try {
      await context.executeTask(taskRef('charge'), 0);
      return { context, thrown: undefined as unknown };
    } catch (thrown) {
      return { context, thrown };
    }
  };

  it("orders a failure in the cancel request's millisecond by sequence", async () => {
    // The failure first: it is the wait's result, and the next wait is told.
    const before = await firstWait(failedAndAskedToCancel('2', '3'));
    expect(isWorkflowCancellation(before.thrown)).toBe(false);
    expect(before.context.isCancelRequested()).toBe(false);

    // The request first: the wait is told, and cleanup runs after it.
    const after = await firstWait(failedAndAskedToCancel('3', '2'));
    expect(isWorkflowCancellation(after.thrown)).toBe(true);
    expect(after.context.isCancelRequested()).toBe(true);
  });

  it('tells the run of the first cancel request only', async () => {
    const activation = failedAndAskedToCancel('4', '3');
    activation.resolutions.push({
      stepId: '',
      at: at(2_000),
      replaying: false,
      sequence: '5',
      what: { oneofKind: 'cancel', cancel: { reason: 'again', requestedAt: at(2_000) } },
    });
    const told = await firstWait(activation);
    expect(isWorkflowCancellation(told.thrown)).toBe(true);
  });

  it('keeps unnumbered resolutions in their place in the list', async () => {
    const activation = failedAndAskedToCancel('3', '2');
    for (const resolution of activation.resolutions) {
      resolution.sequence = '0';
    }
    const unnumbered = await firstWait(activation);
    expect(isWorkflowCancellation(unnumbered.thrown)).toBe(false);
  });

  it('runs the workflow and sends its finished steps satisfied', async () => {
    const worker = workerWith('pay', async (ctx, input) => {
      const charged = await ctx.executeTask(taskRef('charge'), input);
      const shipped = await ctx.executeTask(taskRef('ship'), charged);
      return shipped;
    });
    const answer = await (worker as any).runActivation(
      activationOf('pay', [settled('charge_0', 'charged', 2_000)])
    );
    expect(answer.outcome.oneofKind).toBe('commands');
    expect(calls(answer.outcome.commands.commands)).toEqual([
      [true, 'runTask', 'charge_0'],
      [false, 'runTask', 'ship_1'],
    ]);
    const ship = answer.outcome.commands.commands[1].what.runTask;
    expect(JSON.parse(new TextDecoder().decode(ship.input[0].data))).toBe('charged');
    expect(answer.activationId).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('answers a workflow that fails with its failure', async () => {
    const worker = workerWith('boom', async () => {
      throw new Error('no stock');
    });
    const answer = await (worker as any).runActivation(activationOf('boom', []));
    expect(answer.outcome.oneofKind).toBe('workflowFailed');
    expect(answer.outcome.workflowFailed.message).toContain('no stock');
    expect(answer.outcome.workflowFailed.nonRetryable).toBe(false);
  });

  it('marks a workflow failure non-retryable only when the code raised it so', async () => {
    class OutOfStock extends Error {
      readonly nonRetryable = true;
    }
    const marked = Object.assign(new Error('this one only'), { nonRetryable: true });
    for (const raised of [new OutOfStock('out of stock'), marked]) {
      const worker = workerWith('gives-up', async () => {
        throw raised;
      });
      const answer = await (worker as any).runActivation(activationOf('gives-up', []));
      expect(answer.outcome.oneofKind).toBe('workflowFailed');
      expect(answer.outcome.workflowFailed.nonRetryable).toBe(true);
    }
  });

  it('answers a workflow it does not know with a workflow failure', async () => {
    const worker = workerWith('known', async () => null);
    const answer = await (worker as any).runActivation(activationOf('unknown', []));
    expect(answer.outcome.oneofKind).toBe('workflowFailed');
    expect(answer.outcome.workflowFailed.message).toBe('Workflow not registered: unknown');
    // No code ran, so there are no calls to check against history.
    expect(answer.callsBeforeFailure).toBeUndefined();
  });

  it('sends the calls a failing workflow made before it failed, beside the failure', async () => {
    const worker = workerWith('short', async (ctx, input) => {
      await ctx.executeTask(taskRef('charge'), input);
      await ctx.execute('note', async () => 1);
      throw new Error('no stock');
    });
    const answer = await (worker as any).runActivation(
      activationOf('short', [settled('charge_0', 'charged', 2_000)])
    );
    expect(answer.outcome.oneofKind).toBe('workflowFailed');
    expect(answer.outcome.workflowFailed.message).toContain('no stock');
    // Laid out as kernelCommands lays out a completing activation's calls.
    expect(calls(answer.callsBeforeFailure.commands)).toEqual([
      [false, 'recordValue', 'note_1'],
      [true, 'runTask', 'charge_0'],
    ]);
  });

  it('says a workflow that failed before any call made none', async () => {
    const worker = workerWith('boom', async () => {
      throw new Error('no stock');
    });
    const answer = await (worker as any).runActivation(activationOf('boom', []));
    expect(answer.callsBeforeFailure).toEqual({ commands: [] });
  });

  it('leaves a failure unchecked when its calls cannot be carried', () => {
    const answer = answerActivation(
      new Uint8Array([9]),
      {
        success: false,
        error: { message: 'no stock' },
        commands: [{ type: 'NO_SUCH' }],
        reached: [],
      },
      [],
      []
    );
    expect(answer.outcome.oneofKind).toBe('workflowFailed');
    expect(answer.callsBeforeFailure).toBeUndefined();
  });
});

describe('a task failure loaded from an activation', () => {
  /** What the workflow's code sees when it runs a `charge` task that failed so. */
  function failedStep(stepId: string, errorType: string, code: FailureCode, end: End) {
    return loadActivation(
      activationOf('wf', [
        {
          stepId,
          at: at(2_000),
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'step',
            step: {
              outcome: {
                result: {
                  oneofKind: 'failure',
                  failure: {
                    message: 'it failed',
                    errorType,
                    nonRetryable: false,
                    code,
                    details: new Uint8Array(),
                  },
                },
                end,
                attempts: 2,
              },
            },
          },
        },
      ]),
      'default'
    );
  }

  async function failureSeen(
    errorType: string,
    code: FailureCode,
    end: End = End.FAILED
  ): Promise<WorkflowError> {
    const loaded = failedStep('charge_0', errorType, code, end);
    const error = await loaded.context.executeTask(taskRef('charge'), {}).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(WorkflowError);
    return error as WorkflowError;
  }

  it('carries the type the task failed with', async () => {
    const error = await failureSeen('CardDeclined', FailureCode.APPLICATION);
    expect(error.taskErrorType).toBe('CardDeclined');
    expect(error.taskFailureCode).toBe('application');
    expect(error.isTaskCancelled).toBe(false);
    expect(error.details).toMatchObject({ taskType: 'charge', attempts: 2, reason: 'it failed' });
  });

  it('says a task with the cancelled code was cancelled', async () => {
    const error = await failureSeen('Cancelled', FailureCode.CANCELLED, End.CANCELLED);
    expect(error.taskFailureCode).toBe('cancelled');
    expect(error.isTaskCancelled).toBe(true);
  });

  it('says a failure of type Cancelled with the application code was cancelled', async () => {
    // How sdk-core 0.15.0 records a cancelled task.
    const error = await failureSeen('Cancelled', FailureCode.APPLICATION);
    expect(error.taskFailureCode).toBe('application');
    expect(error.taskErrorType).toBe('Cancelled');
    expect(error.isTaskCancelled).toBe(true);
  });

  it('reads a code it does not know as unspecified', async () => {
    const error = await failureSeen('', 99 as FailureCode);
    expect(error.taskFailureCode).toBe('unspecified');
    expect(error.taskErrorType).toBe('');
    expect(error.isTaskCancelled).toBe(false);
  });

  it('takes a cancellation or a timeout from how the step ended when it has no code', async () => {
    const cancelled = await failureSeen('', FailureCode.UNSPECIFIED, End.CANCELLED);
    expect(cancelled.taskFailureCode).toBe('cancelled');
    expect(cancelled.isTaskCancelled).toBe(true);
    const timedOut = await failureSeen('', FailureCode.UNSPECIFIED, End.TIMED_OUT);
    expect(timedOut.taskFailureCode).toBe('timed_out');
    expect(timedOut.isTaskCancelled).toBe(false);
    // A code, when there is one, wins over how the step ended.
    const coded = await failureSeen('Boom', FailureCode.APPLICATION, End.CANCELLED);
    expect(coded.taskFailureCode).toBe('application');
  });

  it('raises a failed session creation instead of opening a session', async () => {
    const loaded = failedStep(
      `${SESSION_CREATE_TASK}_0`,
      'SessionUnavailable',
      FailureCode.APPLICATION,
      End.FAILED
    );
    const error = await loaded.context.createSession().then(
      (session) => session,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(WorkflowError);
    expect((error as WorkflowError).taskErrorType).toBe('SessionUnavailable');
    expect((error as WorkflowError).details).toMatchObject({
      taskType: SESSION_CREATE_TASK,
      attempts: 2,
      reason: 'it failed',
    });
  });

  it('is undefined on an error that is not a task failure', () => {
    const error = WorkflowError.childWorkflowFailed('child', 'c-1', 'Cancelled');
    expect(error.taskErrorType).toBeUndefined();
    expect(error.taskFailureCode).toBeUndefined();
    expect(error.isTaskCancelled).toBe(false);
  });

  it('defaults a failure built without a type or code', () => {
    const error = WorkflowError.taskFailed('charge', 1, 'boom');
    expect(error.taskErrorType).toBe('');
    expect(error.taskFailureCode).toBe('unspecified');
    expect(error.isTaskCancelled).toBe(false);
  });
});
