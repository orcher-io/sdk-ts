/**
 * Tests for WorkflowContext
 *
 * This file tests the WorkflowContext implementation including:
 * - Execution APIs (execute, executeTask)
 * - Deterministic helpers (random, time)
 * - State management
 * - Timers
 * - Metadata access
 * - Command generation
 */

import { isWorkflowSuspension } from '../errors';
import { WorkflowContext, WorkflowExecution } from '../workflow/context';
import { WorkflowRandom } from '../workflow/random';
import { WorkflowTime } from '../workflow/time';
import { Duration } from '../workflow/types';
import { GlobalRegistry } from '../di/registry';

describe('WorkflowContext', () => {
  let ctx: WorkflowContext;
  let execution: WorkflowExecution;

  beforeEach(() => {
    GlobalRegistry.getInstance().clear();

    execution = {
      workflowId: 'test-workflow-123',
      runId: 'test-run-456',
      workflowType: 'TestWorkflow',
      attempt: 1,
      namespace: 'default',
      taskQueue: 'test-queue',
    };

    ctx = new WorkflowContext(execution, false, '1.0.0', Date.now());
  });

  afterEach(() => {
    GlobalRegistry.getInstance().clear();
  });

  describe('constructor', () => {
    it('should create a new workflow context', () => {
      expect(ctx).toBeInstanceOf(WorkflowContext);
    });

    it('should initialize deterministic helpers', () => {
      expect(ctx.random).toBeInstanceOf(WorkflowRandom);
      expect(ctx.time).toBeInstanceOf(WorkflowTime);
    });

    it('should set replaying state', () => {
      const replayingCtx = new WorkflowContext(execution, true);
      expect(replayingCtx.isReplaying()).toBe(true);

      const freshCtx = new WorkflowContext(execution, false);
      expect(freshCtx.isReplaying()).toBe(false);
    });
  });

  describe('deterministic helpers', () => {
    describe('random (property access)', () => {
      it('should provide random helper via property access', () => {
        expect(ctx.random).toBeInstanceOf(WorkflowRandom);
      });

      it('should generate deterministic UUIDs', () => {
        const uuid1 = ctx.random.uuid();
        const uuid2 = ctx.random.uuid();

        expect(uuid1).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
        expect(uuid2).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
        expect(uuid1).not.toBe(uuid2);
      });

      it('should generate deterministic random numbers', () => {
        const random1 = ctx.random.random();
        const random2 = ctx.random.random();

        expect(random1).toBeGreaterThanOrEqual(0);
        expect(random1).toBeLessThan(1);
        expect(random2).toBeGreaterThanOrEqual(0);
        expect(random2).toBeLessThan(1);
      });

      it('should generate deterministic random ranges', () => {
        const value = ctx.random.randomRange(1, 10);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(10);
      });

      it('should choose random element from array', () => {
        const items = ['a', 'b', 'c'];
        const chosen = ctx.random.choose(items);
        expect(items).toContain(chosen);
      });

      it('should shuffle array', () => {
        const items = [1, 2, 3, 4, 5];
        const shuffled = ctx.random.shuffle(items);

        expect(shuffled).toHaveLength(5);
        expect(shuffled).toEqual(expect.arrayContaining(items));
        expect(items).toEqual([1, 2, 3, 4, 5]); // Original unchanged
      });

      it('should maintain same instance across access', () => {
        const random1 = ctx.random;
        const random2 = ctx.random;
        expect(random1).toBe(random2);
      });
    });

    describe('time (property access)', () => {
      it('should provide time helper via property access', () => {
        expect(ctx.time).toBeInstanceOf(WorkflowTime);
      });

      it('should return workflow start time', () => {
        const now = ctx.time.now();
        expect(now).toBeInstanceOf(Date);
      });

      it('should calculate elapsed time', () => {
        const elapsed = ctx.time.elapsed();
        expect(elapsed).toBeGreaterThanOrEqual(0);
      });

      it('should calculate elapsed seconds', () => {
        const elapsedSecs = ctx.time.elapsedSecs();
        expect(elapsedSecs).toBeGreaterThanOrEqual(0);
      });

      it('should maintain same instance across access', () => {
        const time1 = ctx.time;
        const time2 = ctx.time;
        expect(time1).toBe(time2);
      });
    });
  });

  describe('metadata', () => {
    it('should return workflow ID', () => {
      expect(ctx.workflowId()).toBe('test-workflow-123');
    });

    it('should return run ID', () => {
      expect(ctx.runId()).toBe('test-run-456');
    });

    it('should return workflow type', () => {
      expect(ctx.workflowType()).toBe('TestWorkflow');
    });

    it('should return attempt number', () => {
      expect(ctx.attempt()).toBe(1);
    });

    it('should return namespace', () => {
      expect(ctx.namespace()).toBe('default');
    });

    it('should return task queue', () => {
      expect(ctx.taskQueue()).toBe('test-queue');
    });

    it('should return version', () => {
      expect(ctx.version()).toBe('1.0.0');
    });

    it('should return replaying state', () => {
      expect(ctx.isReplaying()).toBe(false);
    });
  });

  describe('state management', () => {
    it('should set and get state', () => {
      ctx.setState('key1', 'value1');
      expect(ctx.getState('key1')).toBe('value1');
    });

    it('should handle complex state values', () => {
      const complexValue = {
        status: 'processing',
        items: [1, 2, 3],
        nested: { foo: 'bar' },
      };

      ctx.setState('complex', complexValue);
      expect(ctx.getState('complex')).toEqual(complexValue);
    });

    it('should return undefined for non-existent keys', () => {
      expect(ctx.getState('nonexistent')).toBeUndefined();
    });

    it('should handle type-safe getState', () => {
      interface OrderStatus {
        status: string;
        step: number;
      }

      ctx.setState<OrderStatus>('orderStatus', { status: 'processing', step: 2 });
      const status = ctx.getState<OrderStatus>('orderStatus');

      expect(status).toEqual({ status: 'processing', step: 2 });
    });

    it('should throw on empty key for setState', () => {
      expect(() => ctx.setState('', 'value')).toThrow();
    });

    it('should throw on empty key for getState', () => {
      expect(() => ctx.getState('')).toThrow();
    });

    it('should update existing state', () => {
      ctx.setState('counter', 1);
      ctx.setState('counter', 2);
      expect(ctx.getState('counter')).toBe(2);
    });
  });

  describe('input caching', () => {
    it('should cache and retrieve input', () => {
      const input = { orderId: '123', amount: 100 };
      ctx.cacheInput(input);
      expect(ctx.getCachedInput()).toEqual(input);
    });

    it('should return undefined when no input cached', () => {
      expect(ctx.getCachedInput()).toBeUndefined();
    });

    it('should overwrite cached input', () => {
      ctx.cacheInput({ first: true });
      ctx.cacheInput({ second: true });
      expect(ctx.getCachedInput()).toEqual({ second: true });
    });
  });

  describe('executeTask', () => {
    it('should throw if not a valid TaskReference', async () => {
      const invalidTaskRef = async (ctx: any, input: any) => input;

      await expect(ctx.executeTask(invalidTaskRef as any, {})).rejects.toThrow(
        /executeTask requires a TaskReference/
      );
    });

    it('should generate schedule task command', async () => {
      class MockTaskHandler {
        async testTask(ctx: any, input: any) {
          return input;
        }
      }

      const taskRef = {
        taskName: 'testTask',
        handlerClass: MockTaskHandler,
        methodName: 'testTask',
      };

      GlobalRegistry.getInstance().registerTask('testTask', {
        name: 'testTask',
        handlerClass: MockTaskHandler,
        methodName: 'testTask',
        timeout: 30000,
        retryPolicy: undefined,
      });

      try {
        await ctx.executeTask(taskRef, { test: 'data' });
      } catch (error: any) {
        // Expected to throw suspension error
        expect(error.message).toContain('Workflow suspended');
      }

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: 'SCHEDULE_TASK',
        taskType: 'testTask',
        taskQueue: 'test-queue',
      });
    });

    it('marks suspension so the executor can re-assert a swallowed signal', async () => {
      class MockTaskHandler {
        async run(_c: any, i: any) {
          return i;
        }
      }
      const taskRef = { taskName: 't_reassert', handlerClass: MockTaskHandler, methodName: 'run' };
      GlobalRegistry.getInstance().registerTask('t_reassert', {
        name: 't_reassert',
        handlerClass: MockTaskHandler,
        methodName: 'run',
        timeout: 30000,
        retryPolicy: undefined,
      });

      expect(ctx.wasSuspensionRequested()).toBe(false);

      let caught: unknown;
      try {
        await ctx.executeTask(taskRef as any, {});
      } catch (e) {
        caught = e;
      }

      // The thrown value is the identifiable suspension signal ...
      expect(isWorkflowSuspension(caught)).toBe(true);
      // ... and the context recorded it, so the executor re-asserts suspension even
      // if user code swallows the throw — a swallowed signal can't break durability.
      expect(ctx.wasSuspensionRequested()).toBe(true);
    });

    it('should use replay cache when replaying', async () => {
      const replayingCtx = new WorkflowContext(execution, true);

      // Simulate cached result - taskId format is `${taskName}_${sequence}`
      (replayingCtx as any).state.pendingTaskResults.set('testTask_0', { result: 'cached' });

      class MockTaskHandler {
        async testTask(ctx: any, input: any) {
          return input;
        }
      }

      const taskRef = {
        taskName: 'testTask',
        handlerClass: MockTaskHandler,
        methodName: 'testTask',
      };

      GlobalRegistry.getInstance().registerTask('testTask', {
        name: 'testTask',
        handlerClass: MockTaskHandler,
        methodName: 'testTask',
        timeout: 30000,
        retryPolicy: undefined,
      });

      const result = await replayingCtx.executeTask(taskRef, {});
      expect(result).toEqual({ result: 'cached' });
    });
  });

  describe('execute (inline closures)', () => {
    it('should execute inline closure', async () => {
      const result = await ctx.execute('test_step', async () => {
        return { data: 'test' };
      });

      expect(result).toEqual({ data: 'test' });
    });

    it('should throw on empty step name', async () => {
      await expect(ctx.execute('', async () => 'result')).rejects.toThrow(/non-empty step name/);
    });

    it('should generate record step result command', async () => {
      await ctx.execute('test_step', async () => 'result');

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: 'RECORD_STEP_RESULT',
        // The name and the step's number, so each run of a name is its own step.
        stepName: 'test_step_0',
        result: 'result',
      });
    });

    it('should handle async closures', async () => {
      const result = await ctx.execute('async_step', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });

      expect(result).toBe('async result');
    });

    it('should propagate errors from closure', async () => {
      await expect(
        ctx.execute('error_step', async () => {
          throw new Error('Closure error');
        })
      ).rejects.toThrow('Closure error');
    });
  });

  describe('timers', () => {
    it('should suspend on sleep (first execution)', async () => {
      await expect(ctx.sleep(Duration.fromSeconds(1))).rejects.toThrow(/Waiting for timer/);
    });

    it('should generate a start timer command', async () => {
      await expect(ctx.sleep(Duration.fromSeconds(5))).rejects.toThrow();

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        type: 'START_TIMER',
        durationMs: 5000,
      });
    });

    it('should accept Duration helper', async () => {
      const duration = Duration.fromMinutes(5);
      await expect(ctx.sleep(duration)).rejects.toThrow();

      const commands = ctx.takeCommands();
      expect(commands[0]).toMatchObject({
        durationMs: 5 * 60 * 1000,
      });
    });

    it('should throw on negative duration', async () => {
      await expect(ctx.sleepWithId('test', Duration.fromMilliseconds(-1000))).rejects.toThrow(/non-negative duration/);
    });

    it('should throw on empty timer ID', async () => {
      await expect(ctx.sleepWithId('', Duration.fromSeconds(1))).rejects.toThrow(/non-empty timer ID/);
    });

    it('should skip timer if already fired during replay', async () => {
      const replayingCtx = new WorkflowContext(execution, true);

      // Simulate the fired-timer marker the worker injects under timer:{id}.
      (replayingCtx as any).state.pendingTaskResults.set('timer:test_timer', true);

      await replayingCtx.sleepWithId('test_timer', Duration.fromSeconds(1));

      // Should not generate a command (timer already fired).
      const commands = replayingCtx.takeCommands();
      expect(commands).toHaveLength(0);
    });
  });

  describe('command generation', () => {
    it('should generate sequential command IDs', async () => {
      await ctx.execute('step1', async () => 'result1');
      await ctx.execute('step2', async () => 'result2');

      const commands = ctx.takeCommands();
      expect(commands[0].sequence).toBe(0);
      expect(commands[1].sequence).toBe(1);
    });

    it('should clear commands after taking', async () => {
      await ctx.execute('step1', async () => 'result1');

      const commands1 = ctx.takeCommands();
      expect(commands1).toHaveLength(1);

      const commands2 = ctx.takeCommands();
      expect(commands2).toHaveLength(0);
    });

    it('should accumulate commands', async () => {
      await ctx.execute('step1', async () => 'result1');
      await ctx.execute('step2', async () => 'result2');

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(2);
    });
  });

  describe('integration scenarios', () => {
    it('should support mixed execution patterns', async () => {
      class EmailTaskHandler {
        async sendEmail(ctx: any, input: any) {
          return input;
        }
      }

      const sendEmailRef = {
        taskName: 'sendEmail',
        handlerClass: EmailTaskHandler,
        methodName: 'sendEmail',
      };

      GlobalRegistry.getInstance().registerTask('sendEmail', {
        name: 'sendEmail',
        handlerClass: EmailTaskHandler,
        methodName: 'sendEmail',
        timeout: 30000,
        retryPolicy: undefined,
      });

      // Execute inline closure
      const userData = await ctx.execute('fetch_user', async () => ({
        id: '123',
        email: 'user@example.com',
      }));

      expect(userData.email).toBe('user@example.com');

      // Execute registered task (will throw suspension error)
      try {
        await ctx.executeTask(sendEmailRef, { to: userData.email });
      } catch (error: any) {
        expect(error.message).toContain('Workflow suspended');
      }

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(2);
      expect(commands[0].type).toBe('RECORD_STEP_RESULT');
      expect(commands[1].type).toBe('SCHEDULE_TASK');
    });

    it('should use deterministic helpers in workflow', async () => {
      // Generate deterministic values
      const orderId = `ORD-${ctx.random.uuid()}`;
      const confirmationId = `CONF-${ctx.random.uuid()}`;
      const orderTime = ctx.time.now();

      expect(orderId).toMatch(/^ORD-[0-9a-f-]+$/);
      expect(confirmationId).toMatch(/^CONF-[0-9a-f-]+$/);
      expect(orderTime).toBeInstanceOf(Date);

      ctx.setState('order', {
        orderId,
        confirmationId,
        timestamp: orderTime.toISOString(),
      });

      const order = ctx.getState('order');
      expect(order).toMatchObject({
        orderId,
        confirmationId,
      });
    });

    it('should maintain metadata throughout execution', () => {
      expect(ctx.workflowId()).toBe('test-workflow-123');

      ctx.setState('data', 'test');
      expect(ctx.workflowId()).toBe('test-workflow-123');

      const uuid = ctx.random.uuid();
      expect(ctx.workflowId()).toBe('test-workflow-123');
      expect(uuid).toBeTruthy();
    });
  });

  describe('Duration helper', () => {
    it('should create duration from seconds', () => {
      const duration = Duration.fromSeconds(30);
      expect(duration.toMilliseconds()).toBe(30000);
    });

    it('should create duration from minutes', () => {
      const duration = Duration.fromMinutes(5);
      expect(duration.toMilliseconds()).toBe(5 * 60 * 1000);
    });

    it('should create duration from hours', () => {
      const duration = Duration.fromHours(2);
      expect(duration.toMilliseconds()).toBe(2 * 60 * 60 * 1000);
    });

    it('should convert between units', () => {
      const duration = Duration.fromMinutes(5);

      expect(duration.toSeconds()).toBe(300);
      expect(duration.toMinutes()).toBe(5);
      expect(duration.toHours()).toBe(5 / 60);
    });
  });
});
