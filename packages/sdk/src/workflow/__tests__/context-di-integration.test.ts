/**
 * Integration tests for WorkflowContext and the DI container.
 *
 * Covers TaskReference execution with dependency injection.
 *
 * A workflow never runs a task inline, even when a container is at hand: the
 * context only schedules the task named by its TaskReference and suspends, a
 * task worker resolves the handler class from its container and runs the
 * method, and the workflow picks the journaled result up on replay. These tests
 * therefore drive both halves — `WorkflowContext.executeTask` for scheduling and
 * replay, `TaskExecutor` with a container for the dependency injection — and
 * join them the way the worker does, by task name.
 *
 * @module @orcher/sdk/workflow/__tests__/context-di-integration
 */

import { WorkflowContext, WorkflowCommandType } from '../context';
import { OrcherContainer } from '../../di/container';
import { Injectable } from '../../di/decorators/injectable';
import { Tasks } from '../../di/decorators/tasks';
import { Task } from '../../di/decorators/task';
import { globalRegistry as diGlobalRegistry } from '../../di/registry';
import { createTaskRefs } from '../../di/types';
import { TaskContext } from '../../task/context';
import { TaskExecutor } from '../../worker/task-executor';
import { WorkflowError, ErrorCode } from '../../errors';
import type { TaskReference } from '../../di/types';
import type { ExecutionRequest, Logger, TaskDefinition } from '../../worker/types';

const execution = {
  workflowId: 'wf-123',
  runId: 'run-123',
  workflowType: 'test-workflow',
  attempt: 1,
  namespace: 'default',
  taskQueue: 'test-queue',
};

const createLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

function createWorkflowContext(replaying = false): WorkflowContext {
  return new WorkflowContext(execution, replaying, '1.0.0', Date.now());
}

/**
 * Call `executeTask` and return the SCHEDULE_TASK command it emitted, asserting
 * that the workflow suspended rather than running the task itself.
 */
async function scheduleTask<I>(ctx: WorkflowContext, ref: TaskReference<I, any>, input: I) {
  let thrown: unknown;
  try {
    await ctx.executeTask(ref, input);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(WorkflowError);
  expect((thrown as WorkflowError).code).toBe(ErrorCode.WORKFLOW_SUSPENDED);

  const commands = ctx.takeCommands();
  expect(commands).toHaveLength(1);
  const command = commands[0]!;
  expect(command.type).toBe(WorkflowCommandType.SCHEDULE_TASK);
  return command as any;
}

/**
 * Run a scheduled task the way a task worker does: the request carries only
 * the task name and input, and the executor finds the handler class through
 * the registry and resolves it from its container.
 */
function runScheduledTask(executor: TaskExecutor, command: any) {
  const taskDef: TaskDefinition = async () => {
    throw new Error('a DI-managed task must run through its handler class, not this fallback');
  };
  Object.defineProperty(taskDef, 'name', { value: command.taskType });

  const request: ExecutionRequest = {
    executionId: command.taskId,
    type: command.taskType,
    input: command.input,
    metadata: {
      workflowId: execution.workflowId,
      runId: execution.runId,
      attempt: 1,
      taskQueue: command.taskQueue,
      namespace: execution.namespace,
    },
  };
  return executor.execute(taskDef, request);
}

describe('WorkflowContext DI Integration', () => {
  let container: OrcherContainer;
  let executor: TaskExecutor;

  beforeEach(() => {
    diGlobalRegistry.clear();
    container = new OrcherContainer();
    executor = new TaskExecutor({ logger: createLogger(), container });
  });

  afterEach(() => {
    diGlobalRegistry.clear();
  });

  describe('Constructor', () => {
    it('should create a context from the execution alone', () => {
      const ctx = createWorkflowContext();

      expect(ctx).toBeInstanceOf(WorkflowContext);
      expect(ctx.workflowId()).toBe('wf-123');
      expect(ctx.taskQueue()).toBe('test-queue');
    });
  });

  describe('executeTask with TaskReference', () => {
    it('should execute task with DI when TaskReference is provided', async () => {
      @Injectable()
      class LoggerService {
        logs: string[] = [];

        log(message: string) {
          this.logs.push(message);
        }
      }

      @Injectable()
      @Tasks()
      class TestTasks {
        constructor(private logger: LoggerService) {}

        @Task()
        async execute(_ctx: TaskContext, input: { value: string }): Promise<{ result: string }> {
          this.logger.log(`Processing: ${input.value}`);
          return { result: `Processed: ${input.value}` };
        }
      }
      const testTasks = createTaskRefs(TestTasks);

      container.registerSingleton(LoggerService);
      container.registerTransient(TestTasks);

      // The workflow schedules the task by name and suspends.
      const command = await scheduleTask(createWorkflowContext(), testTasks.execute, {
        value: 'test-data',
      });
      expect(command.taskType).toBe('execute');
      expect(command.input).toEqual({ value: 'test-data' });

      // The task worker runs it with the injected service.
      const result = await runScheduledTask(executor, command);
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ result: 'Processed: test-data' });

      const logger = container.resolve(LoggerService);
      expect(logger.logs).toContain('Processing: test-data');

      // On replay the workflow receives exactly what the task returned.
      const replay = createWorkflowContext(true);
      replay.injectStepResult(command.taskId, result.result);
      await expect(replay.executeTask(testTasks.execute, { value: 'test-data' })).resolves.toEqual(
        { result: 'Processed: test-data' }
      );
    });

    it('should resolve dependencies for task handlers', async () => {
      @Injectable()
      class DatabaseService {
        data: Record<string, any> = {};

        save(key: string, value: any) {
          this.data[key] = value;
        }

        get(key: string) {
          return this.data[key];
        }
      }

      @Injectable()
      @Tasks()
      class DataTasks {
        constructor(private db: DatabaseService) {}

        @Task()
        async saveData(_ctx: TaskContext, input: { key: string; value: any }) {
          this.db.save(input.key, input.value);
          return { saved: true };
        }

        @Task()
        async getData(_ctx: TaskContext, input: { key: string }) {
          return { value: this.db.get(input.key) };
        }
      }
      const dataTasks = createTaskRefs(DataTasks);

      container.registerSingleton(DatabaseService);
      container.registerTransient(DataTasks);

      const ctx = createWorkflowContext();

      const save = await scheduleTask(ctx, dataTasks.saveData, {
        key: 'user',
        value: { name: 'Alice' },
      });
      expect((await runScheduledTask(executor, save)).result).toEqual({ saved: true });

      // Two tasks on the same handler class see the same singleton service.
      const get = await scheduleTask(ctx, dataTasks.getData, { key: 'user' });
      const result = await runScheduledTask(executor, get);

      expect(result.success).toBe(true);
      expect(result.result.value).toEqual({ name: 'Alice' });
    });

    it('should handle multiple dependencies', async () => {
      @Injectable()
      class LoggerService {
        logs: string[] = [];
        log(msg: string) {
          this.logs.push(msg);
        }
      }

      @Injectable()
      class ConfigService {
        config = { timeout: 5000 };
        getTimeout() {
          return this.config.timeout;
        }
      }

      @Injectable()
      class MetricsService {
        metrics: Record<string, number> = {};
        increment(key: string) {
          this.metrics[key] = (this.metrics[key] || 0) + 1;
        }
      }

      @Injectable()
      @Tasks()
      class ComplexTasks {
        constructor(
          private logger: LoggerService,
          private config: ConfigService,
          private metrics: MetricsService
        ) {}

        @Task()
        async complexTask(_ctx: TaskContext, input: { action: string }) {
          this.logger.log(`Action: ${input.action}`);
          this.metrics.increment('tasks_executed');
          return {
            action: input.action,
            timeout: this.config.getTimeout(),
            executed: true,
          };
        }
      }
      const complexTasks = createTaskRefs(ComplexTasks);

      container.registerSingleton(LoggerService);
      container.registerSingleton(ConfigService);
      container.registerSingleton(MetricsService);
      container.registerTransient(ComplexTasks);

      const command = await scheduleTask(createWorkflowContext(), complexTasks.complexTask, {
        action: 'process',
      });
      const result = await runScheduledTask(executor, command);

      expect(result.result).toEqual({
        action: 'process',
        timeout: 5000,
        executed: true,
      });

      const logger = container.resolve(LoggerService);
      const metrics = container.resolve(MetricsService);

      expect(logger.logs).toContain('Action: process');
      expect(metrics.metrics['tasks_executed']).toBe(1);
    });

    it('should create new task handler instance per execution (transient)', async () => {
      let instances = 0;

      @Injectable()
      @Tasks()
      class TransientTasks {
        instanceId = ++instances;

        @Task()
        async transientTask(_ctx: TaskContext) {
          return { instanceId: this.instanceId };
        }
      }
      const transientTasks = createTaskRefs(TransientTasks);

      container.registerTransient(TransientTasks);

      const ctx = createWorkflowContext();
      const first = await scheduleTask(ctx, transientTasks.transientTask, undefined as any);
      const second = await scheduleTask(ctx, transientTasks.transientTask, undefined as any);

      // Each call is its own step, so the two results are journaled separately.
      expect(first.taskId).not.toBe(second.taskId);

      const result1 = await runScheduledTask(executor, first);
      const result2 = await runScheduledTask(executor, second);

      // Different instances should have different IDs
      expect(result1.result.instanceId).not.toBe(result2.result.instanceId);
    });

    it('should use singleton service across multiple task executions', async () => {
      @Injectable()
      class CounterService {
        count = 0;

        increment() {
          return ++this.count;
        }
      }

      @Injectable()
      @Tasks()
      class CounterTasks {
        constructor(private counter: CounterService) {}

        @Task()
        async increment(_ctx: TaskContext) {
          return { count: this.counter.increment() };
        }
      }
      const counterTasks = createTaskRefs(CounterTasks);

      container.registerSingleton(CounterService);
      container.registerTransient(CounterTasks);

      const ctx = createWorkflowContext();
      const counts: number[] = [];
      for (let i = 0; i < 3; i++) {
        const command = await scheduleTask(ctx, counterTasks.increment, undefined as any);
        counts.push((await runScheduledTask(executor, command)).result.count);
      }

      // Same singleton service should increment across calls
      expect(counts).toEqual([1, 2, 3]);
    });
  });

  describe('TaskReference Type Guard', () => {
    it('should detect TaskReference objects', async () => {
      @Injectable()
      @Tasks()
      class TestTasks {
        @Task()
        async execute(_ctx: TaskContext, input: string) {
          return { input };
        }
      }

      container.registerTransient(TestTasks);

      // TaskReference should have required properties
      const taskRef = createTaskRefs(TestTasks).execute as TaskReference<string, { input: string }>;
      expect(taskRef.taskName).toBe('execute');
      expect(taskRef.handlerClass).toBe(TestTasks);
      expect(taskRef.methodName).toBe('execute');

      // Should schedule and execute successfully
      const command = await scheduleTask(createWorkflowContext(), taskRef, 'test-input');
      const result = await runScheduledTask(executor, command);
      expect(result.result.input).toBe('test-input');
    });

    it('should reject values that are not TaskReferences', async () => {
      const ctx = createWorkflowContext();

      // A bare function does not name a task, so nothing may be scheduled.
      const legacyTask = async (_ctx: TaskContext, input: string) => ({
        result: input.toUpperCase(),
      });

      await expect(ctx.executeTask(legacyTask as any, 'test')).rejects.toThrow(
        'executeTask requires a TaskReference'
      );
      expect(ctx.takeCommands()).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error if method not found on handler', async () => {
      @Injectable()
      @Tasks()
      class TestTasks {}

      container.registerTransient(TestTasks);

      // A reference to a method the class does not have, registered under its
      // task name the way @Task would have registered a real one.
      const fakeRef: TaskReference<any, any> = {
        taskName: 'fake-task',
        handlerClass: TestTasks,
        methodName: 'nonExistentMethod',
      };
      diGlobalRegistry.registerTask('fake-task', {
        name: 'fake-task',
        handlerClass: TestTasks,
        methodName: 'nonExistentMethod',
      });

      const command = await scheduleTask(createWorkflowContext(), fakeRef, {});
      const result = await runScheduledTask(executor, command);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Method nonExistentMethod not found on TestTasks');
    });

    it('should handle task execution errors', async () => {
      @Injectable()
      @Tasks()
      class FailingTasks {
        @Task()
        async failingTask(_ctx: TaskContext) {
          throw new Error('Task execution failed');
        }
      }
      const failingTasks = createTaskRefs(FailingTasks);

      container.registerTransient(FailingTasks);

      const command = await scheduleTask(
        createWorkflowContext(),
        failingTasks.failingTask,
        undefined as any
      );
      const result = await runScheduledTask(executor, command);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Task execution failed');
    });

    it('should report a handler class missing from the container', async () => {
      @Injectable()
      @Tasks()
      class UnregisteredTasks {
        @Task()
        async unregistered(_ctx: TaskContext) {
          return { success: true };
        }
      }
      const unregisteredTasks = createTaskRefs(UnregisteredTasks);

      // Scheduling needs no container at all: the workflow only names the task.
      const command = await scheduleTask(
        createWorkflowContext(),
        unregisteredTasks.unregistered,
        undefined as any
      );
      expect(command.taskType).toBe('unregistered');

      // The worker whose container lacks the class fails the task instead of
      // running it without its dependencies.
      const bareExecutor = new TaskExecutor({
        logger: createLogger(),
        container: new OrcherContainer(),
      });
      const result = await runScheduledTask(bareExecutor, command);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Cannot resolve dependency: UnregisteredTasks');
    });
  });

  describe('Type Safety', () => {
    it('should preserve input/output types with TaskReference', async () => {
      type ProcessInput = { orderId: string; amount: number };
      type ProcessOutput = { success: boolean; transactionId: string };

      @Injectable()
      @Tasks()
      class OrderTasks {
        @Task()
        async processOrder(_ctx: TaskContext, input: ProcessInput): Promise<ProcessOutput> {
          return {
            success: true,
            transactionId: `txn-${input.orderId}`,
          };
        }
      }
      const orderTasks = createTaskRefs(OrderTasks);

      container.registerTransient(OrderTasks);

      const input: ProcessInput = { orderId: 'ord-123', amount: 100 };
      const command = await scheduleTask(createWorkflowContext(), orderTasks.processOrder, input);
      const taskResult = await runScheduledTask(executor, command);

      const replay = createWorkflowContext(true);
      replay.injectStepResult(command.taskId, taskResult.result);
      const result = await replay.executeTask(orderTasks.processOrder, input);

      // TypeScript should infer correct types
      const typed: ProcessOutput = result;
      expect(typed.success).toBe(true);
      expect(typed.transactionId).toBe('txn-ord-123');
    });
  });

  describe('Replay Behavior', () => {
    it('should use cached results during replay', async () => {
      let executions = 0;

      @Injectable()
      @Tasks()
      class TestTasks {
        @Task()
        async execute(_ctx: TaskContext, input: string) {
          executions++;
          return { input, timestamp: Date.now() };
        }
      }
      const testTasks = createTaskRefs(TestTasks);

      container.registerTransient(TestTasks);

      // First activation: two calls schedule two steps; the first suspends.
      const first = await scheduleTask(createWorkflowContext(), testTasks.execute, 'test');
      const firstResult = await runScheduledTask(executor, first);

      const second = createWorkflowContext(true);
      second.injectStepResult(first.taskId, firstResult.result);
      await second.executeTask(testTasks.execute, 'test');
      const secondCommand = await scheduleTask(second, testTasks.execute, 'test');
      const secondResult = await runScheduledTask(executor, secondCommand);

      // Replay with both results journaled: nothing is scheduled or executed again.
      const replay = createWorkflowContext(true);
      replay.injectStepResult(first.taskId, firstResult.result);
      replay.injectStepResult(secondCommand.taskId, secondResult.result);

      const result1 = await replay.executeTask(testTasks.execute, 'test');
      const result2 = await replay.executeTask(testTasks.execute, 'test');

      expect(result1).toEqual(firstResult.result);
      expect(result2).toEqual(secondResult.result);
      expect(replay.takeCommands()).toHaveLength(0);
      expect(executions).toBe(2);
    });
  });
});
