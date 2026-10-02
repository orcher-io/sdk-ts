/**
 * The dependency injection container: resolves services and runs their lifecycle hooks.
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
// A DI container stores and returns values of arbitrary type, so `any` is intentional here.

import 'reflect-metadata';
import {
  DependencyNotFoundError,
  CircularDependencyError,
  InvalidScopeError,
  LifecycleError,
  getTokenName,
} from './errors';
import type { Token, Type, Factory, Provider, OnInit, OnDestroy } from './types';

/**
 * Dependency injection container that creates and caches service instances.
 *
 * Supports `singleton` and `transient` scopes, constructor injection through reflect-metadata
 * and `@Inject()`, circular dependency detection, and the `onInit` / `onDestroy` lifecycle
 * hooks. The worker builds one container and resolves task handlers and actors from it.
 *
 * @example
 * ```typescript
 * // Register services
 * const container = new OrcherContainer();
 * container.registerSingleton(LoggerService);
 * container.register({
 *   token: DatabaseService,
 *   useClass: PostgresDatabase,
 *   scope: 'singleton'
 * });
 *
 * // Resolve with automatic dependency injection
 * const logger = container.resolve(LoggerService);
 * const db = container.resolve(DatabaseService);
 *
 * // Cleanup
 * await container.dispose();
 * ```
 */
export class OrcherContainer {
  /** Cached singleton instances */
  private singletons = new Map<Token<any>, any>();

  /** Registered providers */
  private providers = new Map<Token<any>, Provider<any>>();

  /** Tokens currently being resolved, outermost first, for cycle detection */
  private resolutionStack: Token<any>[] = [];

  /**
   * Creates an empty container.
   */
  constructor() {
    // No setup needed.
  }

  // =========================================================================
  // Registration Methods
  // =========================================================================

  /**
   * Registers a singleton provider.
   *
   * The instance is created on first resolution and cached. Later resolutions return the same
   * instance until {@link OrcherContainer.dispose} or {@link OrcherContainer.clear}.
   *
   * @param token - Service class or token
   * @param factory - Creates the instance. Omit it to instantiate `token`, which must then be a
   *   class.
   *
   * @example
   * ```typescript
   * // Register by class
   * container.registerSingleton(LoggerService);
   *
   * // Register with factory
   * container.registerSingleton(DatabaseService, (c) => {
   *   return new DatabaseService(c.resolve(ConfigService));
   * });
   * ```
   */
  registerSingleton<T>(token: Token<T>, factory?: Factory<T>): void {
    this.register({
      token,
      useFactory: factory,
      scope: 'singleton',
    });
  }

  /**
   * Registers a transient provider.
   *
   * A new instance is created on every resolution and is never cached, so `dispose()` does not
   * call its `onDestroy` hook.
   *
   * @param token - Service class or token
   * @param factory - Creates the instance. Omit it to instantiate `token`, which must then be a
   *   class.
   *
   * @example
   * ```typescript
   * // Register by class (new instance each time)
   * container.registerTransient(RequestContext);
   *
   * // Register with factory
   * container.registerTransient(HttpClient, (c) => {
   *   return new HttpClient(c.resolve(ConfigService));
   * });
   * ```
   */
  registerTransient<T>(token: Token<T>, factory?: Factory<T>): void {
    this.register({
      token,
      useFactory: factory,
      scope: 'transient',
    });
  }

  /**
   * Registers a provider.
   *
   * The first of these that is set decides how the instance is created:
   * - `useValue`: the given value.
   * - `useFactory`: the factory's return value.
   * - `useClass`: a new instance of the class, with constructor dependencies injected.
   *
   * With none set, `token` itself must be a class. `scope` defaults to `singleton`.
   * Registering a token again replaces its provider.
   *
   * @param provider - Provider configuration
   * @throws {InvalidScopeError} If `scope` is not `singleton` or `transient` (this includes
   *   `scoped`)
   * @throws {DependencyNotFoundError} If no way to create the instance is given and the token is
   *   not a class
   *
   * @example
   * ```typescript
   * // Class provider
   * container.register({
   *   token: LoggerService,
   *   useClass: ConsoleLogger,
   *   scope: 'singleton'
   * });
   *
   * // Factory provider
   * container.register({
   *   token: 'CONFIG',
   *   useFactory: () => loadConfig(),
   *   scope: 'singleton'
   * });
   *
   * // Value provider
   * container.register({
   *   token: 'API_KEY',
   *   useValue: 'secret-key-123',
   *   scope: 'singleton'
   * });
   * ```
   */
  register<T>(provider: Provider<T>): void {
    const { token, useClass, useFactory, useValue, scope = 'singleton' } = provider;

    if (scope !== 'singleton' && scope !== 'transient') {
      throw new InvalidScopeError(scope);
    }

    // Every provider kind is normalized to a factory, so resolve() has one code path.
    let factory: Factory<T>;

    if (useValue !== undefined) {
      factory = () => useValue;
    } else if (useFactory) {
      factory = useFactory;
    } else if (useClass) {
      factory = (container) => this.instantiateClass(useClass, container);
    } else if (typeof token === 'function') {
      factory = (container) => this.instantiateClass(token as Type<T>, container);
    } else {
      throw new DependencyNotFoundError(
        token,
        this.resolutionStack,
        'Invalid provider configuration: must specify useClass, useFactory, or useValue'
      );
    }

    this.providers.set(token, {
      token,
      useFactory: factory,
      scope,
    } as Provider<T>);
  }

  // =========================================================================
  // Resolution Methods
  // =========================================================================

  /**
   * Returns the instance for a token, creating it and its dependencies as needed.
   *
   * A singleton is returned from the cache when present. Otherwise the provider's factory runs,
   * a singleton is cached, and the instance's `onInit` hook is called.
   *
   * `resolve()` is synchronous. It does not await a promise returned by a factory or by
   * `onInit`; an async `onInit` logs a warning and runs unawaited, so do asynchronous setup
   * elsewhere.
   *
   * @param token - Service class or token
   * @returns Service instance with dependencies injected
   * @throws {DependencyNotFoundError} If the token is not registered
   * @throws {CircularDependencyError} If a circular dependency is detected
   * @throws {LifecycleError} If `onInit` throws. A singleton stays cached in that case.
   *
   * @example
   * ```typescript
   * const logger = container.resolve(LoggerService);
   *
   * // UserService's constructor receives the LoggerService instance.
   * const userService = container.resolve(UserService);
   * ```
   */
  resolve<T>(token: Token<T>): T {
    const tokenName = getTokenName(token);

    if (this.resolutionStack.includes(token)) {
      throw new CircularDependencyError([...this.resolutionStack, token]);
    }

    const provider = this.providers.get(token);
    if (!provider) {
      throw new DependencyNotFoundError(token, this.resolutionStack);
    }

    const scope = provider.scope ?? 'singleton';

    if (scope === 'singleton' && this.singletons.has(token)) {
      return this.singletons.get(token);
    }

    // Pushed before the factory runs, so a dependency that leads back to this token is caught
    // by the check above. The finally block pops it on every exit path.
    this.resolutionStack.push(token);

    try {
      if (!provider.useFactory) {
        throw new DependencyNotFoundError(
          token,
          this.resolutionStack,
          'Provider has no factory function'
        );
      }

      const instance = provider.useFactory(this);

      if (scope === 'singleton') {
        this.singletons.set(token, instance);
      }

      if (this.hasOnInit(instance)) {
        try {
          const initResult = instance.onInit();
          if (initResult && typeof initResult.then === 'function') {
            console.warn(
              `[OrcherContainer] Service '${tokenName}' has async onInit. ` +
                `Consider using a synchronous onInit or handle initialization separately.`
            );
            // Not awaited: resolve() stays synchronous. The warning tells the user that the
            // service may be used before its initialization finishes.
          }
        } catch (error) {
          throw new LifecycleError(
            tokenName,
            'onInit',
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }

      return instance;
    } finally {
      this.resolutionStack.pop();
    }
  }

  /**
   * Returns whether a provider is registered for a token.
   *
   * @param token - Service class or token
   * @returns true if the token is registered, false otherwise
   *
   * @example
   * ```typescript
   * if (container.has(LoggerService)) {
   *   console.log('LoggerService is registered');
   * }
   * ```
   */
  has(token: Token<any>): boolean {
    return this.providers.has(token);
  }

  // =========================================================================
  // Instance Creation
  // =========================================================================

  /**
   * Creates an instance of a class, resolving each constructor parameter from the container.
   *
   * A parameter's token is its `@Inject()` token when present, otherwise the parameter type
   * that TypeScript emits as `design:paramtypes` metadata.
   *
   * @param classType - Class constructor
   * @param container - Container to resolve dependencies from
   * @returns New instance with dependencies injected
   * @throws {DependencyNotFoundError} If a parameter has no usable token, such as an interface
   *   type without `@Inject()`
   * @private
   */
  private instantiateClass<T>(classType: Type<T>, container: OrcherContainer): T {
    const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', classType) || [];

    const injectTokens: Token<any>[] = Reflect.getMetadata('inject:tokens', classType) ?? [];

    const dependencies = paramTypes.map((paramType, index) => {
      const token = injectTokens[index] ?? paramType;

      // Interface and some union types emit no runtime type, so the parameter needs @Inject().
      if (token === undefined) {
        throw new DependencyNotFoundError(
          classType,
          this.resolutionStack,
          `Cannot inject parameter at index ${index}: type is undefined. Use @Inject() decorator.`
        );
      }

      return container.resolve(token);
    });

    return new classType(...dependencies);
  }

  // =========================================================================
  // Lifecycle Methods
  // =========================================================================

  /**
   * Calls `onDestroy` on cached singletons, then empties the singleton cache.
   *
   * Hooks run one at a time, in the order the singletons were cached, and each is awaited.
   * Providers stay registered, so a later `resolve()` creates fresh instances.
   *
   * @throws {LifecycleError} If an `onDestroy` hook throws. Disposal stops there: the remaining
   *   hooks are not called and the cache is not emptied.
   *
   * @example
   * ```typescript
   * // On shutdown
   * await container.dispose();
   * ```
   */
  async dispose(): Promise<void> {
    const instances = Array.from(this.singletons.entries());

    for (const [token, instance] of instances) {
      if (this.hasOnDestroy(instance)) {
        try {
          await instance.onDestroy();
        } catch (error) {
          const tokenName = getTokenName(token);
          throw new LifecycleError(
            tokenName,
            'onDestroy',
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    }

    this.singletons.clear();
  }

  /**
   * Returns whether an instance implements `onInit`.
   * @private
   */
  private hasOnInit(instance: any): instance is OnInit {
    return instance && typeof instance.onInit === 'function';
  }

  /**
   * Returns whether an instance implements `onDestroy`.
   * @private
   */
  private hasOnDestroy(instance: any): instance is OnDestroy {
    return instance && typeof instance.onDestroy === 'function';
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Removes all providers and cached singletons.
   *
   * Intended for tests that need a clean container. It does not call `onDestroy` hooks; call
   * {@link OrcherContainer.dispose} first if they must run.
   *
   * @example
   * ```typescript
   * // In test teardown
   * afterEach(() => {
   *   container.clear();
   * });
   * ```
   */
  clear(): void {
    this.singletons.clear();
    this.providers.clear();
    this.resolutionStack = [];
  }

  /**
   * Returns the number of registered providers and cached singletons.
   *
   * @returns Object with provider and singleton counts
   *
   * @example
   * ```typescript
   * const stats = container.getStats();
   * console.log(`Registered: ${stats.providers} providers, ${stats.singletons} singletons`);
   * ```
   */
  getStats(): { providers: number; singletons: number } {
    return {
      providers: this.providers.size,
      singletons: this.singletons.size,
    };
  }

  /**
   * Returns a human-readable, multi-line summary of the container state.
   *
   * @returns Formatted string with container information
   *
   * @example
   * ```typescript
   * console.log(container.getSummary());
   * // Output:
   * // OrcherContainer Summary:
   * //   Providers: 10
   * //   Cached Singletons: 8
   * //   Resolution Stack: []
   * ```
   */
  getSummary(): string {
    return `OrcherContainer Summary:
  Providers: ${this.providers.size}
  Cached Singletons: ${this.singletons.size}
  Resolution Stack: [${this.resolutionStack.map(getTokenName).join(', ')}]`;
  }
}
