/**
 * The `@Inject()` parameter decorator and helpers for reading injection tokens.
 *
 * Use `@Inject()` when a constructor parameter should be resolved by a token other than its
 * type: an interface, a symbol, a string, or a different class.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/ban-types, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-member-access */
// Decorator signatures are typed with `any` and `Object`.

import 'reflect-metadata';
import type { Token } from '../types';

/**
 * Sets the token the container uses to resolve a constructor parameter.
 *
 * By default, the container resolves a parameter by its TypeScript type. `@Inject()` overrides
 * that with a class, symbol, or string token. Use it to:
 * - inject an interface, which has no runtime value to resolve by
 * - use a symbol token for an abstract dependency
 * - use a string token for a configuration value
 * - inject a different implementation than the parameter type
 *
 * @param token - The token to resolve the parameter with.
 * @returns A parameter decorator.
 * @throws Error if `token` is `undefined` or `null`.
 *
 * @example
 * Basic usage with Symbol token:
 * ```typescript
 * const ILogger = Symbol('ILogger');
 *
 * @Injectable()
 * export class UserService {
 *   constructor(
 *     @Inject(ILogger) private logger: any
 *   ) {}
 * }
 *
 * // Register the implementation
 * container.register({
 *   token: ILogger,
 *   useClass: ConsoleLogger
 * });
 * ```
 *
 * @example
 * Using string tokens for configuration:
 * ```typescript
 * @Injectable()
 * export class ApiClient {
 *   constructor(
 *     @Inject('API_URL') private apiUrl: string,
 *     @Inject('API_KEY') private apiKey: string
 *   ) {}
 * }
 *
 * // Register configuration values
 * container.register({
 *   token: 'API_URL',
 *   useValue: 'https://api.example.com'
 * });
 * container.register({
 *   token: 'API_KEY',
 *   useValue: process.env.API_KEY
 * });
 * ```
 *
 * @example
 * Interface injection (TypeScript interfaces):
 * ```typescript
 * // Define interface and token
 * interface IDatabase {
 *   query(sql: string): Promise<any>;
 * }
 * const IDatabase = Symbol('IDatabase');
 *
 * @Injectable()
 * export class UserRepository {
 *   constructor(
 *     @Inject(IDatabase) private db: IDatabase
 *   ) {}
 *
 *   async findUser(id: string) {
 *     return this.db.query(`SELECT * FROM users WHERE id = '${id}'`);
 *   }
 * }
 *
 * // Register implementation
 * container.register({
 *   token: IDatabase,
 *   useClass: PostgresDatabase
 * });
 * ```
 *
 * @example
 * Multiple injections in one constructor:
 * ```typescript
 * const ILogger = Symbol('ILogger');
 * const ICache = Symbol('ICache');
 *
 * @Injectable()
 * export class OrderService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     @Inject(ICache) private cache: any,
 *     @Inject('MAX_RETRIES') private maxRetries: number,
 *     private db: DatabaseService  // Resolved by its type
 *   ) {}
 * }
 * ```
 *
 * @example
 * Injecting different implementation:
 * ```typescript
 * @Injectable()
 * export class EmailService {
 *   constructor(
 *     @Inject(MockEmailClient) private client: EmailClient
 *   ) {}
 * }
 * ```
 */
export function Inject(token: Token): ParameterDecorator {
  return function (
    target: Object,
    _propertyKey: string | symbol | undefined,
    parameterIndex: number
  ): void {
    if (token === undefined || token === null) {
      throw new Error(
        `@Inject() requires a valid token. Received: ${token}\n` +
          `Usage: @Inject(token) where token is a class, Symbol, or string`
      );
    }

    const existingTokens: (Token | undefined)[] =
      Reflect.getMetadata('inject:tokens', target) || [];

    existingTokens[parameterIndex] = token;

    Reflect.defineMetadata('inject:tokens', existingTokens, target);
  };
}

/**
 * Returns the `@Inject()` tokens of a class constructor, indexed by parameter position.
 *
 * A parameter without `@Inject()` has an `undefined` entry.
 *
 * @param target - Class constructor
 * @returns Injection tokens by parameter index, or an empty array if `target` is not a class
 *
 * @example
 * ```typescript
 * const ILogger = Symbol('ILogger');
 *
 * @Injectable()
 * class MyService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     private db: DatabaseService
 *   ) {}
 * }
 *
 * const tokens = getInjectTokens(MyService);
 * console.log(tokens); // [Symbol(ILogger), undefined]
 * ```
 */
export function getInjectTokens(target: any): (Token | undefined)[] {
  if (!target || typeof target !== 'function') {
    return [];
  }
  return Reflect.getMetadata('inject:tokens', target) || [];
}

/**
 * Returns the `@Inject()` token of one constructor parameter.
 *
 * @param target - Class constructor
 * @param parameterIndex - Parameter index (0-based)
 * @returns The injection token, or undefined if not decorated
 *
 * @example
 * ```typescript
 * const ILogger = Symbol('ILogger');
 *
 * @Injectable()
 * class MyService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     private db: DatabaseService
 *   ) {}
 * }
 *
 * const token0 = getInjectToken(MyService, 0);
 * console.log(token0); // Symbol(ILogger)
 *
 * const token1 = getInjectToken(MyService, 1);
 * console.log(token1); // undefined
 * ```
 */
export function getInjectToken(target: any, parameterIndex: number): Token | undefined {
  const tokens = getInjectTokens(target);
  return tokens[parameterIndex];
}

/**
 * Returns whether a constructor parameter is decorated with `@Inject()`.
 *
 * @param target - Class constructor
 * @param parameterIndex - Parameter index (0-based)
 * @returns true if the parameter is decorated with @Inject
 *
 * @example
 * ```typescript
 * const ILogger = Symbol('ILogger');
 *
 * @Injectable()
 * class MyService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     private db: DatabaseService
 *   ) {}
 * }
 *
 * hasInject(MyService, 0); // true
 * hasInject(MyService, 1); // false
 * ```
 */
export function hasInject(target: any, parameterIndex: number): boolean {
  const token = getInjectToken(target, parameterIndex);
  return token !== undefined;
}

/**
 * Returns the number of constructor parameters decorated with `@Inject()`.
 *
 * @param target - Class constructor
 * @returns Count of parameters with @Inject decorator
 *
 * @example
 * ```typescript
 * const ILogger = Symbol('ILogger');
 * const ICache = Symbol('ICache');
 *
 * @Injectable()
 * class MyService {
 *   constructor(
 *     @Inject(ILogger) private logger: any,
 *     private db: DatabaseService,
 *     @Inject(ICache) private cache: any
 *   ) {}
 * }
 *
 * const count = getInjectCount(MyService);
 * console.log(count); // 2
 * ```
 */
export function getInjectCount(target: any): number {
  const tokens = getInjectTokens(target);
  return tokens.filter((token) => token !== undefined).length;
}
