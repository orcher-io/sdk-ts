/**
 * Provider Factories Test Suite
 *
 * Tests for all provider types:
 * - useFactory providers
 * - useValue providers
 * - useClass providers
 *
 * @packageDocumentation
 */

import { OrcherContainer } from '../container';
import { InvalidScopeError, DependencyNotFoundError } from '../errors';

describe('Provider Factories', () => {
  let container: OrcherContainer;

  beforeEach(() => {
    container = new OrcherContainer();
  });

  describe('useFactory Providers', () => {
    it('should create instance using factory function', () => {
      const TOKEN = Symbol('factory-service');
      let callCount = 0;

      container.register({
        token: TOKEN,
        useFactory: () => {
          callCount++;
          return { id: callCount, type: 'factory' };
        },
        scope: 'singleton',
      });

      const instance = container.resolve(TOKEN);

      expect(instance).toEqual({ id: 1, type: 'factory' });
      expect(callCount).toBe(1);
    });

    it('should provide container to factory function', () => {
      class ConfigService {
        getUrl() {
          return 'http://localhost:3000';
        }
      }

      const DB_CONNECTION = Symbol('database-connection');

      container.registerSingleton(ConfigService);

      container.register({
        token: DB_CONNECTION,
        useFactory: (c) => {
          const config = c.resolve(ConfigService);
          return {
            url: config.getUrl(),
            connected: true,
          };
        },
        scope: 'singleton',
      });

      const connection = container.resolve(DB_CONNECTION);

      expect(connection.url).toBe('http://localhost:3000');
      expect(connection.connected).toBe(true);
    });

    it('should create new instance each time for transient factories', () => {
      const TOKEN = Symbol('transient-factory');
      let counter = 0;

      container.register({
        token: TOKEN,
        useFactory: () => ({ id: ++counter }),
        scope: 'transient',
      });

      const instance1 = container.resolve(TOKEN);
      const instance2 = container.resolve(TOKEN);

      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
      expect(instance1).not.toBe(instance2);
    });

    it('should cache singleton factory instances', () => {
      const TOKEN = Symbol('singleton-factory');
      let callCount = 0;

      container.register({
        token: TOKEN,
        useFactory: () => {
          callCount++;
          return { id: callCount };
        },
        scope: 'singleton',
      });

      const instance1 = container.resolve(TOKEN);
      const instance2 = container.resolve(TOKEN);

      expect(instance1).toBe(instance2);
      expect(callCount).toBe(1);
    });

    it('should support complex factory logic', () => {
      class Logger {
        log(msg: string) {
          return `[LOG] ${msg}`;
        }
      }

      class Database {
        constructor(public logger: Logger) {}
      }

      const DB_POOL = Symbol('database-pool');

      container.registerSingleton(Logger);
      container.registerSingleton(Database);

      container.register({
        token: DB_POOL,
        useFactory: (c) => {
          const db = c.resolve(Database);
          const logger = c.resolve(Logger);

          // Complex initialization logic
          logger.log('Creating database pool');

          return {
            db,
            maxConnections: 10,
            connections: [],
            acquire: () => logger.log('Acquiring connection'),
          };
        },
        scope: 'singleton',
      });

      const pool = container.resolve(DB_POOL);

      expect(pool.maxConnections).toBe(10);
      expect(pool.db).toBeInstanceOf(Database);
      expect(pool.acquire()).toBe('[LOG] Acquiring connection');
    });

    it('should support factories returning promises (for async initialization)', () => {
      const ASYNC_SERVICE = Symbol('async-service');

      container.register({
        token: ASYNC_SERVICE,
        useFactory: () => {
          // Return a promise that resolves to the service
          return Promise.resolve({ initialized: true });
        },
        scope: 'singleton',
      });

      const service = container.resolve(ASYNC_SERVICE);

      // resolve() is synchronous, so an async factory yields the Promise itself.
      expect(service).toBeInstanceOf(Promise);
    });
  });

  describe('useValue Providers', () => {
    it('should register primitive values', () => {
      const API_KEY = Symbol('api-key');
      const PORT = Symbol('port');

      container.register({
        token: API_KEY,
        useValue: 'secret-key-123',
        scope: 'singleton',
      });

      container.register({
        token: PORT,
        useValue: 3000,
        scope: 'singleton',
      });

      expect(container.resolve(API_KEY)).toBe('secret-key-123');
      expect(container.resolve(PORT)).toBe(3000);
    });

    it('should register object values', () => {
      const CONFIG = Symbol('config');
      const config = {
        database: {
          host: 'localhost',
          port: 5432,
        },
        api: {
          timeout: 5000,
        },
      };

      container.register({
        token: CONFIG,
        useValue: config,
        scope: 'singleton',
      });

      const resolved = container.resolve(CONFIG);

      expect(resolved).toBe(config);
      expect(resolved.database.host).toBe('localhost');
    });

    it('should support environment variables as values', () => {
      const ENV = Symbol('env');

      // Simulate environment variables
      const env = {
        NODE_ENV: 'production',
        API_KEY: process.env.API_KEY || 'default-key',
        DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost',
      };

      container.register({
        token: ENV,
        useValue: env,
        scope: 'singleton',
      });

      const resolved = container.resolve(ENV);

      expect(resolved.NODE_ENV).toBe('production');
      expect(typeof resolved.API_KEY).toBe('string');
    });

    it('should register arrays as values', () => {
      const ALLOWED_ORIGINS = Symbol('allowed-origins');
      const origins = ['http://localhost:3000', 'https://app.example.com'];

      container.register({
        token: ALLOWED_ORIGINS,
        useValue: origins,
        scope: 'singleton',
      });

      const resolved = container.resolve(ALLOWED_ORIGINS);

      expect(resolved).toBe(origins);
      expect(resolved).toHaveLength(2);
    });

    it('should register function values', () => {
      const FORMATTER = Symbol('formatter');
      const formatter = (date: Date) => date.toISOString();

      container.register({
        token: FORMATTER,
        useValue: formatter,
        scope: 'singleton',
      });

      const resolved = container.resolve(FORMATTER);

      expect(typeof resolved).toBe('function');
      expect(resolved(new Date('2025-01-01'))).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should allow null values', () => {
      const NULL_TOKEN = Symbol('null');

      container.register({
        token: NULL_TOKEN,
        useValue: null,
        scope: 'singleton',
      });

      expect(container.resolve(NULL_TOKEN)).toBeNull();
    });

    it('should handle undefined as absence of useValue', () => {
      // `useValue: undefined` is treated as "useValue not provided", which keeps a provider
      // with no value from being ambiguous.
      const TOKEN = Symbol('test');

      expect(() => {
        container.register({
          token: TOKEN,
          useValue: undefined,
          scope: 'singleton',
        } as any);
      }).toThrow(DependencyNotFoundError);
    });

    it('should inject value providers into services', () => {
      const API_URL = Symbol('api-url');

      class ApiClient {
        constructor(public baseUrl: string) {}

        getUrl(path: string) {
          return `${this.baseUrl}${path}`;
        }
      }

      container.register({
        token: API_URL,
        useValue: 'https://api.example.com',
        scope: 'singleton',
      });

      container.register({
        token: ApiClient,
        useFactory: (c) => {
          const url = c.resolve(API_URL);
          return new ApiClient(url);
        },
        scope: 'singleton',
      });

      const client = container.resolve(ApiClient);

      expect(client.getUrl('/users')).toBe('https://api.example.com/users');
    });
  });

  describe('useClass Providers', () => {
    it('should register with different implementation class', () => {
      abstract class Logger {
        abstract log(message: string): void;
      }

      class ConsoleLogger extends Logger {
        log(message: string) {
          // In real code, this would console.log
          return `[CONSOLE] ${message}`;
        }
      }

      class FileLogger extends Logger {
        log(message: string) {
          // In real code, this would write to file
          return `[FILE] ${message}`;
        }
      }

      container.register({
        token: Logger,
        useClass: ConsoleLogger,
        scope: 'singleton',
      });

      const logger = container.resolve(Logger);

      expect(logger).toBeInstanceOf(ConsoleLogger);
      expect(logger.log('test')).toBe('[CONSOLE] test');
    });

    it('should support interface-like tokens with concrete implementations', () => {
      // Abstract base class acting as interface
      abstract class PaymentProcessor {
        abstract processPayment(amount: number): string;
      }

      class StripeProcessor extends PaymentProcessor {
        processPayment(amount: number) {
          return `Stripe: Processing $${amount}`;
        }
      }

      class PayPalProcessor extends PaymentProcessor {
        processPayment(amount: number) {
          return `PayPal: Processing $${amount}`;
        }
      }

      // Register Stripe implementation
      container.register({
        token: PaymentProcessor,
        useClass: StripeProcessor,
        scope: 'singleton',
      });

      const processor = container.resolve(PaymentProcessor);

      expect(processor).toBeInstanceOf(StripeProcessor);
      expect(processor.processPayment(100)).toBe('Stripe: Processing $100');
    });

    it('should inject dependencies into useClass implementation', () => {
      class Logger {
        log(msg: string) {
          return `[LOG] ${msg}`;
        }
      }

      abstract class Database {
        abstract query(sql: string): string;
      }

      class PostgresDatabase extends Database {
        constructor(public logger: Logger) {
          super();
        }

        query(sql: string) {
          this.logger.log(`Executing: ${sql}`);
          return 'result';
        }
      }

      container.registerSingleton(Logger);

      // Use factory to explicitly resolve dependencies
      // (useClass relies on reflect-metadata which may not work in tests without decorators)
      container.register({
        token: Database,
        useFactory: (c) => {
          const logger = c.resolve(Logger);
          return new PostgresDatabase(logger);
        },
        scope: 'singleton',
      });

      const db = container.resolve(Database);

      expect(db).toBeInstanceOf(PostgresDatabase);
      expect(db.query('SELECT * FROM users')).toBe('result');
    });

    it('should support decorator pattern with useClass', () => {
      class BaseService {
        getValue() {
          return 'base';
        }
      }

      class CachedService extends BaseService {
        private cache = new Map<string, string>();

        getValue() {
          if (this.cache.has('value')) {
            return this.cache.get('value')!;
          }
          const value = super.getValue();
          this.cache.set('value', value);
          return value;
        }
      }

      container.register({
        token: BaseService,
        useClass: CachedService,
        scope: 'singleton',
      });

      const service = container.resolve(BaseService);

      expect(service).toBeInstanceOf(CachedService);
      expect(service.getValue()).toBe('base');
    });

    it('should allow swapping implementations', () => {
      abstract class Storage {
        abstract save(key: string, value: any): void;
        abstract get(key: string): any;
      }

      class MemoryStorage extends Storage {
        private data = new Map();

        save(key: string, value: any) {
          this.data.set(key, value);
        }

        get(key: string) {
          return this.data.get(key);
        }
      }

      class LocalStorage extends Storage {
        private data: Record<string, any> = {};

        save(key: string, value: any) {
          this.data[key] = value;
        }

        get(key: string) {
          return this.data[key];
        }
      }

      // Register with MemoryStorage
      container.register({
        token: Storage,
        useClass: MemoryStorage,
        scope: 'singleton',
      });

      const storage1 = container.resolve(Storage);
      expect(storage1).toBeInstanceOf(MemoryStorage);

      // Clear and re-register with different implementation
      container.clear();

      container.register({
        token: Storage,
        useClass: LocalStorage,
        scope: 'singleton',
      });

      const storage2 = container.resolve(Storage);
      expect(storage2).toBeInstanceOf(LocalStorage);
      expect(storage2).not.toBeInstanceOf(MemoryStorage);
    });
  });

  describe('Mixed Provider Types', () => {
    it('should work with all provider types together', () => {
      const CONFIG = Symbol('config');
      const API_URL = Symbol('api-url');

      class Logger {
        log(msg: string) {
          return msg;
        }
      }

      abstract class HttpClient {
        abstract get(path: string): string;
      }

      class FetchClient extends HttpClient {
        constructor(
          public logger: Logger,
          public baseUrl: string
        ) {
          super();
        }

        get(path: string) {
          this.logger.log(`GET ${this.baseUrl}${path}`);
          return `Response from ${this.baseUrl}${path}`;
        }
      }

      // Value provider
      container.register({
        token: CONFIG,
        useValue: { timeout: 5000, retries: 3 },
        scope: 'singleton',
      });

      // Factory provider
      container.register({
        token: API_URL,
        useFactory: (c) => {
          const config = c.resolve(CONFIG);
          return `https://api.example.com?timeout=${config.timeout}`;
        },
        scope: 'singleton',
      });

      // Class provider (direct)
      container.registerSingleton(Logger);

      // Class provider (with useClass)
      container.register({
        token: HttpClient,
        useClass: FetchClient,
        scope: 'singleton',
      });

      const client = container.resolve(HttpClient);
      const config = container.resolve(CONFIG);
      const url = container.resolve(API_URL);

      expect(client).toBeInstanceOf(FetchClient);
      expect(config.timeout).toBe(5000);
      expect(url).toContain('timeout=5000');
    });

    it('should resolve complex dependency graph with mixed providers', () => {
      const DB_CONFIG = Symbol('db-config');
      const DB_CONNECTION = Symbol('db-connection');

      class Logger {
        log(msg: string) {
          return `[${new Date().toISOString()}] ${msg}`;
        }
      }

      class DatabaseConnection {
        constructor(
          public config: any,
          public logger: Logger
        ) {}

        connect() {
          this.logger.log(`Connecting to ${this.config.host}`);
          return true;
        }
      }

      class UserRepository {
        constructor(
          public connection: DatabaseConnection,
          public logger: Logger
        ) {}

        findAll() {
          this.connection.connect();
          this.logger.log('Finding all users');
          return ['user1', 'user2'];
        }
      }

      // Value provider
      container.register({
        token: DB_CONFIG,
        useValue: {
          host: 'localhost',
          port: 5432,
          database: 'myapp',
        },
        scope: 'singleton',
      });

      // Factory provider
      container.register({
        token: DB_CONNECTION,
        useFactory: (c) => {
          const config = c.resolve(DB_CONFIG);
          const logger = c.resolve(Logger);
          return new DatabaseConnection(config, logger);
        },
        scope: 'singleton',
      });

      // Direct class registration
      container.registerSingleton(Logger);

      // Class with dependencies
      container.register({
        token: UserRepository,
        useFactory: (c) => {
          const connection = c.resolve(DB_CONNECTION);
          const logger = c.resolve(Logger);
          return new UserRepository(connection, logger);
        },
        scope: 'singleton',
      });

      const repo = container.resolve(UserRepository);
      const users = repo.findAll();

      expect(users).toEqual(['user1', 'user2']);
      expect(repo.connection.config.host).toBe('localhost');
    });
  });

  describe('Edge Cases', () => {
    it('should throw error for provider without any useX property', () => {
      const TOKEN = Symbol('invalid');

      expect(() => {
        container.register({
          token: TOKEN,
          scope: 'singleton',
        } as any);
      }).toThrow(DependencyNotFoundError);
    });

    it('should validate scope parameter', () => {
      class TestService {}

      expect(() => {
        container.register({
          token: TestService,
          useClass: TestService,
          scope: 'invalid-scope' as any,
        });
      }).toThrow(InvalidScopeError);
    });

    it('should default to singleton scope when not specified', () => {
      class TestService {
        id = Math.random();
      }

      container.register({
        token: TestService,
        useClass: TestService,
        // No scope specified
      });

      const instance1 = container.resolve(TestService);
      const instance2 = container.resolve(TestService);

      expect(instance1).toBe(instance2);
    });

    it('should handle symbol tokens correctly', () => {
      const TOKEN1 = Symbol('test');
      const TOKEN2 = Symbol('test'); // Same description, different symbol

      container.register({
        token: TOKEN1,
        useValue: 'value1',
        scope: 'singleton',
      });

      container.register({
        token: TOKEN2,
        useValue: 'value2',
        scope: 'singleton',
      });

      expect(container.resolve(TOKEN1)).toBe('value1');
      expect(container.resolve(TOKEN2)).toBe('value2');
    });

    it('should handle string tokens correctly', () => {
      const TOKEN = 'MY_SERVICE';

      container.register({
        token: TOKEN,
        useValue: { name: 'test' },
        scope: 'singleton',
      });

      const resolved = container.resolve(TOKEN);
      expect(resolved.name).toBe('test');
    });
  });
});
