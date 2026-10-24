/**
 * Runs the engine bound to the kernel's step-id scheme.
 *
 * Such a run names every durable call as the kernel does, `{kind}-{n}` from
 * one counter, names a child started without an id from its history lineage,
 * and draws its random values from the kernel's generator seeded from that
 * lineage. A run under this SDK's own scheme keeps its ids and generator.
 */

import { Worker } from '../worker';
import { ProtocolRefusal, loadActivation } from '../activation';
import { type WorkflowContext } from '../../workflow/context';
import { RunRandom, seedForLineage } from '../../workflow/kernel-random';
import { StepIdScheme, type Resolution, type RunActivation } from '../../core/generated/kernel';
import { taskRef } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const LINEAGE = 'lineage-1';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const json = (value: unknown) => ({
  data: new TextEncoder().encode(JSON.stringify(value)),
  metadata: {},
});
const at = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 });

function activationOf(
  workflowType: string,
  resolutions: Resolution[],
  kernel: { lineage?: string; seed?: Uint8Array } | null = {}
): RunActivation {
  return {
    activationId: new Uint8Array([1]),
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
            input: [json({})],
            attempt: 1,
            startedAt: at(1_000),
            randomSeed: kernel ? (kernel.seed ?? seedForLineage(LINEAGE)) : new Uint8Array(),
            headers: {},
            stepIds: kernel ? StepIdScheme.KERNEL : StepIdScheme.UNSPECIFIED,
            historyLineage: kernel ? (kernel.lineage ?? LINEAGE) : '',
          },
        },
      },
      ...resolutions,
    ],
    queries: [],
  };
}

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

describe("a run under the kernel's step-id scheme", () => {
  it('draws the kernel values for its lineage', () => {
    const ctx = loadActivation(activationOf('w', []), 'default').context;
    const expected = RunRandom.forLineage(LINEAGE);
    expect(ctx.random.uuid()).toBe(expected.uuid());
    expect(ctx.random.random()).toBe(expected.nextF64());
    expect(ctx.random.randomRange(1, 6)).toBe(Number(expected.range(1n, 7n)));
  });

  it('names every call as the kernel names it, numbered as it was named', async () => {
    const worker = workerWith('kernel-ids', async (ctx) => {
      const first = await ctx.executeTask(taskRef('charge'), 1);
      await ctx.execute('note', async () => (first as number) + 1);
      await ctx.startChildWorkflow('ship', 7);
      return ctx.waitForEventWithTimeout('paid', 5_000);
    });
    const answer = await (worker as any).runActivation(
      activationOf('kernel-ids', [
        {
          stepId: 'task-0',
          at: at(2_000),
          replaying: false,
          sequence: '0',
          what: {
            oneofKind: 'step',
            step: {
              outcome: {
                result: { oneofKind: 'value', value: json(1) },
                end: 1,
                attempts: 1,
              },
            },
          },
        },
      ])
    );
    expect(answer.outcome.oneofKind).toBe('commands');
    const named = answer.outcome.commands.commands
      .map((c: any) => [
        Number(c.seq),
        c.what.oneofKind,
        c.what.oneofKind === 'startChild' ? c.what.startChild.workflowId : c.stepId,
      ])
      .sort((a: any[], b: any[]) => a[0] - b[0]);
    expect(named).toEqual([
      [0, 'runTask', 'task-0'],
      [1, 'recordValue', 'value-1'],
      [2, 'startChild', `${LINEAGE}-child-2`],
      [3, 'awaitEvent', 'await-3'],
      [4, 'startTimer', 'timer-4'],
    ]);
  });

  it('is refused without its lineage or a seed of 32 bytes', () => {
    expect(() => loadActivation(activationOf('w', [], { lineage: '' }), 'default')).toThrow(
      ProtocolRefusal
    );
    expect(() =>
      loadActivation(activationOf('w', [], { seed: new Uint8Array(8) }), 'default')
    ).toThrow(ProtocolRefusal);
  });
});

describe("a run under this SDK's own scheme", () => {
  it('keeps its ids', async () => {
    const worker = workerWith('own-ids', async (ctx) => {
      await ctx.executeTask(taskRef('charge'), 1);
    });
    const answer = await (worker as any).runActivation(activationOf('own-ids', [], null));
    expect(answer.outcome.commands.commands.map((c: any) => c.stepId)).toEqual(['charge_0']);
  });
});
