/**
 * Tests for TaskContext
 *
 * This file tests the TaskContext implementation including:
 * - Heartbeat functionality
 * - Cancellation checking
 * - Cancellation token patterns
 * - Metadata access
 * - Task logging
 * - Retry detection
 */

import { TaskContext, TaskExecution, CancellationToken, HeartbeatMessage } from '../task/context';

describe('TaskContext', () => {
  let ctx: TaskContext;
  let execution: TaskExecution;
  let cancellationToken: CancellationToken;

  beforeEach(() => {
    execution = {
      workflowId: 'test-workflow-123',
      runId: 'test-run-456',
      taskId: 'test-task-789',
      attempt: 1,
      taskType: 'TestTask',
      heartbeatTimeout: 30000, // 30 seconds
    };

    cancellationToken = new CancellationToken();
    ctx = new TaskContext(execution, cancellationToken);
  });

  describe('constructor', () => {
    it('should create a new task context', () => {
      expect(ctx).toBeInstanceOf(TaskContext);
    });

    it('should use provided cancellation token', () => {
      const customToken = new CancellationToken();
      const customCtx = new TaskContext(execution, customToken);
      expect(customCtx.cancellationToken()).toBe(customToken);
    });

    it('should create default cancellation token if not provided', () => {
      const ctxWithoutToken = new TaskContext(execution);
      expect(ctxWithoutToken.cancellationToken()).toBeInstanceOf(CancellationToken);
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat without details', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      await ctx.heartbeat();

      expect(heartbeatSpy).toHaveBeenCalledTimes(1);
      expect(heartbeatSpy).toHaveBeenCalledWith({
        taskId: 'test-task-789',
        details: undefined,
        timestamp: expect.any(Number),
      });
    });

    it('should send heartbeat with details', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      const details = { current: 5, total: 10, percentage: 50 };
      await ctx.heartbeatWithDetails(details);

      expect(heartbeatSpy).toHaveBeenCalledTimes(1);
      expect(heartbeatSpy).toHaveBeenCalledWith({
        taskId: 'test-task-789',
        details,
        timestamp: expect.any(Number),
      });
    });

    it('should check cancellation before sending heartbeat', async () => {
      cancellationToken.cancel();

      await expect(ctx.heartbeat()).rejects.toThrow('Task has been cancelled');
    });

    it('should handle heartbeat without callback set', async () => {
      await expect(ctx.heartbeat()).resolves.not.toThrow();
    });

    it('should include timestamp in heartbeat message', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      const beforeTime = Date.now();
      await ctx.heartbeat();
      const afterTime = Date.now();

      const call = heartbeatSpy.mock.calls[0][0] as HeartbeatMessage;
      expect(call.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(call.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should send multiple heartbeats', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      await ctx.heartbeat();
      await ctx.heartbeatWithDetails({ step: 1 });
      await ctx.heartbeatWithDetails({ step: 2 });

      expect(heartbeatSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('cancellation', () => {
    it('should not be cancelled initially', () => {
      expect(ctx.isCancelled()).toBe(false);
    });

    it('should detect cancellation', () => {
      cancellationToken.cancel();
      expect(ctx.isCancelled()).toBe(true);
    });

    it('should provide cancellation token', () => {
      const token = ctx.cancellationToken();
      expect(token).toBeInstanceOf(CancellationToken);
      expect(token).toBe(cancellationToken);
    });

    it('should allow manual cancellation via context', () => {
      ctx.cancel();
      expect(ctx.isCancelled()).toBe(true);
    });

    it('should support cancellation check in loops', () => {
      let iterations = 0;
      const maxIterations = 100;

      // Simulate processing loop
      cancellationToken.cancel(); // Cancel immediately

      while (iterations < maxIterations) {
        if (ctx.isCancelled()) {
          break;
        }
        iterations++;
      }

      expect(iterations).toBe(0); // Should exit immediately
    });

    it('should handle cancellation after work started', () => {
      expect(ctx.isCancelled()).toBe(false);

      // Simulate some work
      const workDone = 'some work';
      expect(workDone).toBe('some work');

      // Cancel mid-execution
      cancellationToken.cancel();
      expect(ctx.isCancelled()).toBe(true);
    });
  });

  describe('CancellationToken', () => {
    let token: CancellationToken;

    beforeEach(() => {
      token = new CancellationToken();
    });

    it('should not be cancelled initially', () => {
      expect(token.isCancelled).toBe(false);
    });

    it('should be cancelled after cancel() call', () => {
      token.cancel();
      expect(token.isCancelled).toBe(true);
    });

    it('should support waiting for cancellation', async () => {
      // Cancel after a short delay
      setTimeout(() => token.cancel(), 50);

      const startTime = Date.now();
      await token.waitForCancellation();
      const duration = Date.now() - startTime;

      expect(token.isCancelled).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(45); // Allow some timing variance
    });

    it('should resolve immediately if already cancelled', async () => {
      token.cancel();

      const startTime = Date.now();
      await token.waitForCancellation();
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10); // Should be nearly instant
    });

    it('should support race patterns', async () => {
      const workPromise = new Promise((resolve) => setTimeout(() => resolve('work done'), 100));

      setTimeout(() => token.cancel(), 50);

      const result = await Promise.race([
        workPromise,
        token.waitForCancellation().then(() => 'cancelled'),
      ]);

      expect(result).toBe('cancelled');
    });
  });

  describe('metadata access', () => {
    it('should return workflow ID', () => {
      expect(ctx.workflowId()).toBe('test-workflow-123');
    });

    it('should return run ID', () => {
      expect(ctx.runId()).toBe('test-run-456');
    });

    it('should return task ID', () => {
      expect(ctx.taskId()).toBe('test-task-789');
    });

    it('should return task type', () => {
      expect(ctx.taskType()).toBe('TestTask');
    });

    it('should return attempt number', () => {
      expect(ctx.attempt()).toBe(1);
    });

    it('should return heartbeat timeout', () => {
      expect(ctx.heartbeatTimeout()).toBe(30000);
    });

    it('should return undefined for missing heartbeat timeout', () => {
      const execWithoutTimeout: TaskExecution = {
        ...execution,
        heartbeatTimeout: undefined,
      };
      const ctxWithoutTimeout = new TaskContext(execWithoutTimeout);
      expect(ctxWithoutTimeout.heartbeatTimeout()).toBeUndefined();
    });
  });

  describe('retry detection', () => {
    it('should detect first attempt', () => {
      expect(ctx.isRetry()).toBe(false);
    });

    it('should detect retry (attempt 2)', () => {
      const retryExecution: TaskExecution = {
        ...execution,
        attempt: 2,
      };
      const retryCtx = new TaskContext(retryExecution);
      expect(retryCtx.isRetry()).toBe(true);
    });

    it('should detect multiple retries', () => {
      const multiRetryExecution: TaskExecution = {
        ...execution,
        attempt: 5,
      };
      const multiRetryCtx = new TaskContext(multiRetryExecution);
      expect(multiRetryCtx.isRetry()).toBe(true);
      expect(multiRetryCtx.attempt()).toBe(5);
    });
  });

  describe('logger', () => {
    it('should provide a logger instance', () => {
      const logger = ctx.logger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeInstanceOf(Function);
      expect(logger.warn).toBeInstanceOf(Function);
      expect(logger.error).toBeInstanceOf(Function);
      expect(logger.debug).toBeInstanceOf(Function);
    });

    it('should include task context in logs', () => {
      const logger = ctx.logger();
      const infoSpy = jest.spyOn(logger, 'info');

      logger.info('Test message');

      expect(infoSpy).toHaveBeenCalledWith('Test message');
    });

    it('should support structured logging', () => {
      const logger = ctx.logger();
      const infoSpy = jest.spyOn(logger, 'info');

      logger.info('Processing item', { itemId: 123, status: 'active' });

      expect(infoSpy).toHaveBeenCalledWith('Processing item', {
        itemId: 123,
        status: 'active',
      });
    });

    it('should support all log levels', () => {
      const logger = ctx.logger();
      const debugSpy = jest.spyOn(logger, 'debug');
      const infoSpy = jest.spyOn(logger, 'info');
      const warnSpy = jest.spyOn(logger, 'warn');
      const errorSpy = jest.spyOn(logger, 'error');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(debugSpy).toHaveBeenCalledWith('Debug message');
      expect(infoSpy).toHaveBeenCalledWith('Info message');
      expect(warnSpy).toHaveBeenCalledWith('Warning message');
      expect(errorSpy).toHaveBeenCalledWith('Error message');
    });
  });

  describe('integration scenarios', () => {
    it('should support typical long-running task pattern', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      const items = [1, 2, 3, 4, 5];
      const processed: number[] = [];

      for (let i = 0; i < items.length; i++) {
        // Check cancellation
        if (ctx.isCancelled()) {
          break;
        }

        // Process item
        processed.push(items[i]);

        // Send progress heartbeat
        await ctx.heartbeatWithDetails({
          current: i + 1,
          total: items.length,
          percentage: ((i + 1) / items.length) * 100,
        });
      }

      expect(processed).toEqual([1, 2, 3, 4, 5]);
      expect(heartbeatSpy).toHaveBeenCalledTimes(5);
    });

    it('should handle cancellation during processing', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      const items = [1, 2, 3, 4, 5];
      const processed: number[] = [];

      for (let i = 0; i < items.length; i++) {
        // Simulate cancellation after 3 items
        if (i === 3) {
          cancellationToken.cancel();
        }

        // Check cancellation
        if (ctx.isCancelled()) {
          break;
        }

        // Process item
        processed.push(items[i]);

        // Send heartbeat
        await ctx.heartbeatWithDetails({ current: i + 1, total: items.length });
      }

      expect(processed).toEqual([1, 2, 3]); // Only 3 items processed
      expect(heartbeatSpy).toHaveBeenCalledTimes(3);
    });

    it('should combine metadata and logging', () => {
      const logger = ctx.logger();
      const infoSpy = jest.spyOn(logger, 'info');

      logger.info('Task started', {
        workflowId: ctx.workflowId(),
        taskId: ctx.taskId(),
        attempt: ctx.attempt(),
        isRetry: ctx.isRetry(),
      });

      expect(infoSpy).toHaveBeenCalledWith('Task started', {
        workflowId: 'test-workflow-123',
        taskId: 'test-task-789',
        attempt: 1,
        isRetry: false,
      });
    });

    it('should handle heartbeat with cancellation check', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      // First heartbeat succeeds
      await ctx.heartbeat();
      expect(heartbeatSpy).toHaveBeenCalledTimes(1);

      cancellationToken.cancel();

      // Second heartbeat should throw
      await expect(ctx.heartbeat()).rejects.toThrow('Task has been cancelled');
      expect(heartbeatSpy).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should support retry logging', () => {
      const retryExecution: TaskExecution = {
        ...execution,
        attempt: 3,
      };
      const retryCtx = new TaskContext(retryExecution);
      const logger = retryCtx.logger();
      const warnSpy = jest.spyOn(logger, 'warn');

      if (retryCtx.isRetry()) {
        logger.warn(`Retrying task (attempt ${retryCtx.attempt()})`);
      }

      expect(warnSpy).toHaveBeenCalledWith('Retrying task (attempt 3)');
    });
  });

  describe('edge cases', () => {
    it('should handle very high attempt numbers', () => {
      const highAttemptExecution: TaskExecution = {
        ...execution,
        attempt: 999,
      };
      const highAttemptCtx = new TaskContext(highAttemptExecution);
      expect(highAttemptCtx.attempt()).toBe(999);
      expect(highAttemptCtx.isRetry()).toBe(true);
    });

    it('should handle undefined heartbeat timeout', () => {
      const noTimeoutExecution: TaskExecution = {
        workflowId: 'wf-1',
        runId: 'run-1',
        taskId: 'task-1',
        attempt: 1,
        taskType: 'NoTimeoutTask',
      };
      const noTimeoutCtx = new TaskContext(noTimeoutExecution);
      expect(noTimeoutCtx.heartbeatTimeout()).toBeUndefined();
    });

    it('should handle rapid cancellation checks', () => {
      for (let i = 0; i < 1000; i++) {
        expect(ctx.isCancelled()).toBe(false);
      }

      cancellationToken.cancel();

      for (let i = 0; i < 1000; i++) {
        expect(ctx.isCancelled()).toBe(true);
      }
    });

    it('should handle heartbeat details with complex objects', async () => {
      const heartbeatSpy = jest.fn();
      ctx.setHeartbeatCallback(heartbeatSpy);

      const complexDetails = {
        nested: {
          data: {
            value: 123,
            items: [1, 2, 3],
          },
        },
        timestamp: new Date().toISOString(),
        metadata: { key: 'value' },
      };

      await ctx.heartbeatWithDetails(complexDetails);

      expect(heartbeatSpy).toHaveBeenCalledWith({
        taskId: 'test-task-789',
        details: complexDetails,
        timestamp: expect.any(Number),
      });
    });
  });
});
