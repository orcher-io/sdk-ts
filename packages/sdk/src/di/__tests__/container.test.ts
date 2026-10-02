/**
 * Tests for OrcherContainer
 * @packageDocumentation
 */

import { OrcherContainer } from '../container';
import {
  DependencyNotFoundError,
  CircularDependencyError,
  InvalidScopeError,
  LifecycleError,
} from '../errors';
import type { OnInit, OnDestroy } from '../types';

describe('OrcherContainer', () => {
  let container: OrcherContainer;

  beforeEach(() => {
    container = new OrcherContainer();
  });

  afterEach(() => {
    container.clear();
  });

  describe('Registration', () => {
    describe('registerSingleton', () => {
      it('should register a class as singleton', () => {
        class TestService {}

        container.registerSingleton(TestService);

        expect(container.has(TestService)).toBe(true);
      });

      it('should register with a factory function', () => {
        class TestService {
          constructor(public value: string) {}
        }

        container.registerSingleton(TestService, () => new TestService('test'));

        const instance = container.resolve(TestService);
        expect(instance.value).toBe('test');
      });

      it('should return the same instance on multiple resolutions', () => {
        class TestService {
          id = Math.random();
        }

        container.registerSingleton(TestService);

        const instance1 = container.resolve(TestService);
        const instance2 = container.resolve(TestService);

        expect(instance1).toBe(instance2);
        expect(instance1.id).toBe(instance2.id);
      });
    });

    describe('registerTransient', () => {
      it('should register a class as transient', () => {
        class TestService {}

        container.registerTransient(TestService);

        expect(container.has(TestService)).toBe(true);
      });

      it('should create new instance on each resolution', () => {
        class TestService {
          id = Math.random();
        }

        container.registerTransient(TestService);

        const instance1 = container.resolve(TestService);
        const instance2 = container.resolve(TestService);

        expect(instance1).not.toBe(instance2);
        expect(instance1.id).not.toBe(instance2.id);
      });

      it('should register with a factory function', () => {
        let counter = 0;
        class TestService {
          constructor(public count: number) {}
        }

        container.registerTransient(TestService, () => new TestService(++counter));

        const instance1 = container.resolve(TestService);
        const instance2 = container.resolve(TestService);

        expect(instance1.count).toBe(1);
        expect(instance2.count).toBe(2);
      });
    });

    describe('register', () => {
      it('should register with useClass', () => {
        class BaseService {}
        class ExtendedService extends BaseService {}

        container.register({
          token: BaseService,
          useClass: ExtendedService,
          scope: 'singleton',
        });

        const instance = container.resolve(BaseService);
        expect(instance).toBeInstanceOf(ExtendedService);
      });

      it('should register with useFactory', () => {
        const TOKEN = Symbol('test');
        let counter = 0;

        container.register({
          token: TOKEN,
          useFactory: () => ({ value: ++counter }),
          scope: 'singleton',
        });

        const instance1 = container.resolve(TOKEN);
        const instance2 = container.resolve(TOKEN);

        expect(instance1.value).toBe(1);
        expect(instance1).toBe(instance2);
      });

      it('should register with useValue', () => {
        const TOKEN = Symbol('config');
        const config = { port: 3000, host: 'localhost' };

        container.register({
          token: TOKEN,
          useValue: config,
          scope: 'singleton',
        });

        const resolved = container.resolve(TOKEN);
        expect(resolved).toBe(config);
      });

      it('should default to singleton scope', () => {
        class TestService {
          id = Math.random();
        }

        container.register({
          token: TestService,
          useClass: TestService,
        });

        const instance1 = container.resolve(TestService);
        const instance2 = container.resolve(TestService);

        expect(instance1).toBe(instance2);
      });

      it('should throw InvalidScopeError for invalid scope', () => {
        class TestService {}

        expect(() => {
          container.register({
            token: TestService,
            useClass: TestService,
            scope: 'invalid' as any,
          });
        }).toThrow(InvalidScopeError);
      });

      it('should throw error for invalid provider configuration', () => {
        const TOKEN = Symbol('invalid');

        expect(() => {
          container.register({
            token: TOKEN,
            // No useClass, useFactory, or useValue
          } as any);
        }).toThrow(DependencyNotFoundError);
      });
    });

    describe('has', () => {
      it('should return true for registered token', () => {
        class TestService {}
        container.registerSingleton(TestService);

        expect(container.has(TestService)).toBe(true);
      });

      it('should return false for unregistered token', () => {
        class TestService {}

        expect(container.has(TestService)).toBe(false);
      });
    });
  });

  describe('Resolution', () => {
    describe('resolve', () => {
      it('should resolve a simple service', () => {
        class TestService {}

        container.registerSingleton(TestService);

        const instance = container.resolve(TestService);
        expect(instance).toBeInstanceOf(TestService);
      });

      it('should throw DependencyNotFoundError for unregistered token', () => {
        class UnregisteredService {}

        expect(() => {
          container.resolve(UnregisteredService);
        }).toThrow(DependencyNotFoundError);
      });

      it('should throw error with helpful message', () => {
        class UnregisteredService {}

        try {
          container.resolve(UnregisteredService);
          fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(DependencyNotFoundError);
          expect((error as Error).message).toContain('UnregisteredService');
        }
      });
    });

    describe('Constructor Injection', () => {
      it('should inject constructor dependencies', () => {
        class Logger {
          log(message: string) {
            return message;
          }
        }

        class UserService {
          constructor(public logger: Logger) {}

          greet() {
            return this.logger.log('Hello');
          }
        }

        container.registerSingleton(Logger);
        container.register({
          token: UserService,
          useFactory: (c) => new UserService(c.resolve(Logger)),
          scope: 'singleton',
        });

        const userService = container.resolve(UserService);
        expect(userService.logger).toBeInstanceOf(Logger);
        expect(userService.greet()).toBe('Hello');
      });

      it('should inject multiple dependencies', () => {
        class Logger {}
        class Database {}
        class Cache {}

        class UserService {
          constructor(
            public logger: Logger,
            public db: Database,
            public cache: Cache
          ) {}
        }

        container.registerSingleton(Logger);
        container.registerSingleton(Database);
        container.registerSingleton(Cache);
        container.register({
          token: UserService,
          useFactory: (c) =>
            new UserService(c.resolve(Logger), c.resolve(Database), c.resolve(Cache)),
          scope: 'singleton',
        });

        const userService = container.resolve(UserService);
        expect(userService.logger).toBeInstanceOf(Logger);
        expect(userService.db).toBeInstanceOf(Database);
        expect(userService.cache).toBeInstanceOf(Cache);
      });

      it('should resolve nested dependencies', () => {
        class Logger {}

        class Database {
          constructor(public logger: Logger) {}
        }

        class UserService {
          constructor(public db: Database) {}
        }

        container.registerSingleton(Logger);
        container.register({
          token: Database,
          useFactory: (c) => new Database(c.resolve(Logger)),
          scope: 'singleton',
        });
        container.register({
          token: UserService,
          useFactory: (c) => new UserService(c.resolve(Database)),
          scope: 'singleton',
        });

        const userService = container.resolve(UserService);
        expect(userService.db).toBeInstanceOf(Database);
        expect(userService.db.logger).toBeInstanceOf(Logger);
      });

      it('should inject the container itself', () => {
        class ServiceLocator {
          constructor(public container: OrcherContainer) {}
        }

        container.register({
          token: OrcherContainer,
          useValue: container,
          scope: 'singleton',
        });
        container.register({
          token: ServiceLocator,
          useFactory: (c) => new ServiceLocator(c.resolve(OrcherContainer)),
          scope: 'singleton',
        });

        const locator = container.resolve(ServiceLocator);
        expect(locator.container).toBe(container);
      });
    });

    describe('Circular Dependency Detection', () => {
      it('should detect direct circular dependency', () => {
        class ServiceA {
          constructor(public b: ServiceB) {}
        }

        class ServiceB {
          constructor(public a: ServiceA) {}
        }

        container.register({
          token: ServiceA,
          useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
          scope: 'singleton',
        });
        container.register({
          token: ServiceB,
          useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
          scope: 'singleton',
        });

        expect(() => {
          container.resolve(ServiceA);
        }).toThrow(CircularDependencyError);
      });

      it('should detect indirect circular dependency', () => {
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

        expect(() => {
          container.resolve(ServiceA);
        }).toThrow(CircularDependencyError);
      });

      it('should include cycle in error message', () => {
        class ServiceA {
          constructor(public b: ServiceB) {}
        }

        class ServiceB {
          constructor(public a: ServiceA) {}
        }

        container.register({
          token: ServiceA,
          useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
          scope: 'singleton',
        });
        container.register({
          token: ServiceB,
          useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
          scope: 'singleton',
        });

        try {
          container.resolve(ServiceA);
          fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(CircularDependencyError);
          const message = (error as Error).message;
          expect(message).toContain('ServiceA');
          expect(message).toContain('ServiceB');
        }
      });
    });
  });

  describe('Lifecycle Hooks', () => {
    describe('onInit', () => {
      it('should call onInit after instantiation', () => {
        const initSpy = jest.fn();

        class TestService implements OnInit {
          onInit() {
            initSpy();
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);

        expect(initSpy).toHaveBeenCalledTimes(1);
      });

      it('should call onInit only once for singletons', () => {
        const initSpy = jest.fn();

        class TestService implements OnInit {
          onInit() {
            initSpy();
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);
        container.resolve(TestService);

        expect(initSpy).toHaveBeenCalledTimes(1);
      });

      it('should call onInit for each transient instance', () => {
        const initSpy = jest.fn();

        class TestService implements OnInit {
          onInit() {
            initSpy();
          }
        }

        container.registerTransient(TestService);
        container.resolve(TestService);
        container.resolve(TestService);

        expect(initSpy).toHaveBeenCalledTimes(2);
      });

      it('should have access to injected dependencies in onInit', () => {
        class Logger {
          log(message: string) {
            return message;
          }
        }

        class UserService implements OnInit {
          public initMessage?: string;

          constructor(public logger: Logger) {}

          onInit() {
            this.initMessage = this.logger.log('Initialized');
          }
        }

        container.registerSingleton(Logger);
        container.register({
          token: UserService,
          useFactory: (c) => new UserService(c.resolve(Logger)),
          scope: 'singleton',
        });

        const service = container.resolve(UserService);
        expect(service.initMessage).toBe('Initialized');
      });

      it('should throw LifecycleError if onInit throws', () => {
        class TestService implements OnInit {
          onInit() {
            throw new Error('Init failed');
          }
        }

        container.registerSingleton(TestService);

        expect(() => {
          container.resolve(TestService);
        }).toThrow(LifecycleError);
      });
    });

    describe('onDestroy', () => {
      it('should call onDestroy on dispose', async () => {
        const destroySpy = jest.fn();

        class TestService implements OnDestroy {
          onDestroy() {
            destroySpy();
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);

        await container.dispose();

        expect(destroySpy).toHaveBeenCalledTimes(1);
      });

      it('should call onDestroy on all singletons', async () => {
        const destroy1 = jest.fn();
        const destroy2 = jest.fn();

        class Service1 implements OnDestroy {
          onDestroy() {
            destroy1();
          }
        }

        class Service2 implements OnDestroy {
          onDestroy() {
            destroy2();
          }
        }

        container.registerSingleton(Service1);
        container.registerSingleton(Service2);
        container.resolve(Service1);
        container.resolve(Service2);

        await container.dispose();

        expect(destroy1).toHaveBeenCalledTimes(1);
        expect(destroy2).toHaveBeenCalledTimes(1);
      });

      it('should support async onDestroy', async () => {
        const destroySpy = jest.fn();

        class TestService implements OnDestroy {
          async onDestroy() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            destroySpy();
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);

        await container.dispose();

        expect(destroySpy).toHaveBeenCalled();
      });

      it('should throw LifecycleError if onDestroy throws', async () => {
        class TestService implements OnDestroy {
          async onDestroy() {
            throw new Error('Destroy failed');
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);

        await expect(container.dispose()).rejects.toThrow(LifecycleError);
      });

      it('should not call onDestroy on services not yet resolved', async () => {
        const destroySpy = jest.fn();

        class TestService implements OnDestroy {
          onDestroy() {
            destroySpy();
          }
        }

        container.registerSingleton(TestService);
        // Don't resolve the service

        await container.dispose();

        expect(destroySpy).not.toHaveBeenCalled();
      });

      it('should clear singletons after dispose', async () => {
        class TestService {}

        container.registerSingleton(TestService);
        const instance1 = container.resolve(TestService);

        await container.dispose();

        const instance2 = container.resolve(TestService);

        expect(instance1).not.toBe(instance2);
      });
    });
  });

  describe('Scope Behavior', () => {
    it('should respect singleton scope', () => {
      class TestService {}

      container.register({
        token: TestService,
        useClass: TestService,
        scope: 'singleton',
      });

      const instance1 = container.resolve(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).toBe(instance2);
    });

    it('should respect transient scope', () => {
      class TestService {}

      container.register({
        token: TestService,
        useClass: TestService,
        scope: 'transient',
      });

      const instance1 = container.resolve(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).not.toBe(instance2);
    });

    it('should mix singleton and transient services', () => {
      class SingletonService {
        id = Math.random();
      }

      class TransientService {
        id = Math.random();
        constructor(public singleton: SingletonService) {}
      }

      container.registerSingleton(SingletonService);
      container.register({
        token: TransientService,
        useFactory: (c) => new TransientService(c.resolve(SingletonService)),
        scope: 'transient',
      });

      const t1 = container.resolve(TransientService);
      const t2 = container.resolve(TransientService);

      // Transient instances are different
      expect(t1).not.toBe(t2);
      expect(t1.id).not.toBe(t2.id);

      // But they share the same singleton
      expect(t1.singleton).toBe(t2.singleton);
      expect(t1.singleton.id).toBe(t2.singleton.id);
    });
  });

  describe('Utilities', () => {
    describe('clear', () => {
      it('should clear all providers', () => {
        class Service1 {}
        class Service2 {}

        container.registerSingleton(Service1);
        container.registerSingleton(Service2);

        container.clear();

        expect(container.has(Service1)).toBe(false);
        expect(container.has(Service2)).toBe(false);
      });

      it('should clear singleton cache', () => {
        class TestService {}

        container.registerSingleton(TestService);
        const instance1 = container.resolve(TestService);

        container.clear();
        container.registerSingleton(TestService);
        const instance2 = container.resolve(TestService);

        expect(instance1).not.toBe(instance2);
      });

      it('should not call onDestroy hooks', async () => {
        const destroySpy = jest.fn();

        class TestService implements OnDestroy {
          onDestroy() {
            destroySpy();
          }
        }

        container.registerSingleton(TestService);
        container.resolve(TestService);

        container.clear();

        expect(destroySpy).not.toHaveBeenCalled();
      });
    });

    describe('getStats', () => {
      it('should return correct provider count', () => {
        class Service1 {}
        class Service2 {}

        container.registerSingleton(Service1);
        container.registerSingleton(Service2);

        const stats = container.getStats();
        expect(stats.providers).toBe(2);
      });

      it('should return correct singleton count', () => {
        class Service1 {}
        class Service2 {}

        container.registerSingleton(Service1);
        container.registerSingleton(Service2);

        container.resolve(Service1);

        const stats = container.getStats();
        expect(stats.singletons).toBe(1);
      });

      it('should return zero for empty container', () => {
        const stats = container.getStats();
        expect(stats.providers).toBe(0);
        expect(stats.singletons).toBe(0);
      });
    });

    describe('getSummary', () => {
      it('should return formatted summary', () => {
        class TestService {}

        container.registerSingleton(TestService);
        container.resolve(TestService);

        const summary = container.getSummary();

        expect(summary).toContain('OrcherContainer Summary');
        expect(summary).toContain('Providers: 1');
        expect(summary).toContain('Cached Singletons: 1');
      });
    });
  });

  describe('Integration', () => {
    it('should handle complex service graph', () => {
      class Logger {}

      class Database {
        constructor(public logger: Logger) {}
      }

      class Cache {
        constructor(public logger: Logger) {}
      }

      class UserRepository {
        constructor(
          public db: Database,
          public cache: Cache
        ) {}
      }

      class UserService {
        constructor(
          public repo: UserRepository,
          public logger: Logger
        ) {}
      }

      // Use explicit factories for test reliability
      container.registerSingleton(Logger);
      container.register({
        token: Database,
        useFactory: (c) => new Database(c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: Cache,
        useFactory: (c) => new Cache(c.resolve(Logger)),
        scope: 'singleton',
      });
      container.register({
        token: UserRepository,
        useFactory: (c) => new UserRepository(c.resolve(Database), c.resolve(Cache)),
        scope: 'singleton',
      });
      container.register({
        token: UserService,
        useFactory: (c) => new UserService(c.resolve(UserRepository), c.resolve(Logger)),
        scope: 'singleton',
      });

      const userService = container.resolve(UserService);

      expect(userService).toBeInstanceOf(UserService);
      expect(userService.repo).toBeInstanceOf(UserRepository);
      expect(userService.repo.db).toBeInstanceOf(Database);
      expect(userService.repo.cache).toBeInstanceOf(Cache);
      expect(userService.logger).toBeInstanceOf(Logger);

      // All should share the same Logger singleton
      expect(userService.logger).toBe(userService.repo.db.logger);
      expect(userService.logger).toBe(userService.repo.cache.logger);
    });

    it('should handle mixed provider types', () => {
      const CONFIG = Symbol('config');

      class Logger {
        constructor(public config: any) {}
      }

      class ApiClient {
        constructor(public logger: Logger) {}
      }

      // Value provider
      container.register({
        token: CONFIG,
        useValue: { port: 3000 },
        scope: 'singleton',
      });

      // Factory provider for Logger that uses CONFIG
      container.register({
        token: Logger,
        useFactory: (c) => new Logger(c.resolve(CONFIG)),
        scope: 'singleton',
      });

      // Factory provider for ApiClient
      container.register({
        token: ApiClient,
        useFactory: (c) => new ApiClient(c.resolve(Logger)),
        scope: 'singleton',
      });

      const logger = container.resolve(Logger);
      expect(logger.config).toEqual({ port: 3000 });

      const client = container.resolve(ApiClient);
      expect(client.logger).toBe(logger);
      expect(client.logger.config).toEqual({ port: 3000 });
    });

    it('should handle full lifecycle', async () => {
      const events: string[] = [];

      class TestService implements OnInit, OnDestroy {
        onInit() {
          events.push('init');
        }

        onDestroy() {
          events.push('destroy');
        }
      }

      container.registerSingleton(TestService);

      // Resolve
      container.resolve(TestService);
      expect(events).toEqual(['init']);

      // Dispose
      await container.dispose();
      expect(events).toEqual(['init', 'destroy']);

      // Resolve again (should create new instance)
      container.registerSingleton(TestService);
      container.resolve(TestService);
      expect(events).toEqual(['init', 'destroy', 'init']);
    });
  });
});
