/**
 * Integration Tests - All Decorators Working Together
 * @packageDocumentation
 */

import { Injectable } from '../decorators/injectable';
import { Tasks } from '../decorators/tasks';
import { Task } from '../decorators/task';
import { Workflow } from '../decorators/workflow';
import { Inject } from '../decorators/inject';
import { OrcherContainer } from '../container';
import { GlobalRegistry } from '../registry';

describe('Decorators Integration', () => {
  let container: OrcherContainer;
  let registry: GlobalRegistry;

  beforeEach(() => {
    container = new OrcherContainer();
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    container.clear();
    registry.clear();
  });

  describe('Complete DI Stack', () => {
    it('should work with all decorators together', () => {
      // Define injectable services
      @Injectable()
      class LoggerService {
        log(message: string) {
          return `LOG: ${message}`;
        }
      }

      @Injectable()
      class StripeService {
        constructor(private logger: LoggerService) {}

        async charge(amount: number, token: string) {
          this.logger.log(`Charging ${amount}`);
          return { id: 'ch_123', amount, token, status: 'success' };
        }
      }

      // Define task handler with DI
      @Injectable()
      @Tasks()
      class PaymentTasks {
        constructor(
          private stripe: StripeService,
          private logger: LoggerService
        ) {}

        @Task({ name: 'charge-card' })
        async chargeCard(ctx: any, input: { amount: number; token: string }) {
          this.logger.log('Processing charge');
          return this.stripe.charge(input.amount, input.token);
        }

        @Task({ name: 'refund-card' })
        async refundCard(ctx: any, input: { chargeId: string; amount: number }) {
          this.logger.log('Processing refund');
          return { id: 'ref_123', chargeId: input.chargeId, amount: input.amount };
        }
      }

      // Define workflow (NO DI)
      @Workflow({ name: 'payment-workflow', version: '1.0' })
      class PaymentWorkflow {
        async run(ctx: any, input: { amount: number; token: string }) {
          // Workflow uses TaskReference (no DI)
          return { success: true, input };
        }
      }

      // Verify all registrations
      expect(registry.hasService(LoggerService)).toBe(true);
      expect(registry.hasService(StripeService)).toBe(true);
      expect(registry.hasTaskHandler(PaymentTasks)).toBe(true);
      expect(registry.hasTask('charge-card')).toBe(true);
      expect(registry.hasTask('refund-card')).toBe(true);
      expect(registry.hasWorkflow('payment-workflow')).toBe(true);

      // Verify TaskReferences were created (static properties use taskName)
      expect((PaymentTasks as any)['charge-card']).toBeDefined();
      expect((PaymentTasks as any)['charge-card'].taskName).toBe('charge-card');
      expect((PaymentTasks as any)['refund-card']).toBeDefined();
      expect((PaymentTasks as any)['refund-card'].taskName).toBe('refund-card');

      // Register and resolve with container
      container.registerSingleton(LoggerService);
      container.registerSingleton(StripeService);
      container.registerSingleton(PaymentTasks);

      const tasks = container.resolve(PaymentTasks);
      expect(tasks).toBeInstanceOf(PaymentTasks);

      // Verify DI worked
      const result = tasks.chargeCard({}, { amount: 100, token: 'tok_123' });
      expect(result).resolves.toEqual({
        id: 'ch_123',
        amount: 100,
        token: 'tok_123',
        status: 'success',
      });
    });

    it('should support custom tokens with @Inject', () => {
      const ICache = Symbol('ICache');
      const API_KEY = 'API_KEY';

      interface ICache {
        get(key: string): any;
        set(key: string, value: any): void;
      }

      class MemoryCache implements ICache {
        private data = new Map<string, any>();

        get(key: string) {
          return this.data.get(key);
        }

        set(key: string, value: any) {
          this.data.set(key, value);
        }
      }

      @Injectable()
      @Tasks()
      class ApiTasks {
        constructor(
          @Inject(ICache) private cache: ICache,
          @Inject(API_KEY) private apiKey: string
        ) {}

        @Task({ name: 'fetch-data' })
        async fetchData(ctx: any, url: string) {
          const cached = this.cache.get(url);
          if (cached) return cached;

          const data = { url, key: this.apiKey, data: 'fresh' };
          this.cache.set(url, data);
          return data;
        }
      }

      // Register with custom tokens
      container.register({ token: ICache, useClass: MemoryCache });
      container.register({ token: API_KEY, useValue: 'secret-key-123' });
      container.registerSingleton(ApiTasks);

      const tasks = container.resolve(ApiTasks);
      const result = tasks.fetchData({}, 'https://api.example.com');

      expect(result).resolves.toEqual({
        url: 'https://api.example.com',
        key: 'secret-key-123',
        data: 'fresh',
      });

      // Verify registry
      expect(registry.hasTaskHandler(ApiTasks)).toBe(true);
      expect(registry.hasTask('fetch-data')).toBe(true);
    });
  });

  describe('Real-World E-commerce Scenario', () => {
    it('should handle complete order workflow with DI', () => {
      // Services layer
      @Injectable()
      class EmailService {
        async send(to: string, subject: string, body: string) {
          return { sent: true, to, subject };
        }
      }

      @Injectable()
      class PaymentService {
        async charge(amount: number) {
          return { id: `charge_${Date.now()}`, amount, status: 'succeeded' };
        }
      }

      @Injectable()
      class InventoryService {
        async reserve(items: string[]) {
          return { reserved: items, reservationId: `res_${Date.now()}` };
        }
      }

      @Injectable()
      class ShippingService {
        async createShipment(orderId: string, address: string) {
          return { trackingNumber: `TRK${Date.now()}`, orderId, address };
        }
      }

      // Task handlers layer
      @Injectable()
      @Tasks()
      class OrderTasks {
        constructor(
          private payment: PaymentService,
          private inventory: InventoryService,
          private email: EmailService
        ) {}

        @Task({ name: 'validate-order' })
        async validateOrder(ctx: any, order: any) {
          return { valid: order.total > 0 && order.items.length > 0 };
        }

        @Task({ name: 'process-payment' })
        async processPayment(ctx: any, total: number) {
          return this.payment.charge(total);
        }

        @Task({ name: 'reserve-inventory' })
        async reserveInventory(ctx: any, items: string[]) {
          return this.inventory.reserve(items);
        }

        @Task({ name: 'send-confirmation' })
        async sendConfirmation(ctx: any, email: string) {
          return this.email.send(email, 'Order Confirmation', 'Thank you!');
        }
      }

      @Injectable()
      @Tasks()
      class ShippingTasks {
        constructor(private shipping: ShippingService) {}

        @Task({ name: 'create-shipment' })
        async createShipment(ctx: any, orderId: string, address: string) {
          return this.shipping.createShipment(orderId, address);
        }
      }

      // Workflow layer (NO DI)
      @Workflow({
        name: 'order-fulfillment',
        version: '1.0',
        description: 'Complete order fulfillment workflow',
      })
      class OrderFulfillmentWorkflow {
        async run(ctx: any, order: any) {
          // Workflow is deterministic - no DI, only TaskReferences
          // TaskReferences are accessed via taskName (e.g., 'validate-order')
          return {
            orderId: order.id,
            status: 'workflow-ready',
            taskRefs: {
              validate: (OrderTasks as any)['validate-order'],
              payment: (OrderTasks as any)['process-payment'],
              inventory: (OrderTasks as any)['reserve-inventory'],
              shipping: (ShippingTasks as any)['create-shipment'],
              confirmation: (OrderTasks as any)['send-confirmation'],
            },
          };
        }
      }

      // Verify all registrations
      expect(registry.hasService(EmailService)).toBe(true);
      expect(registry.hasService(PaymentService)).toBe(true);
      expect(registry.hasService(InventoryService)).toBe(true);
      expect(registry.hasService(ShippingService)).toBe(true);
      expect(registry.hasTaskHandler(OrderTasks)).toBe(true);
      expect(registry.hasTaskHandler(ShippingTasks)).toBe(true);
      expect(registry.hasWorkflow('order-fulfillment')).toBe(true);

      // Verify TaskReferences (static properties use taskName)
      expect((OrderTasks as any)['validate-order']).toBeDefined();
      expect((OrderTasks as any)['process-payment']).toBeDefined();
      expect((OrderTasks as any)['reserve-inventory']).toBeDefined();
      expect((OrderTasks as any)['send-confirmation']).toBeDefined();
      expect((ShippingTasks as any)['create-shipment']).toBeDefined();

      // Register with container
      container.registerSingleton(EmailService);
      container.registerSingleton(PaymentService);
      container.registerSingleton(InventoryService);
      container.registerSingleton(ShippingService);
      container.registerSingleton(OrderTasks);
      container.registerSingleton(ShippingTasks);

      // Resolve and test
      const orderTasks = container.resolve(OrderTasks);
      const shippingTasks = container.resolve(ShippingTasks);

      expect(orderTasks).toBeInstanceOf(OrderTasks);
      expect(shippingTasks).toBeInstanceOf(ShippingTasks);

      // Test task execution
      const validation = orderTasks.validateOrder(
        {},
        {
          total: 100,
          items: ['item1', 'item2'],
        }
      );
      expect(validation).resolves.toEqual({ valid: true });

      const payment = orderTasks.processPayment({}, 100);
      expect(payment).resolves.toMatchObject({
        amount: 100,
        status: 'succeeded',
      });
    });
  });

  describe('Mixed Decorator Patterns', () => {
    it('should support mixed DI and non-DI classes', () => {
      // Service with DI
      @Injectable()
      class Logger {
        log(msg: string) {
          return msg;
        }
      }

      // Task handler with DI
      @Injectable()
      @Tasks()
      class TasksWithDI {
        constructor(private logger: Logger) {}

        @Task()
        async task1(ctx: any) {
          return this.logger.log('task1');
        }
      }

      // Workflow without DI (correct pattern)
      @Workflow({ name: 'workflow-no-di' })
      class WorkflowNoDI {
        async run(ctx: any) {
          return { message: 'workflows should not use DI' };
        }
      }

      expect(registry.hasService(Logger)).toBe(true);
      expect(registry.hasTaskHandler(TasksWithDI)).toBe(true);
      expect(registry.hasWorkflow('workflow-no-di')).toBe(true);

      // Workflow should NOT be registered as service
      expect(registry.hasService(WorkflowNoDI)).toBe(false);
    });

    it('should support multiple task handlers sharing services', () => {
      const ILogger = Symbol('ILogger');

      @Injectable()
      class Logger {
        log(msg: string) {
          return `LOG: ${msg}`;
        }
      }

      @Injectable()
      @Tasks()
      class TaskHandlerA {
        constructor(@Inject(ILogger) private logger: Logger) {}

        @Task()
        async taskA(ctx: any) {
          return this.logger.log('A');
        }
      }

      @Injectable()
      @Tasks()
      class TaskHandlerB {
        constructor(@Inject(ILogger) private logger: Logger) {}

        @Task()
        async taskB(ctx: any) {
          return this.logger.log('B');
        }
      }

      container.register({ token: ILogger, useClass: Logger });
      container.registerSingleton(TaskHandlerA);
      container.registerSingleton(TaskHandlerB);

      const handlerA = container.resolve(TaskHandlerA);
      const handlerB = container.resolve(TaskHandlerB);

      expect(handlerA.taskA({})).resolves.toBe('LOG: A');
      expect(handlerB.taskB({})).resolves.toBe('LOG: B');
    });
  });

  describe('Registry Statistics', () => {
    it('should track all registrations correctly', () => {
      @Injectable()
      class Service1 {}

      @Injectable()
      class Service2 {}

      @Injectable()
      @Tasks()
      class TaskHandler1 {
        @Task()
        async task1() {}

        @Task()
        async task2() {}
      }

      @Injectable()
      @Tasks()
      class TaskHandler2 {
        @Task()
        async task3() {}
      }

      @Workflow({ name: 'workflow1' })
      class Workflow1 {
        async run() {}
      }

      @Workflow({ name: 'workflow2' })
      class Workflow2 {
        async run() {}
      }

      const stats = registry.getStats();

      expect(stats.services).toBe(4); // Service1, Service2, TaskHandler1, TaskHandler2
      expect(stats.taskHandlers).toBe(2); // TaskHandler1, TaskHandler2
      expect(stats.tasks).toBe(3); // task1, task2, task3
      expect(stats.workflows).toBe(2); // workflow1, workflow2
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing dependencies gracefully', () => {
      @Injectable()
      class MissingDep {}

      @Injectable()
      @Tasks()
      class TasksWithMissingDep {
        constructor(private dep: MissingDep) {}

        @Task()
        async task() {}
      }

      container.registerSingleton(TasksWithMissingDep);
      // MissingDep is deliberately not registered.

      expect(() => container.resolve(TasksWithMissingDep)).toThrow();
    });

    // Circular dependency detection is covered in container.test.ts.
  });

  describe('Type Safety', () => {
    it('should preserve types through DI resolution', () => {
      @Injectable()
      class TypedService {
        getValue(): number {
          return 42;
        }
      }

      @Injectable()
      @Tasks()
      class TypedTasks {
        constructor(private service: TypedService) {}

        @Task()
        async getTypedValue(ctx: any): Promise<number> {
          return this.service.getValue();
        }
      }

      container.registerSingleton(TypedService);
      container.registerSingleton(TypedTasks);

      const tasks = container.resolve(TypedTasks);
      const value = tasks.getTypedValue({});

      expect(value).resolves.toBe(42);
    });
  });
});
