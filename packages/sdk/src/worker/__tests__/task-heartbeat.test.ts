/**
 * A task's own heartbeats reach the worker, which heartbeats every task on its
 * own, and the engine's request to stop a task reaches its cancellation token.
 */

import { TaskExecutor, type TaskHeartbeatBinding } from '../task-executor';
import { Worker } from '../worker';
import { getNativeModule } from '../../core/native';
import { HeartbeatAnswer, TaskHeartbeat } from '../../core/generated/host';
import type { ExecutionRequest, Logger, TaskDefinition } from '../types';
import type { TaskContext } from '../../task/context';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const logger: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const request: ExecutionRequest = {
  executionId: 'task-1',
  type: 'beating',
  input: {},
  metadata: { workflowId: 'wf', runId: 'run', attempt: 1, taskQueue: 'q', namespace: 'ns' },
};

const named = (fn: TaskDefinition, name: string): TaskDefinition => {
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
};

describe('task heartbeats', () => {
  it('hands the task’s heartbeat details to the worker', async () => {
    const recorded: unknown[] = [];
    const binding: TaskHeartbeatBinding = {
      record: async (details) => {
        recorded.push(details);
        return false;
      },
      cancelled: () => new Promise(() => undefined),
    };
    const task = named(async (ctx: TaskContext) => {
      await ctx.heartbeatWithDetails({ processed: 3 });
      return ctx.isCancelled();
    }, 'beating');

    const result = await new TaskExecutor({ logger }).execute(task, request, binding);

    expect(recorded).toEqual([{ processed: 3 }]);
    expect(result.result).toBe(false);
  });

  it('cancels the task when the engine asks it to stop', async () => {
    const binding: TaskHeartbeatBinding = {
      record: async () => false,
      cancelled: async () => true,
    };
    const task = named(async (ctx: TaskContext) => {
      await ctx.cancellationToken().waitForCancellation();
      return 'stopped';
    }, 'cancellable');

    const result = await new TaskExecutor({ logger }).execute(task, request, binding);

    expect(result.result).toBe('stopped');
  });

  it('sends the worker host an encoded heartbeat and reads its encoded answer', async () => {
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      workflows: [],
      tasks: [named(async () => null, 'beating')],
      logger,
    });
    const sent: TaskHeartbeat[] = [];
    let cancelRequested = false;
    (getNativeModule as jest.Mock).mockReturnValue({
      hostHeartbeat: jest.fn((_host: unknown, heartbeat: Uint8Array) => {
        sent.push(TaskHeartbeat.fromBinary(heartbeat));
        return HeartbeatAnswer.toBinary({ cancelRequested });
      }),
    });
    const token = new TextEncoder().encode('attempt-token');
    const binding: TaskHeartbeatBinding = (worker as any).taskHeartbeatBinding({}, token);

    expect(await binding.record({ processed: 3 })).toBe(false);
    cancelRequested = true;
    expect(await binding.record()).toBe(true);

    expect(sent).toHaveLength(2);
    expect(Buffer.from(sent[0]!.token).toString()).toBe('attempt-token');
    expect(JSON.parse(Buffer.from(sent[0]!.details!.data).toString())).toEqual({ processed: 3 });
    expect(sent[0]!.details!.metadata).toEqual({ encoding: new TextEncoder().encode('json') });
    expect(Buffer.from(sent[1]!.token).toString()).toBe('attempt-token');
    expect(sent[1]!.details).toBeUndefined();
  });
});
