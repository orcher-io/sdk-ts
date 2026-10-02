/**
 * A task's own heartbeats reach the worker, which heartbeats every task on its
 * own, and the engine's request to stop a task reaches its cancellation token.
 */

import { TaskExecutor, type TaskHeartbeatBinding } from '../task-executor';
import type { ExecutionRequest, Logger, TaskDefinition } from '../types';
import type { TaskContext } from '../../task/context';

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
});
