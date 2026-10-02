/**
 * Tests for @Inject() Decorator
 * @packageDocumentation
 */

import {
  Inject,
  getInjectTokens,
  getInjectToken,
  hasInject,
  getInjectCount,
} from '../decorators/inject';
import { Injectable } from '../decorators/injectable';
import { OrcherContainer } from '../container';

describe('@Inject() Decorator', () => {
  let container: OrcherContainer;

  beforeEach(() => {
    container = new OrcherContainer();
  });

  afterEach(() => {
    container.clear();
  });

  describe('Basic Functionality', () => {
    it('should store injection token in metadata', () => {
      const TOKEN = Symbol('test');

      class TestService {
        constructor(@Inject(TOKEN) private dep: any) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(TOKEN);
    });

    it('should support multiple @Inject decorators', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          @Inject(TOKEN2) private dep2: any
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(TOKEN1);
      expect(tokens[1]).toBe(TOKEN2);
    });

    it('should support mixed decorated and non-decorated parameters', () => {
      const TOKEN = Symbol('token');

      @Injectable()
      class Dependency {}

      @Injectable()
      class TestService {
        constructor(
          @Inject(TOKEN) private custom: any,
          private normal: Dependency
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(TOKEN);
      expect(tokens[1]).toBeUndefined();
    });

    it('should preserve parameter order', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');
      const TOKEN3 = Symbol('token3');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          private dep2: any,
          @Inject(TOKEN2) private dep3: any,
          private dep4: any,
          @Inject(TOKEN3) private dep5: any
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(TOKEN1);
      expect(tokens[1]).toBeUndefined();
      expect(tokens[2]).toBe(TOKEN2);
      expect(tokens[3]).toBeUndefined();
      expect(tokens[4]).toBe(TOKEN3);
    });
  });

  describe('Token Types', () => {
    it('should support Symbol tokens', () => {
      const TOKEN = Symbol('ILogger');

      class TestService {
        constructor(@Inject(TOKEN) private logger: any) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(TOKEN);
    });

    it('should support string tokens', () => {
      class TestService {
        constructor(@Inject('API_KEY') private apiKey: string) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe('API_KEY');
    });

    it('should support class tokens', () => {
      class MockLogger {}

      class TestService {
        constructor(@Inject(MockLogger) private logger: any) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(MockLogger);
    });

    it('should support multiple token types', () => {
      const SYMBOL_TOKEN = Symbol('symbol');
      class ClassToken {}

      class TestService {
        constructor(
          @Inject(SYMBOL_TOKEN) private dep1: any,
          @Inject('STRING_TOKEN') private dep2: any,
          @Inject(ClassToken) private dep3: any
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens[0]).toBe(SYMBOL_TOKEN);
      expect(tokens[1]).toBe('STRING_TOKEN');
      expect(tokens[2]).toBe(ClassToken);
    });
  });

  describe('Integration with Container', () => {
    it('should resolve dependency using custom token', () => {
      const ILogger = Symbol('ILogger');

      class ConsoleLogger {
        log(message: string) {
          return `LOG: ${message}`;
        }
      }

      @Injectable()
      class UserService {
        constructor(@Inject(ILogger) public logger: ConsoleLogger) {}
      }

      // Register with custom token
      container.register({ token: ILogger, useClass: ConsoleLogger });
      container.registerSingleton(UserService);

      const service = container.resolve(UserService);
      expect(service).toBeDefined();
      expect(service.logger).toBeInstanceOf(ConsoleLogger);
      expect(service.logger.log('test')).toBe('LOG: test');
    });

    it('should resolve string token with value', () => {
      @Injectable()
      class ApiClient {
        constructor(
          @Inject('API_URL') public apiUrl: string,
          @Inject('API_KEY') public apiKey: string
        ) {}
      }

      container.register({ token: 'API_URL', useValue: 'https://api.example.com' });
      container.register({ token: 'API_KEY', useValue: 'secret-key-123' });
      container.registerSingleton(ApiClient);

      const client = container.resolve(ApiClient);
      expect(client.apiUrl).toBe('https://api.example.com');
      expect(client.apiKey).toBe('secret-key-123');
    });

    it('should resolve mixed custom and normal dependencies', () => {
      const ICache = Symbol('ICache');

      class MemoryCache {
        get(key: string) {
          return `cached:${key}`;
        }
      }

      @Injectable()
      class DatabaseService {
        query(sql: string) {
          return `result:${sql}`;
        }
      }

      @Injectable()
      class UserRepository {
        constructor(
          @Inject(ICache) public cache: MemoryCache,
          public db: DatabaseService
        ) {}
      }

      container.register({ token: ICache, useClass: MemoryCache });
      container.registerSingleton(DatabaseService);
      container.registerSingleton(UserRepository);

      const repo = container.resolve(UserRepository);
      expect(repo.cache).toBeInstanceOf(MemoryCache);
      expect(repo.db).toBeInstanceOf(DatabaseService);
      expect(repo.cache.get('key')).toBe('cached:key');
      expect(repo.db.query('SELECT *')).toBe('result:SELECT *');
    });

    it('should resolve with factory using custom token', () => {
      const IConfig = Symbol('IConfig');

      interface Config {
        timeout: number;
        retries: number;
      }

      @Injectable()
      class ApiService {
        constructor(@Inject(IConfig) public config: Config) {}
      }

      container.register({
        token: IConfig,
        useFactory: () => ({ timeout: 5000, retries: 3 }),
      });
      container.registerSingleton(ApiService);

      const service = container.resolve(ApiService);
      expect(service.config).toEqual({ timeout: 5000, retries: 3 });
    });
  });

  describe('Helper Functions', () => {
    it('getInjectTokens() should return all tokens', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          private dep2: any,
          @Inject(TOKEN2) private dep3: any
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toBe(TOKEN1);
      expect(tokens[1]).toBeUndefined();
      expect(tokens[2]).toBe(TOKEN2);
    });

    it('getInjectTokens() should return empty array for non-class', () => {
      expect(getInjectTokens(null)).toEqual([]);
      expect(getInjectTokens(undefined)).toEqual([]);
      expect(getInjectTokens({})).toEqual([]);
      expect(getInjectTokens('string')).toEqual([]);
    });

    it('getInjectTokens() should return empty array for class without @Inject', () => {
      class TestService {
        constructor(private dep: any) {}
      }

      expect(getInjectTokens(TestService)).toEqual([]);
    });

    it('getInjectToken() should return token for specific parameter', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          private dep2: any,
          @Inject(TOKEN2) private dep3: any
        ) {}
      }

      expect(getInjectToken(TestService, 0)).toBe(TOKEN1);
      expect(getInjectToken(TestService, 1)).toBeUndefined();
      expect(getInjectToken(TestService, 2)).toBe(TOKEN2);
    });

    it('getInjectToken() should return undefined for out of range index', () => {
      const TOKEN = Symbol('token');

      class TestService {
        constructor(@Inject(TOKEN) private dep: any) {}
      }

      expect(getInjectToken(TestService, 5)).toBeUndefined();
    });

    it('hasInject() should detect decorated parameters', () => {
      const TOKEN = Symbol('token');

      class TestService {
        constructor(
          @Inject(TOKEN) private dep1: any,
          private dep2: any
        ) {}
      }

      expect(hasInject(TestService, 0)).toBe(true);
      expect(hasInject(TestService, 1)).toBe(false);
    });

    it('getInjectCount() should count decorated parameters', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');
      const TOKEN3 = Symbol('token3');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          private dep2: any,
          @Inject(TOKEN2) private dep3: any,
          private dep4: any,
          @Inject(TOKEN3) private dep5: any
        ) {}
      }

      expect(getInjectCount(TestService)).toBe(3);
    });

    it('getInjectCount() should return 0 for class without @Inject', () => {
      class TestService {
        constructor(private dep: any) {}
      }

      expect(getInjectCount(TestService)).toBe(0);
    });
  });

  describe('Error Cases', () => {
    it('should throw error if token is undefined', () => {
      expect(() => {
        class TestService {
          constructor(@Inject(undefined as any) private dep: any) {}
        }
      }).toThrow(/@Inject\(\) requires a valid token/);
    });

    it('should throw error if token is null', () => {
      expect(() => {
        class TestService {
          constructor(@Inject(null as any) private dep: any) {}
        }
      }).toThrow(/@Inject\(\) requires a valid token/);
    });

    it('should provide helpful error message', () => {
      expect(() => {
        class TestService {
          constructor(@Inject(undefined as any) private dep: any) {}
        }
      }).toThrow(/Usage: @Inject\(token\)/);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support interface injection pattern', () => {
      // Define interface token
      const ILogger = Symbol('ILogger');

      interface ILogger {
        log(message: string): void;
        error(message: string): void;
      }

      class ConsoleLogger implements ILogger {
        log(message: string) {
          return `LOG: ${message}`;
        }
        error(message: string) {
          return `ERROR: ${message}`;
        }
      }

      @Injectable()
      class UserService {
        constructor(@Inject(ILogger) public logger: ILogger) {}

        getUser(id: string) {
          this.logger.log(`Fetching user ${id}`);
          return { id, name: 'John' };
        }
      }

      container.register({ token: ILogger, useClass: ConsoleLogger });
      container.registerSingleton(UserService);

      const service = container.resolve(UserService);
      const user = service.getUser('123');
      expect(user).toEqual({ id: '123', name: 'John' });
    });

    it('should support configuration injection', () => {
      @Injectable()
      class DatabaseService {
        constructor(
          @Inject('DB_HOST') public host: string,
          @Inject('DB_PORT') public port: number,
          @Inject('DB_NAME') public database: string
        ) {}

        getConnectionString() {
          return `${this.host}:${this.port}/${this.database}`;
        }
      }

      container.register({ token: 'DB_HOST', useValue: 'localhost' });
      container.register({ token: 'DB_PORT', useValue: 5432 });
      container.register({ token: 'DB_NAME', useValue: 'myapp' });
      container.registerSingleton(DatabaseService);

      const db = container.resolve(DatabaseService);
      expect(db.getConnectionString()).toBe('localhost:5432/myapp');
    });

    it('should support mock injection for testing', () => {
      const IEmailService = Symbol('IEmailService');

      interface IEmailService {
        send(to: string, subject: string): Promise<boolean>;
      }

      class MockEmailService implements IEmailService {
        public sentEmails: Array<{ to: string; subject: string }> = [];

        async send(to: string, subject: string) {
          this.sentEmails.push({ to, subject });
          return true;
        }
      }

      @Injectable()
      class UserRegistration {
        constructor(@Inject(IEmailService) private email: IEmailService) {}

        async register(email: string) {
          await this.email.send(email, 'Welcome!');
          return { success: true };
        }
      }

      const mockEmail = new MockEmailService();
      container.register({ token: IEmailService, useValue: mockEmail });
      container.registerSingleton(UserRegistration);

      const registration = container.resolve(UserRegistration);
      registration.register('user@example.com');

      expect(mockEmail.sentEmails).toHaveLength(1);
      expect(mockEmail.sentEmails[0]).toEqual({
        to: 'user@example.com',
        subject: 'Welcome!',
      });
    });

    it('should support factory with dependencies', () => {
      const ICache = Symbol('ICache');

      interface CacheConfig {
        ttl: number;
        maxSize: number;
      }

      class Cache {
        constructor(private config: CacheConfig) {}
        get(key: string) {
          return `cached:${key}:ttl=${this.config.ttl}`;
        }
      }

      @Injectable()
      class ApiService {
        constructor(@Inject(ICache) public cache: Cache) {}
      }

      container.register({
        token: ICache,
        useFactory: () => new Cache({ ttl: 3600, maxSize: 1000 }),
      });
      container.registerSingleton(ApiService);

      const service = container.resolve(ApiService);
      expect(service.cache.get('key')).toBe('cached:key:ttl=3600');
    });

    it('should support multiple services with same token type', () => {
      const ILogger = Symbol('ILogger');

      class Logger {
        log(msg: string) {
          return msg;
        }
      }

      @Injectable()
      class ServiceA {
        constructor(@Inject(ILogger) public logger: Logger) {}
      }

      @Injectable()
      class ServiceB {
        constructor(@Inject(ILogger) public logger: Logger) {}
      }

      container.register({ token: ILogger, useClass: Logger, scope: 'singleton' });
      container.registerSingleton(ServiceA);
      container.registerSingleton(ServiceB);

      const serviceA = container.resolve(ServiceA);
      const serviceB = container.resolve(ServiceB);

      // Both should get the same logger instance (singleton)
      expect(serviceA.logger).toBe(serviceB.logger);
    });
  });

  describe('Edge Cases', () => {
    it('should handle class with no constructor parameters', () => {
      class TestService {}

      expect(getInjectTokens(TestService)).toEqual([]);
      expect(getInjectCount(TestService)).toBe(0);
    });

    it('should handle @Inject on last parameter', () => {
      const TOKEN = Symbol('token');

      class TestService {
        constructor(
          private dep1: any,
          private dep2: any,
          @Inject(TOKEN) private dep3: any
        ) {}
      }

      expect(getInjectToken(TestService, 2)).toBe(TOKEN);
    });

    it('should handle @Inject on first parameter', () => {
      const TOKEN = Symbol('token');

      class TestService {
        constructor(
          @Inject(TOKEN) private dep1: any,
          private dep2: any,
          private dep3: any
        ) {}
      }

      expect(getInjectToken(TestService, 0)).toBe(TOKEN);
    });

    it('should handle all parameters decorated', () => {
      const TOKEN1 = Symbol('token1');
      const TOKEN2 = Symbol('token2');
      const TOKEN3 = Symbol('token3');

      class TestService {
        constructor(
          @Inject(TOKEN1) private dep1: any,
          @Inject(TOKEN2) private dep2: any,
          @Inject(TOKEN3) private dep3: any
        ) {}
      }

      const tokens = getInjectTokens(TestService);
      expect(tokens).toHaveLength(3);
      expect(tokens.every(t => t !== undefined)).toBe(true);
    });

    it('should preserve class name', () => {
      const TOKEN = Symbol('token');

      class MySpecialService {
        constructor(@Inject(TOKEN) private dep: any) {}
      }

      expect(MySpecialService.name).toBe('MySpecialService');
    });

    it('should work with class inheritance', () => {
      const TOKEN = Symbol('token');

      class BaseService {
        constructor(protected base: any) {}
      }

      class DerivedService extends BaseService {
        constructor(
          base: any,
          @Inject(TOKEN) private derived: any
        ) {
          super(base);
        }
      }

      expect(hasInject(DerivedService, 1)).toBe(true);
    });

    it('should handle Symbol.for tokens', () => {
      const TOKEN = Symbol.for('global-token');

      class TestService {
        constructor(@Inject(TOKEN) private dep: any) {}
      }

      expect(getInjectToken(TestService, 0)).toBe(TOKEN);
    });
  });

  describe('Type Safety', () => {
    it('should not interfere with parameter types', () => {
      const TOKEN = Symbol('token');

      class Dependency {
        value = 'test';
      }

      @Injectable()
      class TestService {
        constructor(@Inject(TOKEN) public dep: Dependency) {}
      }

      container.register({ token: TOKEN, useValue: new Dependency() });
      container.registerSingleton(TestService);

      const service = container.resolve(TestService);
      expect(service.dep.value).toBe('test');
    });

    it('should work with generic types', () => {
      const TOKEN = Symbol('token');

      class Container<T> {
        constructor(public value: T) {}
      }

      @Injectable()
      class TestService {
        constructor(@Inject(TOKEN) public container: Container<string>) {}
      }

      container.register({ token: TOKEN, useValue: new Container('test') });
      container.registerSingleton(TestService);

      const service = container.resolve(TestService);
      expect(service.container.value).toBe('test');
    });
  });
});
