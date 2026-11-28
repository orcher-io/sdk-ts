/**
 * The `ChildWorkflowOptions` and `RestartFreshOptions` the package exports are
 * the types the context's calls take, and a child's timeout reaches the
 * kernel whichever way it is given.
 *
 * The package root used to export its own copies, with `executionTimeout`
 * where the calls read `timeout` and a nested `options` object restartFresh
 * never read, so options typed against the export were silently dropped. The
 * type checks run under `npm run type-check:tests`.
 */

import { Worker } from '../worker';
import type { WorkflowContext } from '../../workflow/context';
import type { Command } from '../../core/generated/kernel';
import { Duration } from '../../index';
import type { ChildWorkflowOptions, RestartFreshOptions } from '../../index';
import type {
  ChildWorkflowOptions as SubpathChildWorkflowOptions,
  ContextChildWorkflowOptions,
  RestartFreshOptions as SubpathRestartFreshOptions,
} from '../../workflow';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_proof?: T): void => {};
type Defined<T> = Exclude<T, undefined>;

assertType<
  Equals<ChildWorkflowOptions, Defined<Parameters<WorkflowContext['executeChildWorkflow']>[2]>>
>();
assertType<
  Equals<ChildWorkflowOptions, Defined<Parameters<WorkflowContext['startChildWorkflow']>[2]>>
>();
assertType<Equals<RestartFreshOptions, Defined<Parameters<WorkflowContext['restartFresh']>[1]>>>();
assertType<Equals<ChildWorkflowOptions, SubpathChildWorkflowOptions>>();
assertType<Equals<ChildWorkflowOptions, ContextChildWorkflowOptions>>();
assertType<Equals<RestartFreshOptions, SubpathRestartFreshOptions>>();

// A field from the old restart-fresh copy is a compile error, not a silent drop.
// @ts-expect-error restartFresh takes taskQueue and timeout at the top level
export const nested: RestartFreshOptions = { options: { taskQueue: 'orders-v2' } };

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const at = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 });
let names = 0;

/** The commands a workflow answers with when it runs `flow` on its first activation. */
async function commands(flow: (ctx: WorkflowContext) => Promise<unknown>): Promise<Command[]> {
  const name = `child-options-export-${names++}`;
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
  return answer.outcome.commands.commands as Command[];
}

async function childTimeout(options: ChildWorkflowOptions) {
  const [command] = await commands(async (ctx) => {
    await ctx.startChildWorkflow('charge', {}, options);
  });
  if (command?.what.oneofKind !== 'startChild') throw new Error('expected a child start');
  return command.what.startChild.executionTimeout;
}

describe('ChildWorkflowOptions', () => {
  it('sends a Duration timeout', async () => {
    expect(await childTimeout({ timeout: Duration.fromSeconds(90) })).toEqual(at(90_000));
  });

  it('sends a timeout given in milliseconds', async () => {
    expect(await childTimeout({ timeout: 1_500 })).toEqual(at(1_500));
  });

  it('still honours the deprecated executionTimeout', async () => {
    expect(await childTimeout({ executionTimeout: 2_000 })).toEqual(at(2_000));
  });

  it('prefers timeout over the deprecated executionTimeout', async () => {
    expect(await childTimeout({ timeout: 3_000, executionTimeout: 2_000 })).toEqual(at(3_000));
  });

  it('sends no timeout when neither is set', async () => {
    expect(await childTimeout({})).toBeUndefined();
  });
});
