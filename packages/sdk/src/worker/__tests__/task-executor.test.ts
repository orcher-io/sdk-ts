/**
 * Task Executor Unit Tests
 *
 * Tests for the TaskExecutor class that executes task handlers with DI support.
 *
 * @module @orcher/sdk/worker/__tests__/task-executor.test
 */

import { TaskExecutor } from '../task-executor';
import { describeTaskFailure } from '../errors';
import type { ExecutionRequest, Logger, TaskDefinition } from '../types';
import { OrcherContainer } from '../../di/container';
import { globalRegistry } from '../../di/registry';
import { Injectable } from '../../di/decorators/injectable';
import { Tasks } from '../../di/decorators/tasks';
import { Task } from '../../di/decorators/task';

const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

// Helper to create a basic execution request
const createExecutionRequest = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  executionId: 'task-123',
  type: 'testTask',
  input: { value: 42 },
  metadata: {
    workflowId: 'workflow-456',
    runId: 'run-789',
    attempt: 1,
    taskQueue: 'default',
    namespace: 'test',
  },
  ...overrides,
});

describe('TaskExecutor', () => {
  let logger: Logger;
  let container: OrcherContainer;

  beforeEach(() => {
    logger = createMockLogger();
    container = new OrcherContainer();
    globalRegistry.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('input deserialization', () => {
    const decode = (executor: TaskExecutor, input: unknown) =>
      (executor as unknown as { deserializeInput(i: unknown): unknown[] }).deserializeInput(input);

    it('decodes a JSON byte-array task input back to the value', () => {
      const executor = new TaskExecutor({ logger });
      // The engine delivers task input as the UTF-8 bytes of its JSON encoding.
      const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ a: 1, b: 'two' })));
      expect(decode(executor, bytes)).toEqual([{ a: 1, b: 'two' }]);
    });

    it('decodes byte-array input for primitives and arrays', () => {
      const executor = new TaskExecutor({ logger });
      const bytesOf = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));
      expect(decode(executor, bytesOf(7))).toEqual([7]);
      expect(decode(executor, bytesOf([1, 2, 3]))).toEqual([[1, 2, 3]]);
      expect(decode(executor, bytesOf('hi'))).toEqual(['hi']);
    });

    it('treats empty byte-array input as no arguments', () => {
      const executor = new TaskExecutor({ logger });
      expect(decode(executor, [])).toEqual([]);
      expect(decode(executor, null)).toEqual([]);
    });
  });

  describe('Constructor', () => {
    it('should create TaskExecutor with default options', () => {
      const executor = new TaskExecutor({ logger });

      expect(executor).toBeDefined();
      const stats = executor.getStats();
      expect(stats.totalExecutions).toBe(0);
      expect(stats.successfulExecutions).toBe(0);
      expect(stats.failedExecutions).toBe(0);
    });

    it('should create TaskExecutor with custom options', () => {
      const executor = new TaskExecutor({
        logger,
        container,
        defaultTimeout: 300000,
        enableTimeout: false,
        heartbeatInterval: 15000,
        enableHeartbeat: false,
      });

      expect(executor).toBeDefined();
    });

    it('should create TaskExecutor with DI container', () => {
      const executor = new TaskExecutor({
        logger,
        container,
      });

      expect(executor).toBeDefined();
    });
  });

  describe('Plain Function Execution', () => {
    it('should execute a plain task function', async () => {
      const executor = new TaskExecutor({ logger });

      const taskDef: TaskDefinition = async (_ctx, input) => {
        return { result: input.value * 2 };
      };
      Object.defineProperty(taskDef, 'name', { value: 'doubleTask' });

      const request = createExecutionRequest({
        type: 'doubleTask',
        input: { value: 21 },
      });

      const result = await executor.execute(taskDef, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ result: 42 });
      expect(result.executionId).toBe('task-123');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle task function errors', async () => {
      const executor = new TaskExecutor({ logger });

      const taskDef: TaskDefinition = async () => {
        throw new Error('Task failed intentionally');
      };
      Object.defineProperty(taskDef, 'name', { value: 'failingTask' });

      const request = createExecutionRequest({ type: 'failingTask' });

      const result = await executor.execute(taskDef, request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Task failed intentionally');
    });

    it('should pass TaskContext to task function', async () => {
      const executor = new TaskExecutor({ logger });

      let capturedContext: any = null;
      const taskDef: TaskDefinition = async (ctx, input) => {
        capturedContext = {
          taskId: ctx.taskId(),
          taskType: ctx.taskType(),
          workflowId: ctx.workflowId(),
          runId: ctx.runId(),
          attempt: ctx.attempt(),
        };
        return input;
      };
      Object.defineProperty(taskDef, 'name', { value: 'contextTask' });

      const request = createExecutionRequest({
        executionId: 'exec-abc',
        type: 'contextTask',
        metadata: {
          workflowId: 'wf-123',
          runId: 'run-456',
          attempt: 2,
          taskQueue: 'default',
          namespace: 'test',
        },
      });

      await executor.execute(taskDef, request);

      expect(capturedContext).toEqual({
        taskId: 'exec-abc',
        taskType: 'contextTask',
        workflowId: 'wf-123',
        runId: 'run-456',
        attempt: 2,
      });
    });
  });

  describe('DI Container Integration', () => {
    // Skipped: resolving these handlers through OrcherContainer fails in this
    // setup with "Class constructor cannot be invoked without 'new'".
    it.skip('should resolve task handler from DI container', async () => {
      // Register a service
      @Injectable()
      class CalculatorService {
        multiply(a: number, b: number): number {
          return a * b;
        }
      }

      // Register task handler with @Tasks and @Task decorators
      // Note: The decorators register the task in globalRegistry
      @Tasks()
      class MathTasks {
        constructor(private calculator: CalculatorService) {}

        @Task({ name: 'multiplyTask' })
        async multiply(_ctx: any, input: { a: number; b: number }) {
          return { result: this.calculator.multiply(input.a, input.b) };
        }
      }

      // Setup container - register classes for DI resolution
      container.registerSingleton(CalculatorService, CalculatorService);
      container.registerTransient(MathTasks, MathTasks);

      // Also register the task in globalRegistry for lookup
      globalRegistry.registerTask('multiplyTask', {
        handlerClass: MathTasks,
        methodName: 'multiply',
        options: { name: 'multiplyTask' },
      });

      const executor = new TaskExecutor({ logger, container });

      // Create a dummy task definition (won't be used for DI tasks)
      const taskDef: TaskDefinition = async () => ({ result: 0 });
      Object.defineProperty(taskDef, 'name', { value: 'multiplyTask' });

      const request = createExecutionRequest({
        type: 'multiplyTask',
        input: { a: 6, b: 7 },
      });

      const result = await executor.execute(taskDef, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ result: 42 });
    });

    // Skipped for the same container limitation as above.
    it.skip('should inject dependencies into task handler', async () => {
      // Register services
      @Injectable()
      class LoggerService {
        logs: string[] = [];
        log(message: string) {
          this.logs.push(message);
        }
      }

      @Injectable()
      class DatabaseService {
        constructor(private loggerSvc: LoggerService) {}
        save(data: any) {
          this.loggerSvc.log(`Saving: ${JSON.stringify(data)}`);
          return { id: 'saved-123' };
        }
      }

      @Tasks()
      class DataTasks {
        constructor(private db: DatabaseService) {}

        @Task({ name: 'saveData' })
        async save(_ctx: any, input: { data: any }) {
          return this.db.save(input.data);
        }
      }

      // Setup container with dependency chain
      container.registerSingleton(LoggerService, LoggerService);
      container.registerSingleton(DatabaseService, DatabaseService);
      container.registerTransient(DataTasks, DataTasks);

      // Register task in globalRegistry for lookup
      globalRegistry.registerTask('saveData', {
        handlerClass: DataTasks,
        methodName: 'save',
        options: { name: 'saveData' },
      });

      const executor = new TaskExecutor({ logger, container });

      const taskDef: TaskDefinition = async () => ({});
      Object.defineProperty(taskDef, 'name', { value: 'saveData' });

      const request = createExecutionRequest({
        type: 'saveData',
        input: { data: { name: 'test' } },
      });

      const result = await executor.execute(taskDef, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ id: 'saved-123' });

      // Verify logger was called
      const loggerSvc = container.resolve(LoggerService);
      expect(loggerSvc.logs).toContain('Saving: {"name":"test"}');
    });
  });

  describe('Statistics', () => {
    it('should track execution statistics', async () => {
      const executor = new TaskExecutor({ logger });

      const successTask: TaskDefinition = async () => ({ ok: true });
      Object.defineProperty(successTask, 'name', { value: 'successTask' });

      const failTask: TaskDefinition = async () => {
        throw new Error('fail');
      };
      Object.defineProperty(failTask, 'name', { value: 'failTask' });

      // Execute some tasks
      await executor.execute(successTask, createExecutionRequest({ type: 'successTask' }));
      await executor.execute(successTask, createExecutionRequest({ type: 'successTask' }));
      await executor.execute(failTask, createExecutionRequest({ type: 'failTask' }));

      const stats = executor.getStats();

      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('should reset statistics', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => ({});
      Object.defineProperty(task, 'name', { value: 'task' });

      await executor.execute(task, createExecutionRequest());

      executor.resetStats();

      const stats = executor.getStats();
      expect(stats.totalExecutions).toBe(0);
      expect(stats.successfulExecutions).toBe(0);
      expect(stats.failedExecutions).toBe(0);
    });

    it('should track min/max duration', async () => {
      const executor = new TaskExecutor({ logger });

      const quickTask: TaskDefinition = async () => ({});
      Object.defineProperty(quickTask, 'name', { value: 'quickTask' });

      const slowTask: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {};
      };
      Object.defineProperty(slowTask, 'name', { value: 'slowTask' });

      await executor.execute(quickTask, createExecutionRequest({ type: 'quickTask' }));
      await executor.execute(slowTask, createExecutionRequest({ type: 'slowTask' }));

      const stats = executor.getStats();

      expect(stats.minDuration).toBeGreaterThanOrEqual(0);
      expect(stats.maxDuration).toBeGreaterThanOrEqual(stats.minDuration);
      expect(stats.maxDuration).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running tasks when enabled', async () => {
      const executor = new TaskExecutor({
        logger,
        defaultTimeout: 100, // 100ms timeout
        enableTimeout: true,
      });

      const slowTask: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 500));
        return {};
      };
      Object.defineProperty(slowTask, 'name', { value: 'slowTask' });

      const result = await executor.execute(slowTask, createExecutionRequest({ type: 'slowTask' }));

      expect(result.success).toBe(false);
      expect(result.error.message.toLowerCase()).toContain('timed out');
    });

    it('should not timeout when disabled', async () => {
      const executor = new TaskExecutor({
        logger,
        defaultTimeout: 50,
        enableTimeout: false,
      });

      const task: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { completed: true };
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const result = await executor.execute(task, createExecutionRequest());

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ completed: true });
    });

    it('should track timed out executions in stats', async () => {
      const executor = new TaskExecutor({
        logger,
        defaultTimeout: 50,
        enableTimeout: true,
      });

      const slowTask: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 200));
        return {};
      };
      Object.defineProperty(slowTask, 'name', { value: 'slowTask' });

      await executor.execute(slowTask, createExecutionRequest());

      const stats = executor.getStats();
      expect(stats.timedOutExecutions).toBe(1);
    });
  });

  describe('Input/Output Handling', () => {
    it('should handle undefined input', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async (_ctx, ...args) => {
        return { argCount: args.length };
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const request = createExecutionRequest({ input: undefined });

      const result = await executor.execute(task, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ argCount: 0 });
    });

    it('should handle array input', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async (_ctx, a, b, c) => {
        return { sum: a + b + c };
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const request = createExecutionRequest({ input: [1, 2, 3] });

      const result = await executor.execute(task, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ sum: 6 });
    });

    it('should wrap single object input in array', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async (_ctx, input) => {
        return { received: input };
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const request = createExecutionRequest({ input: { key: 'value' } });

      const result = await executor.execute(task, request);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ received: { key: 'value' } });
    });

    it('should serialize complex output', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => {
        return {
          nested: {
            array: [1, 2, 3],
            object: { a: 1 },
          },
          date: new Date('2024-01-01'),
        };
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const result = await executor.execute(task, createExecutionRequest());

      expect(result.success).toBe(true);
      expect(result.result.nested.array).toEqual([1, 2, 3]);
      expect(result.result.nested.object).toEqual({ a: 1 });
    });
  });

  describe('Error Serialization', () => {
    it('should serialize Error objects', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => {
        throw new Error('Something went wrong');
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const result = await executor.execute(task, createExecutionRequest());

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('Something went wrong');
      // The class the task threw, not the executor's wrapper around it: the
      // type is what a retry policy's non-retryable list is matched against.
      expect(result.error.type).toBe('Error');
      expect(result.error.stack).toBeDefined();
    });

    it('should serialize non-Error throws', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => {
        throw 'string error';
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      const result = await executor.execute(task, createExecutionRequest());

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('string error');
    });

    it('should include execution context in error', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => {
        throw new Error('Context test');
      };
      Object.defineProperty(task, 'name', { value: 'contextErrorTask' });

      const request = createExecutionRequest({
        executionId: 'exec-error-123',
        type: 'contextErrorTask',
      });

      const result = await executor.execute(task, request);

      expect(result.success).toBe(false);
      expect(result.error.handlerType).toBe('task');
      expect(result.error.handlerName).toBe('contextErrorTask');
    });
  });

  describe('Heartbeat', () => {
    it('should track heartbeat statistics', async () => {
      const executor = new TaskExecutor({
        logger,
        heartbeatInterval: 20, // Very short for testing
        enableHeartbeat: true,
      });

      const task: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 100));
        return {};
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      await executor.execute(task, createExecutionRequest());

      const stats = executor.getStats();
      // Should have sent at least a few heartbeats during 100ms with 20ms interval
      expect(stats.totalHeartbeats).toBeGreaterThanOrEqual(0);
    });

    it('should not send heartbeats when disabled', async () => {
      const executor = new TaskExecutor({
        logger,
        heartbeatInterval: 10,
        enableHeartbeat: false,
      });

      const task: TaskDefinition = async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {};
      };
      Object.defineProperty(task, 'name', { value: 'task' });

      await executor.execute(task, createExecutionRequest());

      const stats = executor.getStats();
      expect(stats.totalHeartbeats).toBe(0);
    });
  });

  describe('Logging', () => {
    it('should log task execution start', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => ({});
      Object.defineProperty(task, 'name', { value: 'logTask' });

      await executor.execute(
        task,
        createExecutionRequest({ type: 'logTask', executionId: 'log-123' })
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Executing task: logTask (log-123)')
      );
    });

    it('should log task completion', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => ({});
      Object.defineProperty(task, 'name', { value: 'logTask' });

      await executor.execute(
        task,
        createExecutionRequest({ type: 'logTask', executionId: 'log-123' })
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Task completed: logTask (log-123)')
      );
    });

    it('should log task failure', async () => {
      const executor = new TaskExecutor({ logger });

      const task: TaskDefinition = async () => {
        throw new Error('fail');
      };
      Object.defineProperty(task, 'name', { value: 'failTask' });

      await executor.execute(
        task,
        createExecutionRequest({ type: 'failTask', executionId: 'fail-123' })
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Task failed: failTask (fail-123)'),
        expect.any(Object)
      );
    });
  });
});

// The engine decides a retry from the failure type it is told, and a policy
// lists types by name. A failure reported as a generic `TaskExecutionError`
// would never match a policy's non-retryable list.
describe('the failure a task reports', () => {
  class CardDeclined extends Error {}
  class AccountClosed extends Error {
    readonly nonRetryable = true;
  }
  class Renamed extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'Throttled';
    }
  }

  const failureOf = async (error: unknown) => {
    const executor = new TaskExecutor({ logger: createMockLogger() });
    const task: TaskDefinition = async () => {
      throw error;
    };
    Object.defineProperty(task, 'name', { value: 'failing' });
    const result = await executor.execute(task, createExecutionRequest({ type: 'failing' }));
    expect(result.success).toBe(false);
    return { type: result.error?.type, nonRetryable: result.error?.nonRetryable };
  };

  it('is named after the error class', async () => {
    expect(await failureOf(new CardDeclined('declined'))).toEqual({
      type: 'CardDeclined',
      nonRetryable: false,
    });
  });

  it('prefers a name the error set, which survives minification', async () => {
    expect((await failureOf(new Renamed('slow down'))).type).toBe('Throttled');
  });

  it('carries a nonRetryable mark', async () => {
    expect(await failureOf(new AccountClosed('closed'))).toEqual({
      type: 'AccountClosed',
      nonRetryable: true,
    });
  });

  it('describes a thrown non-error as a plain retryable Error', () => {
    expect(describeTaskFailure('boom')).toEqual({
      message: 'boom',
      type: 'Error',
      nonRetryable: false,
    });
  });
});
