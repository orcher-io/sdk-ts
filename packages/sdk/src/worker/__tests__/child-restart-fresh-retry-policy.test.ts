/**
 * A child workflow's and a restart-fresh's retry policy reach the kernel.
 *
 * `executeChildWorkflow`, `startChildWorkflow` and `restartFresh` take a
 * `retryPolicy` with the same meaning as a workflow start's: `maxAttempts`
 * counts the first run, 0 retries without limit, and leaving it out allows 3.
 * Left unset, no policy is sent.
 */

import { Worker } from '../worker';
import type { WorkflowContext } from '../../workflow/context';
import type { RetryPolicy } from '../../workflow/types';
import type { Command, RetryPolicy as KernelRetryPolicy } from '../../core/generated/kernel';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const at = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 });
let names = 0;

/**
 * The retry policy on each child start and restart-fresh a workflow answers
 * with, in order, when it runs `flow` on its first activation.
 */
async function issued(
  flow: (ctx: WorkflowContext) => Promise<unknown>
): Promise<Array<[string, KernelRetryPolicy | undefined]>> {
  const name = `child-retry-policy-${names++}`;
  const run = async (ctx: WorkflowContext) => flow(ctx);
  Object.defineProperty(run, 'name', { value: name });
  const worker = new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'orders',
    workflows: [run],
    tasks: [],
    logger: silent,
  });
  const answer = await (worker as any).runActivation({
    activationId: new Uint8Array([1]),
    run: {
      workflowId: 'order-7',
      runId: 'run-1',
      workflowType: name,
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
            input: [],
            attempt: 1,
            startedAt: at(1_000),
            randomSeed: new Uint8Array(),
            headers: {},
            stepIds: 0,
            historyLineage: '',
          },
        },
      },
    ],
    queries: [],
  });
  expect(answer.outcome.oneofKind).toBe('commands');
  return (answer.outcome.commands.commands as Command[]).flatMap((c) => {
    const what = c.what;
    if (what.oneofKind === 'startChild') return [['startChild', what.startChild.retryPolicy]];
    if (what.oneofKind === 'restartFresh') return [['restartFresh', what.restartFresh.retryPolicy]];
    return [];
  });
}

/** Starts a child, then restarts fresh, each with the given policy. */
const startAndRestart =
  (child: Partial<RetryPolicy> | undefined, restart: Partial<RetryPolicy> | undefined) =>
  async (ctx: WorkflowContext) => {
    await ctx.startChildWorkflow('ship', {}, { retryPolicy: child });
    ctx.restartFresh({ next: 1 }, { retryPolicy: restart });
    return null;
  };

describe('a child workflow and a restart-fresh retry policy', () => {
  it('reach the kernel commands as a workflow start sends them', async () => {
    const policy: Partial<RetryPolicy> = {
      maxAttempts: 2,
      initialInterval: 1_500,
      maxInterval: 9_000,
      backoffCoefficient: 1.5,
      nonRetryableErrorTypes: ['Declined'],
    };
    const expected = {
      maxAttempts: 2,
      firstDelay: { seconds: '1', nanos: 500_000_000 },
      maxDelay: { seconds: '9', nanos: 0 },
      delayMultiplier: 1.5,
      neverRetryTypes: ['Declined'],
    };
    expect(await issued(startAndRestart(policy, policy))).toEqual([
      ['startChild', expected],
      ['restartFresh', expected],
    ]);
  });

  it('is carried by executeChildWorkflow', async () => {
    const sent = await issued(async (ctx) =>
      ctx.executeChildWorkflow('ship', {}, { retryPolicy: { maxAttempts: 4 } })
    );
    expect(sent.map(([kind, p]) => [kind, p?.maxAttempts])).toEqual([['startChild', 4]]);
  });

  it.each([
    ['an omitted count as the documented default', { initialInterval: 2_000 }, 3],
    ['an explicit 0 as unlimited', { maxAttempts: 0 }, 0],
  ])('sends %s', async (_, policy, count) => {
    const sent = await issued(startAndRestart(policy, policy));
    expect(sent.map(([kind, p]) => [kind, p?.maxAttempts])).toEqual([
      ['startChild', count],
      ['restartFresh', count],
    ]);
  });

  it('leaves an omitted interval and backoff to the engine and the start defaults', async () => {
    const sent = await issued(startAndRestart({ maxAttempts: 2 }, { maxAttempts: 2 }));
    for (const [, p] of sent) {
      expect(p?.firstDelay).toBeUndefined();
      expect(p?.maxDelay).toBeUndefined();
      expect(p?.delayMultiplier).toBe(2);
      expect(p?.neverRetryTypes).toEqual([]);
    }
  });

  it('is not sent when unset', async () => {
    expect(await issued(startAndRestart(undefined, undefined))).toEqual([
      ['startChild', undefined],
      ['restartFresh', undefined],
    ]);
  });
});
