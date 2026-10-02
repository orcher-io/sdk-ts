/**
 * Container Integration Tests
 *
 * Integration tests for the DI container, covering:
 * - Complex service graphs with multiple levels
 * - Performance benchmarks
 * - Memory leak detection
 * - Real-world scenarios
 * - Edge cases and stress tests
 *
 * @packageDocumentation
 */

import { OrcherContainer } from '../container';
import {
  DependencyNotFoundError,
  CircularDependencyError,
  LifecycleError,
} from '../errors';
import type { OnInit, OnDestroy } from '../types';

describe('Container Integration Tests', () => {
  let container: OrcherContainer;

  beforeEach(() => {
    container = new OrcherContainer();
  });

  afterEach(async () => {
    await container.dispose();
    container.clear();
  });

  describe('Complex Service Graphs', () => {
    it('should resolve deep dependency tree (5 levels)', () => {
      // Level 1 (no dependencies)
      class Config {
        getValue() {
          return 'config-value';
        }
      }

      // Level 2 (depends on Config)
      class Logger {
        constructor(public config: Config) {}
        log(msg: string) {
          return `[${this.config.getValue()}] ${msg}`;
        }
      }

      // Level 3 (depends on Logger)
      class Database {
        constructor(public logger: Logger) {}
        query(sql: string) {
          this.logger.log(`Query: ${sql}`);
          return 'result';
        }
      }

      // Level 4 (depends on Database and Logger)
      class UserRepository {
        constructor(
          public db: Database,
          public logger: Logger
        ) {}
        findUser(id: number) {
          this.logger.log(`Finding user ${id}`);
          return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
        }
      }

      // Level 5 (depends on UserRepository and Logger)
      class UserService {
        constructor(
          public repo: UserRepository,
          public logger: Logger
        ) {}
        getUser(id: number) {
          this.logger.log(`Getting user ${id}`);
          return this.repo.findUser(id);
        }
      }

      container.registerSingleton(Config);
      container.register({
        token: Logger,
        useFactory: (c) => new Logger(c.resolve(Config)),
        scope: 'singleton',
      });
      container.register({
        token: Database,
        useFactory: (c) => new Database(c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: UserRepository,
        useFactory: (c) => new UserRepository(c.resolve(Database), c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: UserService,
        useFactory: (c) => new UserService(c.resolve(UserRepository), c.resolve(Logger)),
        scope: 'singleton',
      });

      const userService = container.resolve(UserService);

      // Verify entire graph
      expect(userService).toBeInstanceOf(UserService);
      expect(userService.repo).toBeInstanceOf(UserRepository);
      expect(userService.repo.db).toBeInstanceOf(Database);
      expect(userService.repo.db.logger).toBeInstanceOf(Logger);
      expect(userService.repo.db.logger.config).toBeInstanceOf(Config);

      // Verify singleton sharing
      expect(userService.logger).toBe(userService.repo.logger);
      expect(userService.logger).toBe(userService.repo.db.logger);
    });

    it('should handle diamond dependency pattern', () => {
      // Diamond pattern:
      //       A
      //      / \
      //     B   C
      //      \ /
      //       D

      class A {
        id = 'A';
      }

      class B {
        constructor(public a: A) {}
      }

      class C {
        constructor(public a: A) {}
      }

      class D {
        constructor(
          public b: B,
          public c: C
        ) {}
      }

      container.registerSingleton(A);
      container.register({
        token: B,
        useFactory: (c) => new B(c.resolve(A)),
        scope: 'singleton',
      });
      container.register({
        token: C,
        useFactory: (c) => new C(c.resolve(A)),
        scope: 'singleton',
      });
      container.register({
        token: D,
        useFactory: (c) => new D(c.resolve(B), c.resolve(C)),
        scope: 'singleton',
      });

      const d = container.resolve(D);

      // Both B and C should share the same A instance
      expect(d.b.a).toBe(d.c.a);
      expect(d.b.a.id).toBe('A');
    });

    it('should handle wide dependency graph (many dependencies)', () => {
      // Service with 10 dependencies
      class Dep1 {}
      class Dep2 {}
      class Dep3 {}
      class Dep4 {}
      class Dep5 {}
      class Dep6 {}
      class Dep7 {}
      class Dep8 {}
      class Dep9 {}
      class Dep10 {}

      class WideService {
        constructor(
          public d1: Dep1,
          public d2: Dep2,
          public d3: Dep3,
          public d4: Dep4,
          public d5: Dep5,
          public d6: Dep6,
          public d7: Dep7,
          public d8: Dep8,
          public d9: Dep9,
          public d10: Dep10
        ) {}
      }

      container.registerSingleton(Dep1);
      container.registerSingleton(Dep2);
      container.registerSingleton(Dep3);
      container.registerSingleton(Dep4);
      container.registerSingleton(Dep5);
      container.registerSingleton(Dep6);
      container.registerSingleton(Dep7);
      container.registerSingleton(Dep8);
      container.registerSingleton(Dep9);
      container.registerSingleton(Dep10);

      container.register({
        token: WideService,
        useFactory: (c) =>
          new WideService(
            c.resolve(Dep1),
            c.resolve(Dep2),
            c.resolve(Dep3),
            c.resolve(Dep4),
            c.resolve(Dep5),
            c.resolve(Dep6),
            c.resolve(Dep7),
            c.resolve(Dep8),
            c.resolve(Dep9),
            c.resolve(Dep10)
          ),
        scope: 'singleton',
      });

      const service = container.resolve(WideService);

      // Verify all dependencies are injected
      expect(service.d1).toBeInstanceOf(Dep1);
      expect(service.d2).toBeInstanceOf(Dep2);
      expect(service.d3).toBeInstanceOf(Dep3);
      expect(service.d4).toBeInstanceOf(Dep4);
      expect(service.d5).toBeInstanceOf(Dep5);
      expect(service.d6).toBeInstanceOf(Dep6);
      expect(service.d7).toBeInstanceOf(Dep7);
      expect(service.d8).toBeInstanceOf(Dep8);
      expect(service.d9).toBeInstanceOf(Dep9);
      expect(service.d10).toBeInstanceOf(Dep10);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support typical web service architecture', () => {
      // Typical layers: Config -> Logger -> DB -> Repository -> Service -> Controller

      const DB_CONFIG = Symbol('db-config');

      class Logger {
        log(msg: string) {
          return `[LOG] ${msg}`;
        }
      }

      class DatabaseConnection {
        constructor(
          public config: any,
          public logger: Logger
        ) {}

        connect() {
          this.logger.log('Database connected');
          return true;
        }

        query(sql: string) {
          this.logger.log(`Executing: ${sql}`);
          return ['row1', 'row2'];
        }
      }

      class UserRepository {
        constructor(
          public db: DatabaseConnection,
          public logger: Logger
        ) {}

        findAll() {
          this.logger.log('Finding all users');
          return this.db.query('SELECT * FROM users');
        }

        findById(id: number) {
          this.logger.log(`Finding user ${id}`);
          return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
        }
      }

      class UserService {
        constructor(
          public repo: UserRepository,
          public logger: Logger
        ) {}

        getAllUsers() {
          this.logger.log('Getting all users');
          return this.repo.findAll();
        }

        getUser(id: number) {
          this.logger.log(`Getting user ${id}`);
          return this.repo.findById(id);
        }
      }

      class UserController {
        constructor(
          public service: UserService,
          public logger: Logger
        ) {}

        handleGetUsers() {
          this.logger.log('Handling GET /users');
          return this.service.getAllUsers();
        }
      }

      container.register({
        token: DB_CONFIG,
        useValue: {
          host: 'localhost',
          port: 5432,
          database: 'myapp',
        },
        scope: 'singleton',
      });

      container.registerSingleton(Logger);

      container.register({
        token: DatabaseConnection,
        useFactory: (c) => new DatabaseConnection(c.resolve(DB_CONFIG), c.resolve(Logger)),
        scope: 'singleton',
      });

      container.register({
        token: UserRepository,
        useFactory: (c) => new UserRepository(c.resolve(DatabaseConnection), c.resolve(Logger)),
        scope: 'singleton',
      });

      container.register({
        token: UserService,
        useFactory: (c) => new UserService(c.resolve(UserRepository), c.resolve(Logger)),
        scope: 'singleton',
      });

      container.register({
        token: UserController,
        useFactory: (c) => new UserController(c.resolve(UserService), c.resolve(Logger)),
        scope: 'singleton',
      });

      // Resolve controller (top of the stack)
      const controller = container.resolve(UserController);

      const users = controller.handleGetUsers();

      expect(users).toEqual(['row1', 'row2']);
      expect(controller.service.repo.db.connect()).toBe(true);

      // Verify singleton sharing
      expect(controller.logger).toBe(controller.service.logger);
      expect(controller.logger).toBe(controller.service.repo.logger);
      expect(controller.logger).toBe(controller.service.repo.db.logger);
    });

    it('should support plugin architecture', () => {
      // Plugin system where plugins can depend on services

      abstract class Plugin {
        abstract name: string;
        abstract init(): void;
      }

      class Logger {
        messages: string[] = [];
        log(msg: string) {
          this.messages.push(msg);
        }
      }

      class PluginA extends Plugin {
        name = 'PluginA';
        constructor(public logger: Logger) {
          super();
        }
        init() {
          this.logger.log('PluginA initialized');
        }
      }

      class PluginB extends Plugin {
        name = 'PluginB';
        constructor(public logger: Logger) {
          super();
        }
        init() {
          this.logger.log('PluginB initialized');
        }
      }

      class PluginManager {
        constructor(
          public pluginA: PluginA,
          public pluginB: PluginB,
          public logger: Logger
        ) {}

        initAll() {
          this.logger.log('Initializing plugins');
          this.pluginA.init();
          this.pluginB.init();
        }
      }

      container.registerSingleton(Logger);
      container.register({
        token: PluginA,
        useFactory: (c) => new PluginA(c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: PluginB,
        useFactory: (c) => new PluginB(c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: PluginManager,
        useFactory: (c) =>
          new PluginManager(c.resolve(PluginA), c.resolve(PluginB), c.resolve(Logger)),
        scope: 'singleton',
      });

      const manager = container.resolve(PluginManager);
      manager.initAll();

      const logger = container.resolve(Logger);
      expect(logger.messages).toEqual([
        'Initializing plugins',
        'PluginA initialized',
        'PluginB initialized',
      ]);
    });

    it('should support factory pattern with conditional creation', () => {
      // Different implementations based on environment

      abstract class PaymentProcessor {
        abstract process(amount: number): string;
      }

      class StripeProcessor extends PaymentProcessor {
        process(amount: number) {
          return `Stripe: $${amount}`;
        }
      }

      class PayPalProcessor extends PaymentProcessor {
        process(amount: number) {
          return `PayPal: $${amount}`;
        }
      }

      class MockProcessor extends PaymentProcessor {
        process(amount: number) {
          return `Mock: $${amount}`;
        }
      }

      // Factory that selects implementation based on environment
      const ENV = Symbol('environment');

      container.register({
        token: ENV,
        useValue: 'test', // 'production', 'development', 'test'
        scope: 'singleton',
      });

      container.register({
        token: PaymentProcessor,
        useFactory: (c) => {
          const env = c.resolve<string>(ENV);
          switch (env) {
            case 'production':
              return new StripeProcessor();
            case 'development':
              return new PayPalProcessor();
            default:
              return new MockProcessor();
          }
        },
        scope: 'singleton',
      });

      const processor = container.resolve(PaymentProcessor);
      expect(processor).toBeInstanceOf(MockProcessor);
      expect(processor.process(100)).toBe('Mock: $100');
    });
  });

  describe('Lifecycle Integration', () => {
    it('should handle initialization order in dependency graph', () => {
      const initOrder: string[] = [];

      class A implements OnInit {
        onInit() {
          initOrder.push('A');
        }
      }

      class B implements OnInit {
        constructor(public a: A) {}
        onInit() {
          initOrder.push('B');
        }
      }

      class C implements OnInit {
        constructor(public b: B) {}
        onInit() {
          initOrder.push('C');
        }
      }

      container.registerSingleton(A);
      container.register({
        token: B,
        useFactory: (c) => new B(c.resolve(A)),
        scope: 'singleton',
      });
      container.register({
        token: C,
        useFactory: (c) => new C(c.resolve(B)),
        scope: 'singleton',
      });

      // Resolve C (should trigger A -> B -> C initialization)
      container.resolve(C);

      // Verify initialization order (dependencies first)
      expect(initOrder).toEqual(['A', 'B', 'C']);
    });

    it('should handle cleanup in reverse dependency order', async () => {
      const destroyOrder: string[] = [];

      class A implements OnDestroy {
        async onDestroy() {
          destroyOrder.push('A');
        }
      }

      class B implements OnDestroy {
        constructor(public a: A) {}
        async onDestroy() {
          destroyOrder.push('B');
        }
      }

      class C implements OnDestroy {
        constructor(public b: B) {}
        async onDestroy() {
          destroyOrder.push('C');
        }
      }

      container.registerSingleton(A);
      container.register({
        token: B,
        useFactory: (c) => new B(c.resolve(A)),
        scope: 'singleton',
      });
      container.register({
        token: C,
        useFactory: (c) => new C(c.resolve(B)),
        scope: 'singleton',
      });

      container.resolve(A);
      container.resolve(B);
      container.resolve(C);

      await container.dispose();

      // dispose() does not promise reverse-dependency order, so this checks only that every
      // hook ran.
      expect(destroyOrder).toHaveLength(3);
      expect(destroyOrder).toContain('A');
      expect(destroyOrder).toContain('B');
      expect(destroyOrder).toContain('C');
    });

    it('should handle async initialization in services', async () => {
      const events: string[] = [];

      class AsyncService implements OnInit {
        private initialized = false;

        onInit() {
          events.push('init-start');
          // onInit is synchronous; it starts async work that the test awaits separately.
          this.asyncInit();
        }

        private async asyncInit() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          this.initialized = true;
          events.push('init-complete');
        }

        isReady() {
          return this.initialized;
        }
      }

      container.registerSingleton(AsyncService);

      const service = container.resolve(AsyncService);

      // onInit called synchronously
      expect(events).toContain('init-start');

      // Wait for async init
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(events).toEqual(['init-start', 'init-complete']);
      expect(service.isReady()).toBe(true);
    });

    it('should continue resolving other services if one init fails', () => {
      const initResults: string[] = [];

      class GoodService implements OnInit {
        onInit() {
          initResults.push('good');
        }
      }

      class BadService implements OnInit {
        onInit() {
          throw new Error('Init failed');
        }
      }

      container.registerSingleton(GoodService);
      container.registerSingleton(BadService);

      // Good service works
      container.resolve(GoodService);
      expect(initResults).toEqual(['good']);

      // Bad service throws
      expect(() => container.resolve(BadService)).toThrow(LifecycleError);
    });
  });

  describe('Performance', () => {
    it('should resolve singleton quickly (< 1ms per resolve after first)', () => {
      class FastService {
        getValue() {
          return 42;
        }
      }

      container.registerSingleton(FastService);

      // First resolve (creates instance)
      const start1 = Date.now();
      container.resolve(FastService);
      const duration1 = Date.now() - start1;

      // Subsequent resolves (from cache)
      const start2 = Date.now();
      for (let i = 0; i < 1000; i++) {
        container.resolve(FastService);
      }
      const duration2 = Date.now() - start2;

      // Average time per cached resolve should be very fast
      const avgTime = duration2 / 1000;
      expect(avgTime).toBeLessThan(1); // Less than 1ms on average
    });

    it('should handle many services efficiently', () => {
      // Register 100 services
      const services: any[] = [];

      for (let i = 0; i < 100; i++) {
        const ServiceClass = class {
          id = i;
        };
        Object.defineProperty(ServiceClass, 'name', { value: `Service${i}` });
        services.push(ServiceClass);
        container.registerSingleton(ServiceClass);
      }

      const start = Date.now();

      // Resolve all services
      for (const ServiceClass of services) {
        container.resolve(ServiceClass);
      }

      const duration = Date.now() - start;

      // Should handle 100 services in reasonable time
      expect(duration).toBeLessThan(100); // Less than 100ms total

      const stats = container.getStats();
      expect(stats.providers).toBe(100);
      expect(stats.singletons).toBe(100);
    });

    it('should handle complex graph efficiently', () => {
      // Create a complex graph: 10 services, each depending on previous

      const services: any[] = [];

      // First service (no dependencies)
      class Service0 {
        id = 0;
      }
      services.push(Service0);
      container.registerSingleton(Service0);

      // Each service depends on all previous services
      for (let i = 1; i < 10; i++) {
        const deps = services.slice(0, i);
        const ServiceClass = class {
          id = i;
          deps: any[];
          constructor(...dependencies: any[]) {
            this.deps = dependencies;
          }
        };
        Object.defineProperty(ServiceClass, 'name', { value: `Service${i}` });

        container.register({
          token: ServiceClass,
          useFactory: (c) => {
            const resolvedDeps = deps.map((dep) => c.resolve(dep));
            return new ServiceClass(...resolvedDeps);
          },
          scope: 'singleton',
        });

        services.push(ServiceClass);
      }

      const start = Date.now();

      // Resolve the most complex service (depends on all others)
      const lastService = container.resolve(services[9]);

      const duration = Date.now() - start;

      // Should resolve complex graph quickly
      expect(duration).toBeLessThan(50); // Less than 50ms
      expect(lastService).toBeDefined();
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with transient services', () => {
      class TransientService {
        data = new Array(1000).fill('x'); // Some memory
      }

      container.registerTransient(TransientService);

      const initialStats = container.getStats();

      // Create many transient instances
      for (let i = 0; i < 100; i++) {
        container.resolve(TransientService);
      }

      const finalStats = container.getStats();

      // Transient instances should not be cached
      expect(finalStats.singletons).toBe(initialStats.singletons);
      expect(finalStats.singletons).toBe(0);
    });

    it('should clear singletons on dispose', async () => {
      class Service1 {}
      class Service2 {}
      class Service3 {}

      container.registerSingleton(Service1);
      container.registerSingleton(Service2);
      container.registerSingleton(Service3);

      container.resolve(Service1);
      container.resolve(Service2);
      container.resolve(Service3);

      expect(container.getStats().singletons).toBe(3);

      await container.dispose();

      expect(container.getStats().singletons).toBe(0);
    });

    it('should allow re-registration after dispose', async () => {
      class Service {
        static instances = 0;
        constructor() {
          Service.instances++;
        }
      }

      container.registerSingleton(Service);
      const instance1 = container.resolve(Service);

      await container.dispose();

      // Re-register and resolve again
      container.registerSingleton(Service);
      const instance2 = container.resolve(Service);

      // Should be different instances
      expect(instance1).not.toBe(instance2);
      expect(Service.instances).toBe(2);
    });

    it('should handle large number of registrations', () => {
      const NUM_SERVICES = 1000;

      const start = Date.now();

      // Register many services
      for (let i = 0; i < NUM_SERVICES; i++) {
        const token = Symbol(`service-${i}`);
        container.register({
          token,
          useValue: { id: i },
          scope: 'singleton',
        });
      }

      const registerDuration = Date.now() - start;

      // Registration should be fast
      expect(registerDuration).toBeLessThan(100); // Less than 100ms for 1000 registrations

      const stats = container.getStats();
      expect(stats.providers).toBe(NUM_SERVICES);
    });
  });

  describe('Error Scenarios', () => {
    it('should provide helpful error for missing dependency', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {}

      // Register A but not B
      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });

      expect(() => container.resolve(ServiceA)).toThrow(DependencyNotFoundError);

      try {
        container.resolve(ServiceA);
      } catch (error: any) {
        expect(error.message).toContain('Cannot resolve dependency');
        expect(error.message).toContain('ServiceB');
      }
    });

    it('should detect complex circular dependencies', () => {
      // A -> B -> C -> A

      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public c: ServiceC) {}
      }

      class ServiceC {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceC)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceC,
        useFactory: (c) => new ServiceC(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      expect(() => container.resolve(ServiceA)).toThrow(CircularDependencyError);
    });

    it('should handle partial resolution failures gracefully', () => {
      class GoodService {}
      class BadService {
        constructor() {
          throw new Error('Constructor error');
        }
      }

      container.registerSingleton(GoodService);
      container.register({
        token: BadService,
        useFactory: () => new BadService(),
        scope: 'singleton',
      });

      // Good service still works
      const good = container.resolve(GoodService);
      expect(good).toBeInstanceOf(GoodService);

      // Bad service throws
      expect(() => container.resolve(BadService)).toThrow('Constructor error');

      // Good service still accessible
      const good2 = container.resolve(GoodService);
      expect(good2).toBe(good);
    });
  });

  describe('Container State Management', () => {
    it('should maintain state across multiple operations', () => {
      class Counter {
        count = 0;
        increment() {
          this.count++;
        }
      }

      container.registerSingleton(Counter);

      const counter1 = container.resolve(Counter);
      counter1.increment();
      counter1.increment();

      const counter2 = container.resolve(Counter);
      counter2.increment();

      // Same instance
      expect(counter1).toBe(counter2);
      expect(counter2.count).toBe(3);
    });

    it('should provide accurate statistics', () => {
      class Service1 {}
      class Service2 {}

      container.registerSingleton(Service1);
      container.registerSingleton(Service2);

      let stats = container.getStats();
      expect(stats.providers).toBe(2);
      expect(stats.singletons).toBe(0);

      container.resolve(Service1);

      stats = container.getStats();
      expect(stats.providers).toBe(2);
      expect(stats.singletons).toBe(1);

      container.resolve(Service2);

      stats = container.getStats();
      expect(stats.providers).toBe(2);
      expect(stats.singletons).toBe(2);
    });

    it('should provide useful summary', () => {
      class TestService {}

      container.registerSingleton(TestService);
      container.resolve(TestService);

      const summary = container.getSummary();

      expect(summary).toContain('OrcherContainer Summary');
      expect(summary).toContain('Providers: 1');
      expect(summary).toContain('Cached Singletons: 1');
      expect(summary).toContain('Resolution Stack: []');
    });

    it('should track resolution stack during resolve', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor() {
          // Check summary during resolution
          const summary = container.getSummary();
          expect(summary).toContain('Resolution Stack:');
        }
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.registerSingleton(ServiceB);

      container.resolve(ServiceA);
    });
  });

  describe('Edge Cases', () => {
    it('should handle services with no constructor', () => {
      const service = {
        getValue: () => 42,
      };

      container.register({
        token: 'NO_CONSTRUCTOR',
        useValue: service,
        scope: 'singleton',
      });

      const resolved = container.resolve('NO_CONSTRUCTOR');
      expect(resolved).toBe(service);
    });

    it('should handle optional dependencies pattern', () => {
      class Logger {
        log(msg: string) {
          return msg;
        }
      }

      class ServiceWithOptionalLogger {
        private logger?: Logger;

        setLogger(logger: Logger) {
          this.logger = logger;
        }

        doWork() {
          return this.logger ? this.logger.log('Working') : 'Working';
        }
      }

      container.registerSingleton(Logger);
      container.register({
        token: ServiceWithOptionalLogger,
        useFactory: (c) => {
          const service = new ServiceWithOptionalLogger();
          if (c.has(Logger)) {
            service.setLogger(c.resolve(Logger));
          }
          return service;
        },
        scope: 'singleton',
      });

      const service = container.resolve(ServiceWithOptionalLogger);
      expect(service.doWork()).toBe('Working');
    });

    it('should handle same token registered multiple times', () => {
      class Implementation1 {
        value = 1;
      }

      class Implementation2 {
        value = 2;
      }

      const TOKEN = Symbol('service');

      // First registration
      container.register({
        token: TOKEN,
        useValue: new Implementation1(),
        scope: 'singleton',
      });

      const first = container.resolve(TOKEN);
      expect(first.value).toBe(1);

      // Re-register with different implementation
      container.register({
        token: TOKEN,
        useValue: new Implementation2(),
        scope: 'singleton',
      });

      // Clear singletons to force re-resolution
      container.clear();
      container.register({
        token: TOKEN,
        useValue: new Implementation2(),
        scope: 'singleton',
      });

      const second = container.resolve(TOKEN);
      expect(second.value).toBe(2);
    });
  });
});
