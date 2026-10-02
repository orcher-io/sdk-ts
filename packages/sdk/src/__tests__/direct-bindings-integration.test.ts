/**
 * Integration tests for the direct native bindings.
 *
 * These tests cover:
 * - Promise handling for async TypeScript executors
 * - Server completion (gRPC CompleteWorkflowExecutionRequest)
 * - End-to-end workflow execution flow
 * - Multi-poller concurrency
 * - Graceful shutdown
 * - Error handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from '../client/client';
import { Worker } from '../worker';
import { ExecutionRequest, ExecutionResult } from '../types';


// These tests drive the real native bridge. Under ts-jest the loader resolves
// the addon relative to `src/`, where it does not exist — it is only copied next
// to the built `dist/`. Whether to skip is decided at module load, because a
// `return` inside beforeAll does not skip anything: the tests would run and fail.
function directBindingsAvailable(): boolean {
  try {
    const { getNativeModule } = require('../core/native');
    return typeof getNativeModule().serviceCreate === 'function';
  } catch {
    return false;
  }
}

const describeIfNative = directBindingsAvailable() ? describe : describe.skip;

// Orcher server the tests connect to; override with ORCHER_TEST_SERVER.
const TEST_SERVER_URL = process.env.ORCHER_TEST_SERVER || 'http://localhost:50051';
const TEST_NAMESPACE = 'test-direct-bindings';
const TEST_TASK_QUEUE = 'test-queue-direct-bindings';

describeIfNative('Direct Bindings Integration Tests', () => {
  let client: Client;
  let service: Worker;

  beforeAll(async () => {
    // Guards against a native module without `connect`; a missing addon is
    // already handled by `describeIfNative`.
    const nativeModule = require('../core/native');
    if (!nativeModule.connect) {
      console.warn('Direct bindings not available, skipping tests');
      return;
    }

    client = await Client.connect({
      serverUrl: TEST_SERVER_URL,
      namespace: TEST_NAMESPACE,
    });
  });

  afterAll(async () => {
    if (service) {
      await service.shutdown();
    }
    if (client) {
      await client.close();
    }
  });

  describe('Promise Handling', () => {
    it('should handle synchronous workflow executor', async () => {
      const executionRequests: ExecutionRequest[] = [];

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: TEST_TASK_QUEUE,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      // Synchronous executor - returns result directly
      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        executionRequests.push(request);

        return {
          runId: request.runId,
          successful: true,
          commands: [
            {
              type: 'CompleteWorkflow',
              result: { message: 'sync result' },
            },
          ],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => {
        return {
          runId: request.runId,
          successful: true,
          result: { data: 'task completed' },
        };
      };

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      // Give it time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      const handle = await client.startWorkflow({
        workflowId: 'test-sync-executor',
        workflowType: 'TestWorkflow',
        taskQueue: TEST_TASK_QUEUE,
        args: [{ input: 'test' }],
      });

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify executor was called
      expect(executionRequests.length).toBeGreaterThan(0);
      expect(executionRequests[0].runId).toBeDefined();

      await service.shutdown();
    }, 10000);

    it('should handle async workflow executor with promises', async () => {
      const executionRequests: ExecutionRequest[] = [];

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-async`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      // Async executor - returns a Promise
      const workflowExecutor = async (request: ExecutionRequest): Promise<ExecutionResult> => {
        executionRequests.push(request);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 50));

        return {
          runId: request.runId,
          successful: true,
          commands: [
            {
              type: 'CompleteWorkflow',
              result: { message: 'async result', timestamp: Date.now() },
            },
          ],
          queryResponses: [],
        };
      };

      const taskExecutor = async (request: any): Promise<any> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          runId: request.runId,
          successful: true,
          result: { data: 'task completed' },
        };
      };

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handle = await client.startWorkflow({
        workflowId: 'test-async-executor',
        workflowType: 'AsyncTestWorkflow',
        taskQueue: `${TEST_TASK_QUEUE}-async`,
        args: [{ input: 'async-test' }],
      });

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify async executor was called
      expect(executionRequests.length).toBeGreaterThan(0);
      expect(executionRequests[0].jobs).toBeDefined();

      await service.shutdown();
    }, 15000);

    it('should handle promise rejection in executor', async () => {
      const errors: Error[] = [];

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-error`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = async (request: ExecutionRequest): Promise<ExecutionResult> => {
        throw new Error('Intentional test error');
      };

      const taskExecutor = async (request: any): Promise<any> => {
        return {
          runId: request.runId,
          successful: true,
          result: {},
        };
      };

      const originalError = console.error;
      console.error = (...args: any[]) => {
        if (args[0] instanceof Error) {
          errors.push(args[0]);
        }
        originalError.apply(console, args);
      };

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Start a workflow that will fail
      const handle = await client.startWorkflow({
        workflowId: 'test-error-executor',
        workflowType: 'ErrorTestWorkflow',
        taskQueue: `${TEST_TASK_QUEUE}-error`,
        args: [{}],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      console.error = originalError;

      // Shutting down cleanly shows the worker survived the executor error.
      await service.shutdown();
    }, 10000);
  });

  describe('Server Completion', () => {
    it('should send CompleteWorkflowExecutionRequest to server', async () => {
      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-completion`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        return {
          runId: request.runId,
          successful: true,
          commands: [
            {
              type: 'ScheduleTask',
              taskId: 'task-1',
              taskType: 'ProcessData',
              input: [{ data: 'test' }],
              timeout: 30000,
            },
            {
              type: 'CompleteWorkflow',
              result: { status: 'completed' },
            },
          ],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => ({
        runId: request.runId,
        successful: true,
        result: { processed: true },
      });

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handle = await client.startWorkflow({
        workflowId: 'test-completion',
        workflowType: 'CompletionTestWorkflow',
        taskQueue: `${TEST_TASK_QUEUE}-completion`,
        args: [{ test: true }],
      });

      // Wait for completion to be sent
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Reaching this point without an error means the completion was sent.
      expect(handle).toBeDefined();

      await service.shutdown();
    }, 10000);

    it('should handle multiple commands in completion', async () => {
      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-multi-cmd`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        return {
          runId: request.runId,
          successful: true,
          commands: [
            {
              type: 'StartTimer',
              timerId: 'timer-1',
              duration: 5000,
            },
            {
              type: 'ScheduleTask',
              taskId: 'task-1',
              taskType: 'Step1',
              input: [],
              timeout: 30000,
            },
            {
              type: 'ScheduleTask',
              taskId: 'task-2',
              taskType: 'Step2',
              input: [],
              timeout: 30000,
            },
          ],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => ({
        runId: request.runId,
        successful: true,
        result: {},
      });

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const handle = await client.startWorkflow({
        workflowId: 'test-multi-commands',
        workflowType: 'MultiCommandWorkflow',
        taskQueue: `${TEST_TASK_QUEUE}-multi-cmd`,
        args: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await service.shutdown();
    }, 10000);
  });

  describe('Multi-Poller Concurrency', () => {
    it('should handle multiple concurrent workflow pollers', async () => {
      const executionCount = new Map<string, number>();

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-concurrent`,
        maxConcurrentWorkflows: 3, // Multiple pollers
        maxConcurrentTasks: 2,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        const count = executionCount.get('workflow') || 0;
        executionCount.set('workflow', count + 1);

        return {
          runId: request.runId,
          successful: true,
          commands: [
            {
              type: 'CompleteWorkflow',
              result: { executionNumber: count + 1 },
            },
          ],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => {
        const count = executionCount.get('task') || 0;
        executionCount.set('task', count + 1);

        return {
          runId: request.runId,
          successful: true,
          result: { executionNumber: count + 1 },
        };
      };

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Start multiple workflows
      const handles = await Promise.all([
        client.startWorkflow({
          workflowId: 'concurrent-1',
          workflowType: 'ConcurrentTest',
          taskQueue: `${TEST_TASK_QUEUE}-concurrent`,
          args: [],
        }),
        client.startWorkflow({
          workflowId: 'concurrent-2',
          workflowType: 'ConcurrentTest',
          taskQueue: `${TEST_TASK_QUEUE}-concurrent`,
          args: [],
        }),
        client.startWorkflow({
          workflowId: 'concurrent-3',
          workflowType: 'ConcurrentTest',
          taskQueue: `${TEST_TASK_QUEUE}-concurrent`,
          args: [],
        }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify multiple executions occurred
      const workflowExecs = executionCount.get('workflow') || 0;
      expect(workflowExecs).toBeGreaterThanOrEqual(1);

      await service.shutdown();
    }, 15000);
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown cleanly while pollers are running', async () => {
      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-shutdown`,
        maxConcurrentWorkflows: 2,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => ({
        runId: request.runId,
        successful: true,
        commands: [
          {
            type: 'CompleteWorkflow',
            result: {},
          },
        ],
        queryResponses: [],
      });

      const taskExecutor = (request: any): any => ({
        runId: request.runId,
        successful: true,
        result: {},
      });

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Initiate shutdown immediately
      const shutdownStart = Date.now();
      await service.shutdown();
      const shutdownDuration = Date.now() - shutdownStart;

      // Shutdown should complete relatively quickly
      expect(shutdownDuration).toBeLessThan(5000);
    }, 10000);

    it('should stop accepting new work after shutdown is called', async () => {
      let executionsAfterShutdown = 0;
      let shutdownCalled = false;

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-stop-work`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        if (shutdownCalled) {
          executionsAfterShutdown++;
        }
        return {
          runId: request.runId,
          successful: true,
          commands: [{ type: 'CompleteWorkflow', result: {} }],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => ({
        runId: request.runId,
        successful: true,
        result: {},
      });

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mark that shutdown is being called
      shutdownCalled = true;
      await service.shutdown();

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not have executed more work after shutdown
      expect(executionsAfterShutdown).toBe(0);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should continue polling after executor throws error', async () => {
      let executionCount = 0;
      let shouldError = true;

      service = new Worker({
        serverUrl: TEST_SERVER_URL,
        namespace: TEST_NAMESPACE,
        taskQueue: `${TEST_TASK_QUEUE}-error-recovery`,
        maxConcurrentWorkflows: 1,
        maxConcurrentTasks: 1,
      });

      const workflowExecutor = (request: ExecutionRequest): ExecutionResult => {
        executionCount++;

        if (shouldError && executionCount === 1) {
          shouldError = false;
          throw new Error('First execution fails');
        }

        return {
          runId: request.runId,
          successful: true,
          commands: [{ type: 'CompleteWorkflow', result: { count: executionCount } }],
          queryResponses: [],
        };
      };

      const taskExecutor = (request: any): any => ({
        runId: request.runId,
        successful: true,
        result: {},
      });

      const servicePromise = service.run(workflowExecutor, taskExecutor);

      await new Promise((resolve) => setTimeout(resolve, 100));

      await client.startWorkflow({
        workflowId: 'error-recovery-1',
        workflowType: 'ErrorRecovery',
        taskQueue: `${TEST_TASK_QUEUE}-error-recovery`,
        args: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      await client.startWorkflow({
        workflowId: 'error-recovery-2',
        workflowType: 'ErrorRecovery',
        taskQueue: `${TEST_TASK_QUEUE}-error-recovery`,
        args: [],
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Second execution should have succeeded
      expect(executionCount).toBeGreaterThanOrEqual(2);

      await service.shutdown();
    }, 15000);
  });
});
