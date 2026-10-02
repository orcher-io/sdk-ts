/**
 * Tests for the OnInit and OnDestroy lifecycle hooks.
 * @packageDocumentation
 */

import { OrcherContainer } from '../container';
import { LifecycleError } from '../errors';
import type { OnInit, OnDestroy } from '../types';

describe('Lifecycle Hooks - Comprehensive Tests', () => {
  let container: OrcherContainer;

  beforeEach(() => {
    container = new OrcherContainer();
  });

  afterEach(() => {
    container.clear();
  });

  describe('OnInit Hook', () => {
    it('should call onInit immediately after construction', () => {
      const events: string[] = [];

      class TestService implements OnInit {
        constructor() {
          events.push('constructor');
        }

        onInit() {
          events.push('onInit');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      expect(events).toEqual(['constructor', 'onInit']);
    });

    it('should call onInit before returning instance', () => {
      let initialized = false;

      class TestService implements OnInit {
        onInit() {
          initialized = true;
        }

        isReady() {
          return initialized;
        }
      }

      container.registerSingleton(TestService);
      const instance = container.resolve(TestService);

      expect(instance.isReady()).toBe(true);
    });

    it('should have access to all injected dependencies in onInit', () => {
      class Logger {
        logs: string[] = [];
        log(msg: string) {
          this.logs.push(msg);
        }
      }

      class Database {
        connected = false;
        connect() {
          this.connected = true;
        }
      }

      class UserService implements OnInit {
        constructor(
          private logger: Logger,
          private db: Database
        ) {}

        onInit() {
          this.logger.log('Initializing UserService');
          this.db.connect();
          this.logger.log('UserService ready');
        }
      }

      container.registerSingleton(Logger);
      container.registerSingleton(Database);
      container.register({
        token: UserService,
        useFactory: (c) => new UserService(c.resolve(Logger), c.resolve(Database)),
        scope: 'singleton',
      });

      const logger = container.resolve(Logger);
      const db = container.resolve(Database);
      container.resolve(UserService);

      expect(logger.logs).toEqual(['Initializing UserService', 'UserService ready']);
      expect(db.connected).toBe(true);
    });

    it('should call onInit only once for singletons', () => {
      let initCount = 0;

      class TestService implements OnInit {
        onInit() {
          initCount++;
        }
      }

      container.registerSingleton(TestService);

      container.resolve(TestService);
      container.resolve(TestService);
      container.resolve(TestService);

      expect(initCount).toBe(1);
    });

    it('should call onInit for each transient instance', () => {
      let initCount = 0;

      class TestService implements OnInit {
        onInit() {
          initCount++;
        }
      }

      container.registerTransient(TestService);

      container.resolve(TestService);
      container.resolve(TestService);
      container.resolve(TestService);

      expect(initCount).toBe(3);
    });

    it('should throw LifecycleError if onInit throws', () => {
      class TestService implements OnInit {
        onInit() {
          throw new Error('Initialization failed');
        }
      }

      container.registerSingleton(TestService);

      expect(() => {
        container.resolve(TestService);
      }).toThrow(LifecycleError);
    });

    it('should include service name in lifecycle error', () => {
      class TestService implements OnInit {
        onInit() {
          throw new Error('Init error');
        }
      }

      container.registerSingleton(TestService);

      try {
        container.resolve(TestService);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LifecycleError);
        expect((error as Error).message).toContain('TestService');
        expect((error as Error).message).toContain('onInit');
      }
    });

    it('should not call onInit if not implemented', () => {
      class TestService {
        initialized = false;
      }

      container.registerSingleton(TestService);
      const instance = container.resolve(TestService);

      expect(instance.initialized).toBe(false);
    });

    it('should support onInit with state initialization', () => {
      class ConfigService implements OnInit {
        private config: Record<string, any> = {};

        onInit() {
          this.config = {
            apiUrl: 'http://localhost:3000',
            timeout: 5000,
            retries: 3,
          };
        }

        getConfig() {
          return this.config;
        }
      }

      container.registerSingleton(ConfigService);
      const config = container.resolve(ConfigService);

      expect(config.getConfig()).toEqual({
        apiUrl: 'http://localhost:3000',
        timeout: 5000,
        retries: 3,
      });
    });

    it('should call onInit in dependency order', () => {
      const events: string[] = [];

      class Logger implements OnInit {
        onInit() {
          events.push('Logger.onInit');
        }
      }

      class Database implements OnInit {
        constructor(private logger: Logger) {}

        onInit() {
          events.push('Database.onInit');
        }
      }

      class UserService implements OnInit {
        constructor(private db: Database) {}

        onInit() {
          events.push('UserService.onInit');
        }
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

      container.resolve(UserService);

      expect(events).toEqual(['Logger.onInit', 'Database.onInit', 'UserService.onInit']);
    });
  });

  describe('OnDestroy Hook', () => {
    it('should call onDestroy during dispose', async () => {
      const events: string[] = [];

      class TestService implements OnDestroy {
        onDestroy() {
          events.push('onDestroy');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await container.dispose();

      expect(events).toEqual(['onDestroy']);
    });

    it('should call onDestroy on all resolved singletons', async () => {
      const destroyOrder: string[] = [];

      class ServiceA implements OnDestroy {
        onDestroy() {
          destroyOrder.push('A');
        }
      }

      class ServiceB implements OnDestroy {
        onDestroy() {
          destroyOrder.push('B');
        }
      }

      class ServiceC implements OnDestroy {
        onDestroy() {
          destroyOrder.push('C');
        }
      }

      container.registerSingleton(ServiceA);
      container.registerSingleton(ServiceB);
      container.registerSingleton(ServiceC);

      container.resolve(ServiceA);
      container.resolve(ServiceB);
      container.resolve(ServiceC);

      await container.dispose();

      expect(destroyOrder).toHaveLength(3);
      expect(destroyOrder).toContain('A');
      expect(destroyOrder).toContain('B');
      expect(destroyOrder).toContain('C');
    });

    it('should support async onDestroy', async () => {
      let cleanedUp = false;

      class TestService implements OnDestroy {
        async onDestroy() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          cleanedUp = true;
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await container.dispose();

      expect(cleanedUp).toBe(true);
    });

    it('should not call onDestroy on unresolved services', async () => {
      const destroyCalls: string[] = [];

      class ResolvedService implements OnDestroy {
        onDestroy() {
          destroyCalls.push('resolved');
        }
      }

      class UnresolvedService implements OnDestroy {
        onDestroy() {
          destroyCalls.push('unresolved');
        }
      }

      container.registerSingleton(ResolvedService);
      container.registerSingleton(UnresolvedService);

      container.resolve(ResolvedService);
      // Don't resolve UnresolvedService

      await container.dispose();

      expect(destroyCalls).toEqual(['resolved']);
    });

    it('should throw LifecycleError if onDestroy throws', async () => {
      class TestService implements OnDestroy {
        async onDestroy() {
          throw new Error('Cleanup failed');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await expect(container.dispose()).rejects.toThrow(LifecycleError);
    });

    it('should include service name in onDestroy error', async () => {
      class TestService implements OnDestroy {
        async onDestroy() {
          throw new Error('Cleanup error');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      try {
        await container.dispose();
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(LifecycleError);
        expect((error as Error).message).toContain('TestService');
        expect((error as Error).message).toContain('onDestroy');
      }
    });

    it('should clear singleton cache after dispose', async () => {
      class TestService {
        id = Math.random();
      }

      container.registerSingleton(TestService);
      const instance1 = container.resolve(TestService);

      await container.dispose();

      // Re-register (since dispose clears singletons but not providers)
      container.registerSingleton(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).not.toBe(instance2.id);
    });

    it('should not call onDestroy if not implemented', async () => {
      class TestService {
        cleanedUp = false;
      }

      container.registerSingleton(TestService);
      const instance = container.resolve(TestService);

      await container.dispose();

      expect(instance.cleanedUp).toBe(false);
    });

    it('should handle cleanup of resources in onDestroy', async () => {
      const events: string[] = [];

      class ConnectionPool implements OnDestroy {
        private connections: any[] = [1, 2, 3];

        async onDestroy() {
          events.push('closing connections');
          await Promise.all(
            this.connections.map((conn) => {
              return new Promise((resolve) =>
                setTimeout(() => {
                  events.push(`closed connection ${conn}`);
                  resolve(undefined);
                }, 5)
              );
            })
          );
          this.connections = [];
          events.push('all connections closed');
        }

        getConnectionCount() {
          return this.connections.length;
        }
      }

      container.registerSingleton(ConnectionPool);
      const pool = container.resolve(ConnectionPool);

      expect(pool.getConnectionCount()).toBe(3);

      await container.dispose();

      expect(events).toContain('closing connections');
      expect(events).toContain('closed connection 1');
      expect(events).toContain('closed connection 2');
      expect(events).toContain('closed connection 3');
      expect(events).toContain('all connections closed');
    });
  });

  describe('Combined Lifecycle', () => {
    it('should support services with both onInit and onDestroy', async () => {
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
      container.resolve(TestService);

      expect(events).toEqual(['init']);

      await container.dispose();

      expect(events).toEqual(['init', 'destroy']);
    });

    it('should handle full lifecycle of multiple services', async () => {
      const events: string[] = [];

      class Logger implements OnInit, OnDestroy {
        onInit() {
          events.push('Logger.init');
        }

        onDestroy() {
          events.push('Logger.destroy');
        }
      }

      class Database implements OnInit, OnDestroy {
        constructor(private logger: Logger) {}

        onInit() {
          events.push('Database.init');
        }

        onDestroy() {
          events.push('Database.destroy');
        }
      }

      container.registerSingleton(Logger);
      container.register({
        token: Database,
        useFactory: (c) => new Database(c.resolve(Logger)),
        scope: 'singleton',
      });

      container.resolve(Database);

      expect(events).toEqual(['Logger.init', 'Database.init']);

      await container.dispose();

      expect(events).toContain('Logger.destroy');
      expect(events).toContain('Database.destroy');
    });

    it('should allow re-initialization after dispose', async () => {
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

      // First lifecycle
      container.resolve(TestService);
      expect(events).toEqual(['init']);

      await container.dispose();
      expect(events).toEqual(['init', 'destroy']);

      // Second lifecycle
      container.registerSingleton(TestService);
      container.resolve(TestService);
      expect(events).toEqual(['init', 'destroy', 'init']);

      await container.dispose();
      expect(events).toEqual(['init', 'destroy', 'init', 'destroy']);
    });

    it('should handle lifecycle with state management', async () => {
      class StatefulService implements OnInit, OnDestroy {
        private isConnected = false;
        private data: any[] = [];

        onInit() {
          this.isConnected = true;
          this.data = [1, 2, 3];
        }

        async onDestroy() {
          await this.cleanup();
          this.isConnected = false;
          this.data = [];
        }

        private async cleanup() {
          // Simulate async cleanup
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        getState() {
          return {
            connected: this.isConnected,
            dataCount: this.data.length,
          };
        }
      }

      container.registerSingleton(StatefulService);
      const service = container.resolve(StatefulService);

      const initialState = service.getState();
      expect(initialState.connected).toBe(true);
      expect(initialState.dataCount).toBe(3);

      await container.dispose();

      const finalState = service.getState();
      expect(finalState.connected).toBe(false);
      expect(finalState.dataCount).toBe(0);
    });
  });

  describe('Lifecycle Edge Cases', () => {
    it('should handle onInit that modifies instance properties', () => {
      class TestService implements OnInit {
        public status = 'created';
        public config?: any;

        onInit() {
          this.status = 'initialized';
          this.config = { loaded: true };
        }
      }

      container.registerSingleton(TestService);
      const instance = container.resolve(TestService);

      expect(instance.status).toBe('initialized');
      expect(instance.config).toEqual({ loaded: true });
    });

    it('should handle onDestroy that returns Promise<void>', async () => {
      let cleaned = false;

      class TestService implements OnDestroy {
        async onDestroy(): Promise<void> {
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              cleaned = true;
              resolve();
            }, 5);
          });
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await container.dispose();

      expect(cleaned).toBe(true);
    });

    it('should not affect transient services during dispose', async () => {
      const destroyCalls: string[] = [];

      class TransientService implements OnDestroy {
        onDestroy() {
          destroyCalls.push('transient');
        }
      }

      class SingletonService implements OnDestroy {
        onDestroy() {
          destroyCalls.push('singleton');
        }
      }

      container.registerTransient(TransientService);
      container.registerSingleton(SingletonService);

      container.resolve(TransientService);
      container.resolve(TransientService);
      container.resolve(SingletonService);

      await container.dispose();

      // Only singleton should have onDestroy called
      expect(destroyCalls).toEqual(['singleton']);
    });

    it('should handle services with only onInit', () => {
      const events: string[] = [];

      class TestService implements OnInit {
        onInit() {
          events.push('init');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      expect(events).toEqual(['init']);
      expect(container.dispose()).resolves.toBeUndefined();
    });

    it('should handle services with only onDestroy', async () => {
      const events: string[] = [];

      class TestService implements OnDestroy {
        onDestroy() {
          events.push('destroy');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await container.dispose();

      expect(events).toEqual(['destroy']);
    });
  });

  describe('Real-World Lifecycle Scenarios', () => {
    it('should handle database connection lifecycle', async () => {
      const events: string[] = [];

      class DatabaseConnection implements OnInit, OnDestroy {
        private connected = false;

        onInit() {
          events.push('connecting to database');
          this.connected = true;
          events.push('database connected');
        }

        async onDestroy() {
          events.push('disconnecting from database');
          await new Promise((resolve) => setTimeout(resolve, 5));
          this.connected = false;
          events.push('database disconnected');
        }

        isConnected() {
          return this.connected;
        }
      }

      container.registerSingleton(DatabaseConnection);
      const db = container.resolve(DatabaseConnection);

      expect(db.isConnected()).toBe(true);
      expect(events).toContain('connecting to database');
      expect(events).toContain('database connected');

      await container.dispose();

      expect(db.isConnected()).toBe(false);
      expect(events).toContain('disconnecting from database');
      expect(events).toContain('database disconnected');
    });

    it('should handle cache warming in onInit', () => {
      class CacheService implements OnInit {
        private cache: Map<string, any> = new Map();

        onInit() {
          // Warm up cache with initial data
          this.cache.set('user:1', { id: 1, name: 'Alice' });
          this.cache.set('user:2', { id: 2, name: 'Bob' });
          this.cache.set('config', { version: '1.0' });
        }

        get(key: string) {
          return this.cache.get(key);
        }

        size() {
          return this.cache.size;
        }
      }

      container.registerSingleton(CacheService);
      const cache = container.resolve(CacheService);

      expect(cache.size()).toBe(3);
      expect(cache.get('user:1')).toEqual({ id: 1, name: 'Alice' });
    });

    it('should handle logger initialization and cleanup', async () => {
      const logs: string[] = [];

      class LoggerService implements OnInit, OnDestroy {
        private logBuffer: string[] = [];

        onInit() {
          this.log('Logger initialized');
        }

        log(message: string) {
          this.logBuffer.push(message);
          logs.push(message);
        }

        async onDestroy() {
          this.log('Flushing log buffer');
          // Simulate async flush
          await new Promise((resolve) => setTimeout(resolve, 5));
          this.log('Logger shutdown');
          this.logBuffer = [];
        }

        getBufferSize() {
          return this.logBuffer.length;
        }
      }

      container.registerSingleton(LoggerService);
      const logger = container.resolve(LoggerService);

      logger.log('Application started');
      expect(logger.getBufferSize()).toBe(2); // 'Logger initialized' + 'Application started'

      await container.dispose();

      expect(logs).toContain('Logger initialized');
      expect(logs).toContain('Application started');
      expect(logs).toContain('Flushing log buffer');
      expect(logs).toContain('Logger shutdown');
    });
  });
});
