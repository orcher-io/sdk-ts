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
import { TASK_FAILED_SENTINEL_KEY } from '../../errors';
import {
  End,
  type Command,
  type Resolution,
  type RunActivation,
} from '../../core/generated/kernel';
import { taskRef } from './support/fake-engine';

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
          what: { oneofKind: 'timer', timer: {} },
        },
        {
          stepId: '',
          at: at(5_000),
          replaying: false,
          what: {
            oneofKind: 'event',
            event: { eventId: '9', name: 'go', payload: json({ ok: true }) },
          },
        },
        {
          stepId: '',
          at: at(6_000),
          replaying: false,
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
    expect(answer.outcome.workflowFailed.nonRetryable).toBe(true);
  });

  it('answers a workflow it does not know with a workflow failure', async () => {
    const worker = workerWith('known', async () => null);
    const answer = await (worker as any).runActivation(activationOf('unknown', []));
    expect(answer.outcome.oneofKind).toBe('workflowFailed');
    expect(answer.outcome.workflowFailed.message).toBe('Workflow not registered: unknown');
  });
});
