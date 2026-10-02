/**
 * Tests for @Injectable() Decorator
 * @packageDocumentation
 */

import {
  Injectable,
  isInjectable,
  getInjectableScope,
  getInjectableMetadata,
} from '../decorators/injectable';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';
import type { OnInit, OnDestroy } from '../types';

describe('@Injectable() Decorator', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Functionality', () => {
    it('should decorate a class successfully', () => {
      @Injectable()
      class TestService {}

      expect(TestService).toBeDefined();
      expect(typeof TestService).toBe('function');
    });

    it('should auto-register service with GlobalRegistry', () => {
      @Injectable()
      class TestService {}

      const metadata = registry.getService(TestService);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestService);
    });

    it('should mark class as injectable', () => {
      @Injectable()
      class TestService {}

      expect(isInjectable(TestService)).toBe(true);
    });

    it('should not mark undecorated class as injectable', () => {
      class TestService {}

      expect(isInjectable(TestService)).toBe(false);
    });

    it('should store metadata on the class', () => {
      @Injectable()
      class TestService {}

      const metadata = getInjectableMetadata(TestService);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestService);
      expect(metadata?.scope).toBe('singleton');
      expect(metadata?.registered).toBe(true);
    });
  });

  describe('Scope Configuration', () => {
    it('should default to singleton scope', () => {
      @Injectable()
      class TestService {}

      const scope = getInjectableScope(TestService);
      expect(scope).toBe('singleton');

      const metadata = registry.getService(TestService);
      expect(metadata?.scope).toBe('singleton');
    });

    it('should support explicit singleton scope', () => {
      @Injectable({ scope: 'singleton' })
      class TestService {}

      const scope = getInjectableScope(TestService);
      expect(scope).toBe('singleton');

      const metadata = registry.getService(TestService);
      expect(metadata?.scope).toBe('singleton');
    });

    it('should support transient scope', () => {
      @Injectable({ scope: 'transient' })
      class TestService {}

      const scope = getInjectableScope(TestService);
      expect(scope).toBe('transient');

      const metadata = registry.getService(TestService);
      expect(metadata?.scope).toBe('transient');
    });

    it('should support scoped scope', () => {
      @Injectable({ scope: 'scoped' })
      class TestService {}

      const scope = getInjectableScope(TestService);
      expect(scope).toBe('scoped');

      const metadata = registry.getService(TestService);
      expect(metadata?.scope).toBe('scoped');
    });

    it('should throw for invalid scope', () => {
      expect(() => {
        @Injectable({ scope: 'invalid' as any })
        class TestService {}
      }).toThrow('Invalid scope');
    });
  });

  describe('Multiple Services', () => {
    it('should register multiple services', () => {
      @Injectable()
      class Service1 {}

      @Injectable()
      class Service2 {}

      @Injectable()
      class Service3 {}

      expect(registry.getService(Service1)).toBeDefined();
      expect(registry.getService(Service2)).toBeDefined();
      expect(registry.getService(Service3)).toBeDefined();

      const stats = registry.getStats();
      expect(stats.services).toBe(3);
    });

    it('should handle different scopes for different services', () => {
      @Injectable({ scope: 'singleton' })
      class SingletonService {}

      @Injectable({ scope: 'transient' })
      class TransientService {}

      expect(getInjectableScope(SingletonService)).toBe('singleton');
      expect(getInjectableScope(TransientService)).toBe('transient');
    });
  });

  describe('Class Features', () => {
    it('should work with classes that have constructors', () => {
      @Injectable()
      class TestService {
        constructor(private value: number = 42) {}

        getValue() {
          return this.value;
        }
      }

      const metadata = registry.getService(TestService);
      expect(metadata).toBeDefined();

      // Can still instantiate
      const instance = new TestService(100);
      expect(instance.getValue()).toBe(100);
    });

    it('should work with classes that have methods', () => {
      @Injectable()
      class TestService {
        getValue() {
          return 42;
        }

        async getValueAsync() {
          return Promise.resolve(42);
        }
      }

      expect(registry.getService(TestService)).toBeDefined();
    });

    it('should work with classes that have properties', () => {
      @Injectable()
      class TestService {
        public value = 42;
        private secret = 'hidden';

        getSecret() {
          return this.secret;
        }
      }

      expect(registry.getService(TestService)).toBeDefined();

      const instance = new TestService();
      expect(instance.value).toBe(42);
      expect(instance.getSecret()).toBe('hidden');
    });

    it('should work with classes that extend other classes', () => {
      class BaseService {
        getValue() {
          return 'base';
        }
      }

      @Injectable()
      class ExtendedService extends BaseService {
        getValue() {
          return 'extended';
        }
      }

      expect(registry.getService(ExtendedService)).toBeDefined();

      const instance = new ExtendedService();
      expect(instance.getValue()).toBe('extended');
    });

    it('should work with classes that implement interfaces', () => {
      @Injectable()
      class TestService implements OnInit, OnDestroy {
        onInit() {
          // Initialization logic
        }

        async onDestroy() {
          // Cleanup logic
        }
      }

      expect(registry.getService(TestService)).toBeDefined();
    });
  });

  describe('Helper Functions', () => {
    describe('isInjectable()', () => {
      it('should return true for decorated classes', () => {
        @Injectable()
        class TestService {}

        expect(isInjectable(TestService)).toBe(true);
      });

      it('should return false for undecorated classes', () => {
        class TestService {}

        expect(isInjectable(TestService)).toBe(false);
      });

      it('should return false for non-class values', () => {
        expect(isInjectable(null)).toBe(false);
        expect(isInjectable(undefined)).toBe(false);
        expect(isInjectable(42)).toBe(false);
        expect(isInjectable('string')).toBe(false);
        expect(isInjectable({})).toBe(false);
        expect(isInjectable([])).toBe(false);
      });

      it('should return false for functions that are not classes', () => {
        function regularFunction() {}

        expect(isInjectable(regularFunction)).toBe(false);
      });
    });

    describe('getInjectableScope()', () => {
      it('should return scope for decorated classes', () => {
        @Injectable({ scope: 'transient' })
        class TestService {}

        expect(getInjectableScope(TestService)).toBe('transient');
      });

      it('should return undefined for undecorated classes', () => {
        class TestService {}

        expect(getInjectableScope(TestService)).toBeUndefined();
      });

      it('should return undefined for non-class values', () => {
        expect(getInjectableScope(null)).toBeUndefined();
        expect(getInjectableScope(undefined)).toBeUndefined();
        expect(getInjectableScope(42)).toBeUndefined();
      });
    });

    describe('getInjectableMetadata()', () => {
      it('should return metadata for decorated classes', () => {
        @Injectable({ scope: 'transient' })
        class TestService {}

        const metadata = getInjectableMetadata(TestService);
        expect(metadata).toBeDefined();
        expect(metadata?.token).toBe(TestService);
        expect(metadata?.scope).toBe('transient');
        expect(metadata?.registered).toBe(true);
      });

      it('should return undefined for undecorated classes', () => {
        class TestService {}

        expect(getInjectableMetadata(TestService)).toBeUndefined();
      });

      it('should return undefined for non-class values', () => {
        expect(getInjectableMetadata(null)).toBeUndefined();
        expect(getInjectableMetadata({})).toBeUndefined();
      });
    });
  });

  describe('Error Cases', () => {
    it('should throw when applied to non-class', () => {
      expect(() => {
        const notAClass = {} as any;
        Injectable()(notAClass);
      }).toThrow(DecoratorError);
    });

    it('should throw for invalid scope', () => {
      expect(() => {
        @Injectable({ scope: 'invalid-scope' as any })
        class TestService {}
      }).toThrow('Invalid scope');
    });
  });

  describe('Integration with Registry', () => {
    it('should be retrievable from registry', () => {
      @Injectable()
      class TestService {}

      const metadata = registry.getService(TestService);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestService);
    });

    it('should update registry statistics', () => {
      const statsBefore = registry.getStats();
      const servicesBefore = statsBefore.services;

      @Injectable()
      class TestService {}

      const statsAfter = registry.getStats();
      expect(statsAfter.services).toBe(servicesBefore + 1);
    });

    it('should appear in getAllServices()', () => {
      @Injectable()
      class TestService {}

      const allServices = registry.getAllServices();
      expect(allServices.size).toBe(1);
      expect(allServices.get(TestService)?.token).toBe(TestService);
    });

    it('should be detectable with hasService()', () => {
      @Injectable()
      class TestService {}

      expect(registry.hasService(TestService)).toBe(true);
    });

    it('should work with registry clear()', () => {
      @Injectable()
      class TestService {}

      expect(registry.hasService(TestService)).toBe(true);

      registry.clear();

      expect(registry.hasService(TestService)).toBe(false);
      expect(registry.getStats().services).toBe(0);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support typical service with dependencies', () => {
      @Injectable()
      class LoggerService {
        log(message: string) {
          return `[LOG] ${message}`;
        }
      }

      @Injectable()
      class UserService {
        constructor(private logger: LoggerService) {}

        getUser(id: string) {
          this.logger.log(`Getting user ${id}`);
          return { id, name: 'Test User' };
        }
      }

      expect(registry.hasService(LoggerService)).toBe(true);
      expect(registry.hasService(UserService)).toBe(true);
    });

    it('should support service with lifecycle hooks', () => {
      const events: string[] = [];

      @Injectable()
      class DatabaseService implements OnInit, OnDestroy {
        private connected = false;

        onInit() {
          this.connected = true;
          events.push('init');
        }

        async onDestroy() {
          this.connected = false;
          events.push('destroy');
        }

        isConnected() {
          return this.connected;
        }
      }

      expect(registry.hasService(DatabaseService)).toBe(true);

      // Test lifecycle hooks work
      const instance = new DatabaseService();
      instance.onInit();
      expect(instance.isConnected()).toBe(true);
      expect(events).toContain('init');
    });

    it('should support transient services for request-scoped data', () => {
      @Injectable({ scope: 'transient' })
      class RequestContext {
        private startTime = Date.now();

        getElapsedTime() {
          return Date.now() - this.startTime;
        }
      }

      const metadata = registry.getService(RequestContext);
      expect(metadata?.scope).toBe('transient');
    });

    it('should support service hierarchy', () => {
      @Injectable()
      class ConfigService {
        getValue(key: string) {
          return `config-${key}`;
        }
      }

      @Injectable()
      class DatabaseService {
        constructor(private config: ConfigService) {}

        connect() {
          return this.config.getValue('db-url');
        }
      }

      @Injectable()
      class UserRepository {
        constructor(private db: DatabaseService) {}

        findAll() {
          this.db.connect();
          return ['user1', 'user2'];
        }
      }

      expect(registry.hasService(ConfigService)).toBe(true);
      expect(registry.hasService(DatabaseService)).toBe(true);
      expect(registry.hasService(UserRepository)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty options object', () => {
      @Injectable({})
      class TestService {}

      expect(getInjectableScope(TestService)).toBe('singleton');
    });

    it('should handle class with no constructor', () => {
      @Injectable()
      class TestService {
        getValue() {
          return 42;
        }
      }

      expect(registry.hasService(TestService)).toBe(true);
    });

    it('should handle class with static members', () => {
      @Injectable()
      class TestService {
        static staticValue = 42;

        static getStaticValue() {
          return TestService.staticValue;
        }

        getValue() {
          return TestService.staticValue;
        }
      }

      expect(registry.hasService(TestService)).toBe(true);
      expect(TestService.getStaticValue()).toBe(42);
    });

    it('should handle class with private constructor', () => {
      @Injectable()
      class SingletonService {
        private static instance: SingletonService;

        private constructor() {}

        static getInstance() {
          if (!SingletonService.instance) {
            SingletonService.instance = new SingletonService();
          }
          return SingletonService.instance;
        }
      }

      expect(registry.hasService(SingletonService)).toBe(true);
    });

    it('should handle class with generics', () => {
      @Injectable()
      class GenericService<T> {
        private items: T[] = [];

        add(item: T) {
          this.items.push(item);
        }

        getAll(): T[] {
          return this.items;
        }
      }

      expect(registry.hasService(GenericService)).toBe(true);
    });

    it('should preserve class name', () => {
      @Injectable()
      class TestService {}

      expect(TestService.name).toBe('TestService');
    });
  });
});
