/**
 * Tests for GlobalRegistry
 * @packageDocumentation
 */

import { GlobalRegistry } from '../registry';
import type {
  ServiceMetadata,
  TaskHandlerMetadata,
  TaskMetadata,
  WorkflowMetadata,
} from '../types';

describe('GlobalRegistry', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    // The registry is a process-wide singleton, so each test starts and ends empty.
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = GlobalRegistry.getInstance();
      const instance2 = GlobalRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should maintain state across getInstance calls', () => {
      const instance1 = GlobalRegistry.getInstance();

      class TestService {}
      const metadata: ServiceMetadata = {
        token: TestService,
        scope: 'singleton',
      };

      instance1.registerService(TestService, metadata);

      const instance2 = GlobalRegistry.getInstance();
      expect(instance2.hasService(TestService)).toBe(true);
    });
  });

  describe('Service Registration', () => {
    it('should register a service', () => {
      class MyService {}
      const metadata: ServiceMetadata = {
        token: MyService,
        scope: 'singleton',
      };

      registry.registerService(MyService, metadata);

      expect(registry.hasService(MyService)).toBe(true);
      expect(registry.getService(MyService)).toEqual(metadata);
    });

    it('should register multiple services', () => {
      class ServiceA {}
      class ServiceB {}
      class ServiceC {}

      const metadataA: ServiceMetadata = { token: ServiceA, scope: 'singleton' };
      const metadataB: ServiceMetadata = { token: ServiceB, scope: 'transient' };
      const metadataC: ServiceMetadata = { token: ServiceC, scope: 'singleton' };

      registry.registerService(ServiceA, metadataA);
      registry.registerService(ServiceB, metadataB);
      registry.registerService(ServiceC, metadataC);

      expect(registry.hasService(ServiceA)).toBe(true);
      expect(registry.hasService(ServiceB)).toBe(true);
      expect(registry.hasService(ServiceC)).toBe(true);
    });

    it('should overwrite existing service with warning', () => {
      class MyService {}
      const metadata1: ServiceMetadata = { token: MyService, scope: 'singleton' };
      const metadata2: ServiceMetadata = { token: MyService, scope: 'transient' };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerService(MyService, metadata1);
      registry.registerService(MyService, metadata2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MyService is already registered')
      );
      expect(registry.getService(MyService)).toEqual(metadata2);

      warnSpy.mockRestore();
    });

    it('should return undefined for unregistered service', () => {
      class UnregisteredService {}
      expect(registry.getService(UnregisteredService)).toBeUndefined();
    });

    it('should return false for hasService on unregistered service', () => {
      class UnregisteredService {}
      expect(registry.hasService(UnregisteredService)).toBe(false);
    });

    it('should get all services', () => {
      class ServiceA {}
      class ServiceB {}

      const metadataA: ServiceMetadata = { token: ServiceA, scope: 'singleton' };
      const metadataB: ServiceMetadata = { token: ServiceB, scope: 'transient' };

      registry.registerService(ServiceA, metadataA);
      registry.registerService(ServiceB, metadataB);

      const allServices = registry.getAllServices();

      expect(allServices.size).toBe(2);
      expect(allServices.get(ServiceA)).toEqual(metadataA);
      expect(allServices.get(ServiceB)).toEqual(metadataB);
    });

    it('should return a copy of services map', () => {
      class MyService {}
      const metadata: ServiceMetadata = { token: MyService, scope: 'singleton' };

      registry.registerService(MyService, metadata);

      const allServices1 = registry.getAllServices();
      const allServices2 = registry.getAllServices();

      expect(allServices1).not.toBe(allServices2);
      expect(allServices1).toEqual(allServices2);
    });
  });

  describe('Task Handler Registration', () => {
    it('should register a task handler', () => {
      class MyTaskHandler {}
      const metadata: TaskHandlerMetadata = {
        handlerClass: MyTaskHandler,
      };

      registry.registerTaskHandler(MyTaskHandler, metadata);

      expect(registry.hasTaskHandler(MyTaskHandler)).toBe(true);
      expect(registry.getTaskHandler(MyTaskHandler)).toEqual(metadata);
    });

    it('should register multiple task handlers', () => {
      class HandlerA {}
      class HandlerB {}

      const metadataA: TaskHandlerMetadata = { handlerClass: HandlerA };
      const metadataB: TaskHandlerMetadata = { handlerClass: HandlerB };

      registry.registerTaskHandler(HandlerA, metadataA);
      registry.registerTaskHandler(HandlerB, metadataB);

      expect(registry.hasTaskHandler(HandlerA)).toBe(true);
      expect(registry.hasTaskHandler(HandlerB)).toBe(true);
    });

    it('should overwrite existing handler with warning', () => {
      class MyHandler {}
      const metadata1: TaskHandlerMetadata = { handlerClass: MyHandler };
      const metadata2: TaskHandlerMetadata = { handlerClass: MyHandler };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerTaskHandler(MyHandler, metadata1);
      registry.registerTaskHandler(MyHandler, metadata2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MyHandler is already registered')
      );

      warnSpy.mockRestore();
    });

    it('should return undefined for unregistered handler', () => {
      class UnregisteredHandler {}
      expect(registry.getTaskHandler(UnregisteredHandler)).toBeUndefined();
    });

    it('should get all task handlers', () => {
      class HandlerA {}
      class HandlerB {}

      const metadataA: TaskHandlerMetadata = { handlerClass: HandlerA };
      const metadataB: TaskHandlerMetadata = { handlerClass: HandlerB };

      registry.registerTaskHandler(HandlerA, metadataA);
      registry.registerTaskHandler(HandlerB, metadataB);

      const allHandlers = registry.getAllTaskHandlers();

      expect(allHandlers.size).toBe(2);
      expect(allHandlers.get(HandlerA)).toEqual(metadataA);
      expect(allHandlers.get(HandlerB)).toEqual(metadataB);
    });
  });

  describe('Task Registration', () => {
    it('should register a task', () => {
      class MyHandler {}
      const metadata: TaskMetadata = {
        taskName: 'my.task',
        handlerClass: MyHandler,
        methodName: 'execute',
        options: {},
      };

      registry.registerTask('my.task', metadata);

      expect(registry.hasTask('my.task')).toBe(true);
      expect(registry.getTask('my.task')).toEqual(metadata);
    });

    it('should register multiple tasks', () => {
      class Handler {}
      const metadata1: TaskMetadata = {
        taskName: 'task.one',
        handlerClass: Handler,
        methodName: 'executeOne',
        options: {},
      };
      const metadata2: TaskMetadata = {
        taskName: 'task.two',
        handlerClass: Handler,
        methodName: 'executeTwo',
        options: {},
      };

      registry.registerTask('task.one', metadata1);
      registry.registerTask('task.two', metadata2);

      expect(registry.hasTask('task.one')).toBe(true);
      expect(registry.hasTask('task.two')).toBe(true);
    });

    it('should overwrite existing task with warning', () => {
      class Handler {}
      const metadata1: TaskMetadata = {
        taskName: 'my.task',
        handlerClass: Handler,
        methodName: 'execute',
        options: {},
      };
      const metadata2: TaskMetadata = {
        taskName: 'my.task',
        handlerClass: Handler,
        methodName: 'executeV2',
        options: {},
      };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerTask('my.task', metadata1);
      registry.registerTask('my.task', metadata2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"my.task" is already registered')
      );
      expect(registry.getTask('my.task')).toEqual(metadata2);

      warnSpy.mockRestore();
    });

    it('should return undefined for unregistered task', () => {
      expect(registry.getTask('unregistered.task')).toBeUndefined();
    });

    it('should get all tasks', () => {
      class Handler {}
      const metadata1: TaskMetadata = {
        taskName: 'task.one',
        handlerClass: Handler,
        methodName: 'executeOne',
        options: {},
      };
      const metadata2: TaskMetadata = {
        taskName: 'task.two',
        handlerClass: Handler,
        methodName: 'executeTwo',
        options: {},
      };

      registry.registerTask('task.one', metadata1);
      registry.registerTask('task.two', metadata2);

      const allTasks = registry.getAllTasks();

      expect(allTasks.size).toBe(2);
      expect(allTasks.get('task.one')).toEqual(metadata1);
      expect(allTasks.get('task.two')).toEqual(metadata2);
    });
  });

  describe('Workflow Registration', () => {
    it('should register a workflow', () => {
      class MyWorkflow {}
      const metadata: WorkflowMetadata = {
        name: 'my-workflow',
        workflowClass: MyWorkflow,
        version: '1.0',
      };

      registry.registerWorkflow('my-workflow', metadata);

      expect(registry.hasWorkflow('my-workflow')).toBe(true);
      expect(registry.getWorkflow('my-workflow')).toEqual(metadata);
    });

    it('should register multiple workflows', () => {
      class WorkflowA {}
      class WorkflowB {}

      const metadataA: WorkflowMetadata = {
        name: 'workflow-a',
        workflowClass: WorkflowA,
        version: '1.0',
      };
      const metadataB: WorkflowMetadata = {
        name: 'workflow-b',
        workflowClass: WorkflowB,
        version: '2.0',
      };

      registry.registerWorkflow('workflow-a', metadataA);
      registry.registerWorkflow('workflow-b', metadataB);

      expect(registry.hasWorkflow('workflow-a')).toBe(true);
      expect(registry.hasWorkflow('workflow-b')).toBe(true);
    });

    it('should overwrite existing workflow with warning', () => {
      class MyWorkflow {}
      const metadata1: WorkflowMetadata = {
        name: 'my-workflow',
        workflowClass: MyWorkflow,
        version: '1.0',
      };
      const metadata2: WorkflowMetadata = {
        name: 'my-workflow',
        workflowClass: MyWorkflow,
        version: '2.0',
      };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerWorkflow('my-workflow', metadata1);
      registry.registerWorkflow('my-workflow', metadata2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"my-workflow" is already registered')
      );
      expect(registry.getWorkflow('my-workflow')).toEqual(metadata2);

      warnSpy.mockRestore();
    });

    it('should return undefined for unregistered workflow', () => {
      expect(registry.getWorkflow('unregistered-workflow')).toBeUndefined();
    });

    it('should get all workflows', () => {
      class WorkflowA {}
      class WorkflowB {}

      const metadataA: WorkflowMetadata = {
        name: 'workflow-a',
        workflowClass: WorkflowA,
        version: '1.0',
      };
      const metadataB: WorkflowMetadata = {
        name: 'workflow-b',
        workflowClass: WorkflowB,
        version: '2.0',
      };

      registry.registerWorkflow('workflow-a', metadataA);
      registry.registerWorkflow('workflow-b', metadataB);

      const allWorkflows = registry.getAllWorkflows();

      expect(allWorkflows.size).toBe(2);
      expect(allWorkflows.get('workflow-a')).toEqual(metadataA);
      expect(allWorkflows.get('workflow-b')).toEqual(metadataB);
    });
  });

  describe('Clear', () => {
    it('should clear all registrations', () => {
      // Register one of each type
      class MyService {}
      class MyHandler {}
      class MyWorkflow {}

      registry.registerService(MyService, { token: MyService, scope: 'singleton' });
      registry.registerTaskHandler(MyHandler, { handlerClass: MyHandler });
      registry.registerTask('my.task', {
        taskName: 'my.task',
        handlerClass: MyHandler,
        methodName: 'execute',
        options: {},
      });
      registry.registerWorkflow('my-workflow', {
        name: 'my-workflow',
        workflowClass: MyWorkflow,
        version: '1.0',
      });

      // Verify they're registered
      expect(registry.hasService(MyService)).toBe(true);
      expect(registry.hasTaskHandler(MyHandler)).toBe(true);
      expect(registry.hasTask('my.task')).toBe(true);
      expect(registry.hasWorkflow('my-workflow')).toBe(true);

      registry.clear();

      // Verify they're gone
      expect(registry.hasService(MyService)).toBe(false);
      expect(registry.hasTaskHandler(MyHandler)).toBe(false);
      expect(registry.hasTask('my.task')).toBe(false);
      expect(registry.hasWorkflow('my-workflow')).toBe(false);
    });

    it('should return empty stats after clear', () => {
      class MyService {}
      registry.registerService(MyService, { token: MyService, scope: 'singleton' });

      registry.clear();

      const stats = registry.getStats();
      expect(stats.services).toBe(0);
      expect(stats.taskHandlers).toBe(0);
      expect(stats.tasks).toBe(0);
      expect(stats.workflows).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return correct stats', () => {
      class ServiceA {}
      class ServiceB {}
      class HandlerA {}
      class WorkflowA {}

      registry.registerService(ServiceA, { token: ServiceA, scope: 'singleton' });
      registry.registerService(ServiceB, { token: ServiceB, scope: 'transient' });
      registry.registerTaskHandler(HandlerA, { handlerClass: HandlerA });
      registry.registerTask('task.one', {
        taskName: 'task.one',
        handlerClass: HandlerA,
        methodName: 'execute',
        options: {},
      });
      registry.registerTask('task.two', {
        taskName: 'task.two',
        handlerClass: HandlerA,
        methodName: 'execute',
        options: {},
      });
      registry.registerTask('task.three', {
        taskName: 'task.three',
        handlerClass: HandlerA,
        methodName: 'execute',
        options: {},
      });
      registry.registerWorkflow('workflow-a', {
        name: 'workflow-a',
        workflowClass: WorkflowA,
        version: '1.0',
      });

      const stats = registry.getStats();

      expect(stats.services).toBe(2);
      expect(stats.taskHandlers).toBe(1);
      expect(stats.tasks).toBe(3);
      expect(stats.workflows).toBe(1);
    });

    it('should return zero stats for empty registry', () => {
      const stats = registry.getStats();

      expect(stats.services).toBe(0);
      expect(stats.taskHandlers).toBe(0);
      expect(stats.tasks).toBe(0);
      expect(stats.workflows).toBe(0);
    });
  });

  describe('Summary', () => {
    it('should return formatted summary', () => {
      class ServiceA {}
      class HandlerA {}

      registry.registerService(ServiceA, { token: ServiceA, scope: 'singleton' });
      registry.registerTaskHandler(HandlerA, { handlerClass: HandlerA });

      const summary = registry.getSummary();

      expect(summary).toContain('GlobalRegistry Summary');
      expect(summary).toContain('Services: 1');
      expect(summary).toContain('Task Handlers: 1');
      expect(summary).toContain('Tasks: 0');
      expect(summary).toContain('Workflows: 0');
    });

    it('should handle empty registry', () => {
      const summary = registry.getSummary();

      expect(summary).toContain('Services: 0');
      expect(summary).toContain('Task Handlers: 0');
      expect(summary).toContain('Tasks: 0');
      expect(summary).toContain('Workflows: 0');
    });
  });

  describe('Integration', () => {
    it('should handle complex registration scenario', () => {
      // Simulate a real application setup
      class LoggerService {}
      class DatabaseService {}
      class PaymentService {}

      class PaymentTasks {}
      class OrderTasks {}

      class CheckoutWorkflow {}
      class RefundWorkflow {}

      // Register services
      registry.registerService(LoggerService, { token: LoggerService, scope: 'singleton' });
      registry.registerService(DatabaseService, { token: DatabaseService, scope: 'singleton' });
      registry.registerService(PaymentService, { token: PaymentService, scope: 'singleton' });

      // Register task handlers
      registry.registerTaskHandler(PaymentTasks, { handlerClass: PaymentTasks });
      registry.registerTaskHandler(OrderTasks, { handlerClass: OrderTasks });

      // Register tasks
      registry.registerTask('payment.charge', {
        taskName: 'payment.charge',
        handlerClass: PaymentTasks,
        methodName: 'chargeCard',
        options: { timeout: 30000 },
      });
      registry.registerTask('payment.refund', {
        taskName: 'payment.refund',
        handlerClass: PaymentTasks,
        methodName: 'refundPayment',
        options: { timeout: 30000 },
      });
      registry.registerTask('order.create', {
        taskName: 'order.create',
        handlerClass: OrderTasks,
        methodName: 'createOrder',
        options: {},
      });

      // Register workflows
      registry.registerWorkflow('checkout', {
        name: 'checkout',
        workflowClass: CheckoutWorkflow,
        version: '1.0',
      });
      registry.registerWorkflow('refund', {
        name: 'refund',
        workflowClass: RefundWorkflow,
        version: '1.0',
      });

      // Verify everything is registered
      expect(registry.getAllServices().size).toBe(3);
      expect(registry.getAllTaskHandlers().size).toBe(2);
      expect(registry.getAllTasks().size).toBe(3);
      expect(registry.getAllWorkflows().size).toBe(2);

      const stats = registry.getStats();
      expect(stats.services).toBe(3);
      expect(stats.taskHandlers).toBe(2);
      expect(stats.tasks).toBe(3);
      expect(stats.workflows).toBe(2);
    });
  });
});
