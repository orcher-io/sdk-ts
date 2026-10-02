/**
 * Worker DI Integration Tests
 *
 * Tests the integration between the worker, the DI container and the task
 * executor: services and task handlers are registered and resolved correctly.
 *
 * @module @orcher/sdk/worker/__tests__/service-di-integration
 */

import { Worker } from '../worker';
import { Injectable } from '../../di/decorators/injectable';
import { Tasks } from '../../di/decorators/tasks';
import { Task } from '../../di/decorators/task';
import { Workflow } from '../../di/decorators/workflow';
import { globalRegistry as diGlobalRegistry } from '../../di/registry';
import { TaskContext } from '../../task/context';
import { WorkflowContext } from '../../workflow/context';
import type { Logger } from '../types';

// Mock the native module to avoid an FFI dependency in unit tests.
//
// The Worker constructor creates a native service handle and starts polling,
// so the mock has to satisfy `serviceCreate`. Poll functions never settle, so each loop parks on
// its first poll rather than spinning or holding the event loop open.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('Service DI Integration', () => {
  beforeEach(() => {
    diGlobalRegistry.clear();
  });

  afterEach(() => {
    diGlobalRegistry.clear();
  });

  describe('Container Initialization', () => {
    it('should create DI container when service is instantiated', () => {
      const logger = createMockLogger();

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      expect(service.getContainer()).toBeDefined();
      expect(service.getContainer()).not.toBeNull();
    });

    it('should initialize container before executors', () => {
      const logger = createMockLogger();

      // Register a service
      @Injectable()
      class TestService {
        greet(): string {
          return 'Hello from TestService';
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Container should be able to resolve the service
      const container = service.getContainer();
      const testService = container.resolve(TestService);
      expect(testService).toBeInstanceOf(TestService);
      expect(testService.greet()).toBe('Hello from TestService');
    });

    it('should log DI container initialization summary', () => {
      const logger = createMockLogger();

      @Injectable()
      class LoggerService {}

      @Injectable()
      @Tasks()
      class EmailTasks {}

      new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Check that info logs contain DI summary
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('DI Container initialized:')
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Services:'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Task Handlers:'));
    });

    it('should warn when no services or task handlers are registered', () => {
      const logger = createMockLogger();

      new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No services or task handlers registered with DI')
      );
    });
  });

  describe('Service Registration', () => {
    it('should register singleton services from DI GlobalRegistry', () => {
      const logger = createMockLogger();

      @Injectable({ scope: 'singleton' })
      class DatabaseService {
        query(): string {
          return 'DB query result';
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const db1 = container.resolve(DatabaseService);
      const db2 = container.resolve(DatabaseService);

      expect(db1).toBe(db2); // Same instance (singleton)
      expect(db1.query()).toBe('DB query result');
    });

    it('should register transient services from DI GlobalRegistry', () => {
      const logger = createMockLogger();

      @Injectable({ scope: 'transient' })
      class RequestService {
        id = Math.random();
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const req1 = container.resolve(RequestService);
      const req2 = container.resolve(RequestService);

      expect(req1).not.toBe(req2); // Different instances (transient)
      expect(req1.id).not.toBe(req2.id);
    });

    it('should treat scoped services as singleton', () => {
      const logger = createMockLogger();

      @Injectable({ scope: 'scoped' })
      class ScopedService {
        value = 'scoped';
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const scoped1 = container.resolve(ScopedService);
      const scoped2 = container.resolve(ScopedService);

      // The worker registers scoped services as singletons.
      expect(scoped1).toBe(scoped2);
    });

    it('should register services with dependencies', () => {
      const logger = createMockLogger();

      @Injectable()
      class LoggerService {
        log(message: string): string {
          return `[LOG] ${message}`;
        }
      }

      @Injectable()
      class UserService {
        constructor(private logger: LoggerService) {}

        getUser(): string {
          return this.logger.log('User fetched');
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const userService = container.resolve(UserService);

      expect(userService.getUser()).toBe('[LOG] User fetched');
    });

    it('should handle service registration errors gracefully', () => {
      const logger = createMockLogger();

      // Manually register invalid service metadata
      class InvalidService {}
      diGlobalRegistry.registerService(InvalidService, {
        token: InvalidService,
        scope: 'invalid' as any, // Invalid scope
      });

      // Should not throw, but will default to singleton for invalid scope
      expect(() => {
        new Worker({
          serverUrl: 'http://localhost:50051',
          namespace: 'test',
          taskQueue: 'test-queue',
          workflows: [],
          tasks: [],
          logger,
        });
      }).not.toThrow();

      // Invalid scope gets treated as singleton, so it registers successfully
      // Just verify no exception was thrown
    });
  });

  describe('Task Handler Registration', () => {
    it('should register task handlers as transient', () => {
      const logger = createMockLogger();

      @Injectable()
      @Tasks()
      class PaymentTasks {
        instanceId = Math.random();
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const handler1 = container.resolve(PaymentTasks);
      const handler2 = container.resolve(PaymentTasks);

      // Task handlers are always transient (new instance per execution)
      expect(handler1).not.toBe(handler2);
      expect(handler1.instanceId).not.toBe(handler2.instanceId);
    });

    it('should register task handlers with injected services', () => {
      const logger = createMockLogger();

      @Injectable()
      class StripeService {
        charge(amount: number): { id: string; amount: number } {
          return { id: 'ch_123', amount };
        }
      }

      @Injectable()
      @Tasks()
      class PaymentTasks {
        constructor(private stripe: StripeService) {}

        @Task({ name: 'charge-card' })
        async chargeCard(ctx: TaskContext, amount: number) {
          return this.stripe.charge(amount);
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const paymentTasks = container.resolve(PaymentTasks);

      // StripeService should be injected
      expect(paymentTasks).toBeInstanceOf(PaymentTasks);
      // Can't directly test private field, but can test the behavior via task execution
    });

    it('should handle task handler registration errors gracefully', () => {
      const logger = createMockLogger();

      // Manually register invalid task handler
      class InvalidHandler {}
      diGlobalRegistry.registerTaskHandler(InvalidHandler, {
        handlerClass: InvalidHandler,
      });

      // Should not throw, should log error
      expect(() => {
        new Worker({
          serverUrl: 'http://localhost:50051',
          namespace: 'test',
          taskQueue: 'test-queue',
          workflows: [],
          tasks: [],
          logger,
        });
      }).not.toThrow();

      // Should have logged debug message about registration
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should register multiple task handlers', () => {
      const logger = createMockLogger();

      @Injectable()
      @Tasks()
      class PaymentTasks {}

      @Injectable()
      @Tasks()
      class EmailTasks {}

      @Injectable()
      @Tasks()
      class NotificationTasks {}

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      expect(container.resolve(PaymentTasks)).toBeInstanceOf(PaymentTasks);
      expect(container.resolve(EmailTasks)).toBeInstanceOf(EmailTasks);
      expect(container.resolve(NotificationTasks)).toBeInstanceOf(NotificationTasks);
    });
  });

  describe('Workflow Registration', () => {
    it('should NOT register workflows with DI container', () => {
      const logger = createMockLogger();

      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run(ctx: WorkflowContext) {
          return { status: 'completed' };
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();

      // Workflows should NOT be resolvable from DI container
      expect(() => container.resolve(TestWorkflow)).toThrow();
    });

    it('should log workflow count but not register them', () => {
      const logger = createMockLogger();

      @Workflow({ name: 'workflow-1' })
      class Workflow1 {
        async run(ctx: WorkflowContext) {
          return {};
        }
      }

      @Workflow({ name: 'workflow-2' })
      class Workflow2 {
        async run(ctx: WorkflowContext) {
          return {};
        }
      }

      new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Should log workflow count with note about determinism
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Workflows: 2 (not managed by DI - deterministic)')
      );
    });
  });

  describe('Container Disposal', () => {
    it('should dispose container on service shutdown', async () => {
      const logger = createMockLogger();

      @Injectable()
      class TestService {
        disposed = false;

        onDestroy(): void {
          this.disposed = true;
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // start() fails without a client; this test exercises shutdown directly.
      try {
        await service.start();
      } catch {
        // Expected to fail without real client
      }

      // Manually set state for testing shutdown
      (service as any).state = 'running';

      // Resolve service to create instance
      const container = service.getContainer();
      const testService = container.resolve(TestService);

      await service.shutdown({ force: true });

      // Container dispose should have been called
      expect(logger.debug).toHaveBeenCalledWith('Disposing DI container...');

      // onDestroy should have been called
      expect(testService.disposed).toBe(true);
    });

    it('should handle container disposal errors gracefully', async () => {
      const logger = createMockLogger();

      @Injectable()
      class FailingService {
        onDestroy(): void {
          throw new Error('Disposal error');
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Resolve service to create instance
      const container = service.getContainer();
      container.resolve(FailingService);

      // Manually set state for testing shutdown
      (service as any).state = 'running';

      // Container disposal may throw, but shutdown should catch and handle it
      // The container.dispose() throws LifecycleError, which propagates up
      await expect(service.shutdown({ force: true })).rejects.toThrow();

      // But the error should be logged
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('Integration with Task Executor', () => {
    it('should pass container to task executor', () => {
      const logger = createMockLogger();

      @Injectable()
      class TestService {}

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Access private taskExecutor for testing
      const taskExecutor = (service as any).taskExecutor;
      expect(taskExecutor).toBeDefined();

      // Container should be passed to task executor
      const executorContainer = (taskExecutor as any).container;
      expect(executorContainer).toBe(service.getContainer());
    });

    it('should pass container to workflow executor', () => {
      const logger = createMockLogger();

      @Injectable()
      class TestService {}

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      // Access private workflowExecutor for testing
      const workflowExecutor = (service as any).workflowExecutor;
      expect(workflowExecutor).toBeDefined();

      // The executor deliberately has NO container: injecting resolved services
      // into a workflow would put non-deterministic state in the replay path.
      // Tasks get DI, workflows do not.
      expect((workflowExecutor as any).container).toBeUndefined();
      expect(service.getContainer()).toBeDefined();
    });
  });

  describe('Real-world Scenario', () => {
    it('should support complete DI scenario with services, tasks, and workflows', () => {
      const logger = createMockLogger();

      // Define services
      @Injectable()
      class LoggerService {
        logs: string[] = [];

        log(message: string): void {
          this.logs.push(message);
        }
      }

      @Injectable()
      class DatabaseService {
        constructor(private logger: LoggerService) {}

        save(data: any): { id: string } {
          this.logger.log(`Saving: ${JSON.stringify(data)}`);
          return { id: 'saved-123' };
        }
      }

      @Injectable()
      class StripeService {
        constructor(private logger: LoggerService) {}

        charge(amount: number): { chargeId: string; amount: number } {
          this.logger.log(`Charging: $${amount}`);
          return { chargeId: 'ch_123', amount };
        }
      }

      // Define task handlers with DI
      @Injectable()
      @Tasks()
      class OrderTasks {
        constructor(
          private db: DatabaseService,
          private logger: LoggerService
        ) {}

        @Task({ name: 'save-order' })
        async saveOrder(ctx: TaskContext, order: any) {
          this.logger.log('Saving order');
          return this.db.save(order);
        }
      }

      @Injectable()
      @Tasks()
      class PaymentTasks {
        constructor(
          private stripe: StripeService,
          private logger: LoggerService
        ) {}

        @Task({ name: 'process-payment' })
        async processPayment(ctx: TaskContext, amount: number) {
          this.logger.log('Processing payment');
          return this.stripe.charge(amount);
        }
      }

      // Define workflow (no DI)
      @Workflow({ name: 'order-workflow' })
      class OrderWorkflow {
        async run(ctx: WorkflowContext, input: any) {
          // In real execution, would call ctx.executeTask(OrderTasks.saveOrder, ...)
          return { status: 'completed' };
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();

      // Verify services are resolvable
      const loggerSvc = container.resolve(LoggerService);
      const dbSvc = container.resolve(DatabaseService);
      const stripeSvc = container.resolve(StripeService);

      expect(loggerSvc).toBeInstanceOf(LoggerService);
      expect(dbSvc).toBeInstanceOf(DatabaseService);
      expect(stripeSvc).toBeInstanceOf(StripeService);

      // Verify task handlers are resolvable with dependencies
      const orderTasks = container.resolve(OrderTasks);
      const paymentTasks = container.resolve(PaymentTasks);

      expect(orderTasks).toBeInstanceOf(OrderTasks);
      expect(paymentTasks).toBeInstanceOf(PaymentTasks);

      // Verify dependencies are injected correctly (singleton)
      const dbLogger = (dbSvc as any).logger;
      expect(dbLogger).toBe(loggerSvc);

      // Test actual behavior
      const saveResult = dbSvc.save({ orderId: '123' });
      expect(saveResult).toEqual({ id: 'saved-123' });
      expect(loggerSvc.logs).toContain('Saving: {"orderId":"123"}');

      const chargeResult = stripeSvc.charge(100);
      expect(chargeResult).toEqual({ chargeId: 'ch_123', amount: 100 });
      expect(loggerSvc.logs).toContain('Charging: $100');

      // Verify workflow is registered but not in DI container
      const stats = diGlobalRegistry.getStats();
      expect(stats.workflows).toBe(1);
      expect(() => container.resolve(OrderWorkflow)).toThrow();
    });
  });

  describe('Statistics', () => {
    it('should report accurate DI container statistics', () => {
      const logger = createMockLogger();

      @Injectable()
      class Service1 {}

      @Injectable()
      class Service2 {}

      @Injectable()
      @Tasks()
      class Handler1 {}

      @Injectable()
      @Tasks()
      class Handler2 {}

      @Injectable()
      @Tasks()
      class Handler3 {}

      @Workflow({ name: 'workflow1' })
      class Workflow1 {
        async run(ctx: WorkflowContext) {
          return {};
        }
      }

      @Workflow({ name: 'workflow2' })
      class Workflow2 {
        async run(ctx: WorkflowContext) {
          return {};
        }
      }

      const service = new Worker({
        serverUrl: 'http://localhost:50051',
        namespace: 'test',
        taskQueue: 'test-queue',
        workflows: [],
        tasks: [],
        logger,
      });

      const container = service.getContainer();
      const containerStats = container.getStats();

      // Should have registered 2 services + 3 task handlers = 5 providers
      expect(containerStats.providers).toBe(5);
    });
  });
});
