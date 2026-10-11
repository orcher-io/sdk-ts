/**
 * A workflow or task input is one value, and arrives as the handler's one
 * argument after the context, whatever its type: an array is not spread.
 *
 * The client sends one input (`args[0]`), and a workflow schedules a task or a
 * child with one input, so there is no multi-argument encoding to unpack.
 */

import { Worker } from '../worker';
import { TaskExecutor } from '../task-executor';
import type { ExecutionRequest, Logger, TaskDefinition } from '../types';
import type { WorkflowContext } from '../../workflow/context';
import { FakeEngine, bytes, runner, taskRef } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** The input sdk-core sends the engine for a command: its payloads' bytes, joined. */
const sentInput = (payloads: Array<{ data: number[] }>): unknown =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(payloads.flatMap((p) => p.data))));

/** The arguments a workflow receives for the input the engine delivers. */
async function workflowArgs(input: unknown, { omitInput = false } = {}): Promise<unknown[]> {
  let received: unknown[] = [];
  const recorder = async (_ctx: WorkflowContext, ...args: unknown[]) => {
    received = args;
    return null;
  };
  Object.defineProperty(recorder, 'name', { value: 'under_test' });
  const worker = new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'replay',
    workflows: [recorder],
    tasks: [],
    logger: silent,
  });
  const request: any = new FakeEngine(input).request();
  if (omitInput) delete request.jobs[0].StartWorkflow.input;
  const result = await (worker as any).executeWorkflowDirectBindings(request);
  expect(result.successful).toBe(true);
  return received;
}

describe('a single input is a single argument', () => {
  it.each([
    ['an array', [1, 2, 3]],
    ['an array of objects', [{ sku: 'a' }, { sku: 'b' }]],
    ['an empty array', []],
    ['an object', { orderId: 7 }],
    ['zero', 0],
    ['false', false],
    ['an empty string', ''],
  ])('a workflow receives %s as one argument', async (_label, input) => {
    expect(await workflowArgs(input)).toEqual([input]);
  });

  it('a workflow started without input receives no argument', async () => {
    expect(await workflowArgs(null)).toEqual([]);
    expect(await workflowArgs(null, { omitInput: true })).toEqual([]);
  });

  it('a task scheduled with an array is sent that array as its input', async () => {
    const commands = await runner(async (ctx) => ctx.executeTask(taskRef('sum'), [1, 2, 3]))(
      new FakeEngine()
    );

    const scheduled = commands.find((c) => 'ScheduleTask' in c)!['ScheduleTask'];
    expect(sentInput(scheduled.input)).toEqual([1, 2, 3]);
  });

  it('a child started with an array is sent that array as its input', async () => {
    const commands = await runner(async (ctx) => ctx.executeChildWorkflow('child_wf', ['a', 'b']))(
      new FakeEngine()
    );

    const started = commands.find((c) => 'StartChildWorkflow' in c)!['StartChildWorkflow'];
    expect(sentInput(started.input)).toEqual(['a', 'b']);
  });

  it('a task receives an array input as one argument', async () => {
    let received: unknown[] = [];
    const sum: TaskDefinition = async (_ctx: unknown, ...args: unknown[]) => {
      received = args;
      return null;
    };
    Object.defineProperty(sum, 'name', { value: 'sum' });
    const request = (input: unknown): ExecutionRequest => ({
      executionId: 'sum_0',
      type: 'sum',
      input,
      metadata: { workflowId: 'wf', runId: 'run', attempt: 1, taskQueue: 'q', namespace: 'ns' },
    });
    const executor = new TaskExecutor({ logger: silent });

    // As the engine delivers it: the JSON bytes of the input.
    await executor.execute(sum, request(bytes(['x', 'y'])));
    expect(received).toEqual([['x', 'y']]);

    // As a value, the way the session tasks and tests hand it over.
    await executor.execute(sum, request(['x', 'y']));
    expect(received).toEqual([['x', 'y']]);
  });
});
