/**
 * Concurrent Pollers Configuration Tests
 *
 * Checks the worker's concurrency options: the defaults for workflow and task
 * polling, and the values it rejects.
 */

import { Worker } from '../worker';
import { WorkerOptions } from '../types';

// Mock the native module to avoid an FFI dependency in unit tests.
//
// The Worker constructor creates a native service handle and starts polling,
// so the mock has to satisfy `serviceCreate` for construction to complete. It deliberately omits
// the poll functions: `startPullModelPollingAsync` checks for them and bails, so
// no polling loops start and the suite stays a unit test.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    // Never settle: each polling loop parks on its first poll instead of
    // spinning, so the loops neither busy-wait nor hold the event loop open.
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('Concurrent Pollers Configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Default Poller Counts', () => {
    it('should default workflowPollerCount to 4', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Access the internal options to verify defaults
      const options = (service as any).options as WorkerOptions;
      expect(options.workflowPollerCount).toBe(4);
    });

    it('should default taskPollerCount to 4', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.taskPollerCount).toBe(4);
    });

    it('should allow overriding workflowPollerCount', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        workflowPollerCount: 8,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.workflowPollerCount).toBe(8);
    });

    it('should allow overriding taskPollerCount', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        taskPollerCount: 16,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.taskPollerCount).toBe(16);
    });

    it('should allow setting pollerCount to 1 for single-threaded mode', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        workflowPollerCount: 1,
        taskPollerCount: 1,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.workflowPollerCount).toBe(1);
      expect(options.taskPollerCount).toBe(1);
    });

    // A poller count of 0 would produce a worker that starts, reports healthy and
    // never picks up work, so it is rejected.
    it.each(['workflowPollerCount', 'taskPollerCount', 'actorPollerCount'])(
      'should reject %s of 0 rather than starting a worker that never polls',
      (key) => {
        const logger = createMockLogger();
        expect(
          () =>
            new Worker({
              serverUrl: 'http://localhost:50051',
              namespace: 'default',
              taskQueue: 'test-queue',
              workflows: [],
              tasks: [],
              [key]: 0,
              logger,
            })
        ).toThrow(/must be >= 1/);
      }
    );
  });

  describe('Concurrent Execution Limits', () => {
    it('should default maxConcurrentWorkflows to 100', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.maxConcurrentWorkflows).toBe(100);
    });

    it('should default maxConcurrentTasks to 100', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.maxConcurrentTasks).toBe(100);
    });

    it('should allow configuring maxConcurrentWorkflows', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        maxConcurrentWorkflows: 50,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.maxConcurrentWorkflows).toBe(50);
    });

    it('should allow configuring maxConcurrentTasks', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        maxConcurrentTasks: 200,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.maxConcurrentTasks).toBe(200);
    });
  });

  describe('Configuration Consistency', () => {
    it('should have consistent defaults for high-concurrency scenario', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;

      // With 4 pollers and 100 max concurrent, each poller can handle ~25 concurrent items
      expect(options.workflowPollerCount).toBe(4);
      expect(options.taskPollerCount).toBe(4);
      expect(options.maxConcurrentWorkflows).toBe(100);
      expect(options.maxConcurrentTasks).toBe(100);

      const workflowsPerPoller = options.maxConcurrentWorkflows! / options.workflowPollerCount!;
      const tasksPerPoller = options.maxConcurrentTasks! / options.taskPollerCount!;

      expect(workflowsPerPoller).toBe(25);
      expect(tasksPerPoller).toBe(25);
    });

    it('should support high-throughput configuration', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        workflowPollerCount: 8,
        taskPollerCount: 8,
        maxConcurrentWorkflows: 500,
        maxConcurrentTasks: 500,
        logger,
      });

      const options = (service as any).options as WorkerOptions;

      expect(options.workflowPollerCount).toBe(8);
      expect(options.taskPollerCount).toBe(8);
      expect(options.maxConcurrentWorkflows).toBe(500);
      expect(options.maxConcurrentTasks).toBe(500);
    });

    it('should support low-resource configuration', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        workflowPollerCount: 1,
        taskPollerCount: 1,
        maxConcurrentWorkflows: 10,
        maxConcurrentTasks: 10,
        logger,
      });

      const options = (service as any).options as WorkerOptions;

      expect(options.workflowPollerCount).toBe(1);
      expect(options.taskPollerCount).toBe(1);
      expect(options.maxConcurrentWorkflows).toBe(10);
      expect(options.maxConcurrentTasks).toBe(10);
    });
  });

  describe('Poll Interval Configuration', () => {
    it('should default workflowPollInterval to 100ms', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.workflowPollInterval).toBe(100);
    });

    it('should default taskPollInterval to 100ms', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.taskPollInterval).toBe(100);
    });

    it('should allow configuring poll intervals', () => {
      const logger = createMockLogger();
      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'default',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        workflowPollInterval: 50,
        taskPollInterval: 200,
        logger,
      });

      const options = (service as any).options as WorkerOptions;
      expect(options.workflowPollInterval).toBe(50);
      expect(options.taskPollInterval).toBe(200);
    });
  });
});

describe('WorkerOptions Type Definitions', () => {
  it('should have correct optional property types', () => {
    // Compile-time check: type-checking fails if WorkerOptions stops accepting
    // any of these.
    const options: WorkerOptions = {
      serverUrl: 'http://localhost:50051',
      namespace: 'default',
      taskQueue: 'test-queue',
      // All optional properties should be accepted
      workflowPollerCount: 4,
      taskPollerCount: 4,
      maxConcurrentWorkflows: 100,
      maxConcurrentTasks: 100,
      workflowPollInterval: 100,
      taskPollInterval: 100,
      shutdownGraceTime: 30000,
      forceShutdownTimeout: 60000,
      identity: 'test-worker',
      versionId: 'v1.0.0',
      binaryChecksum: 'abc123',
    };

    expect(options.workflowPollerCount).toBe(4);
    expect(options.taskPollerCount).toBe(4);
  });

  it('should allow minimal configuration', () => {
    const options: WorkerOptions = {
      serverUrl: 'http://localhost:50051',
      namespace: 'default',
      taskQueue: 'test-queue',
    };

    expect(options.serverUrl).toBe('http://localhost:50051');
    expect(options.workflowPollerCount).toBeUndefined();
    expect(options.taskPollerCount).toBeUndefined();
  });
});
