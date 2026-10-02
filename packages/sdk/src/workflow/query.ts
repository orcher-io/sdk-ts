/**
 * Query handling for workflows.
 *
 * Queries are read-only calls that inspect a running workflow's state without
 * modifying it. This module holds the handler registry, result types, and name
 * validation.
 *
 * @packageDocumentation
 */

import { hasValidNameCharacters, NAME_RULE } from '../core/names';

/**
 * Signature of a query handler.
 *
 * Handlers are synchronous and return workflow state. They must not modify
 * state or perform side effects.
 */
export type QueryHandler<T = any> = () => T;

/**
 * Options for registering and executing a query.
 *
 * {@link QueryManager.registerHandler} ignores these options. Only `cacheTtl`,
 * passed to {@link QueryManager.executeQuery}, has an effect.
 */
export interface QueryOptions {
  /** Query name */
  name?: string;

  /** Query timeout in milliseconds */
  timeout?: number;

  /** Cache TTL in milliseconds (0 = no cache) */
  cacheTtl?: number;

  /** Description of what the query returns */
  description?: string;
}

/**
 * The value a query returned, with metadata.
 */
export interface QueryResult<T = any> {
  /** Query name */
  name: string;

  /** Query result value */
  value: T;

  /** Whether the value came from the cache */
  cached?: boolean;

  /** Wall-clock time (ms since epoch) when the result was produced */
  timestamp: number;
}

/**
 * Raised when a query name is invalid, its handler is missing, or the handler
 * throws.
 */
export class QueryError extends Error {
  constructor(
    message: string,
    public readonly queryName: string,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

/**
 * Registry of a workflow's query handlers, with optional result caching.
 */
export class QueryManager {
  private handlers: Map<string, QueryHandler> = new Map();
  private cache: Map<string, { value: any; expiry: number }> = new Map();

  /**
   * Registers a handler, replacing any handler already registered under `name`
   *
   * @param name - Query name
   * @param handler - Query handler function
   * @param _options - Ignored
   * @throws {QueryError} If the name is empty or the handler is not a function
   */
  registerHandler<T>(name: string, handler: QueryHandler<T>, _options?: QueryOptions): void {
    if (!name || name.trim().length === 0) {
      throw new QueryError('Query name must be a non-empty string', name);
    }

    if (typeof handler !== 'function') {
      throw new QueryError('Query handler must be a function', name);
    }

    this.handlers.set(name, handler);
  }

  /**
   * Runs the handler registered under `name`
   *
   * With a positive `options.cacheTtl`, a result cached within that many
   * milliseconds is returned instead of calling the handler, and a fresh result
   * is cached for that long.
   *
   * @param name - Query name
   * @param options - Query options
   * @returns Query result
   * @throws {QueryError} If no handler is registered or the handler throws
   */
  executeQuery<T>(name: string, options?: QueryOptions): QueryResult<T> {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new QueryError(`Query handler not found: ${name}`, name);
    }

    if (options?.cacheTtl && options.cacheTtl > 0) {
      const cached = this.cache.get(name);
      if (cached && Date.now() < cached.expiry) {
        return {
          name,
          value: cached.value,
          cached: true,
          timestamp: Date.now(),
        };
      }
    }

    try {
      const value = handler();

      if (options?.cacheTtl && options.cacheTtl > 0) {
        this.cache.set(name, {
          value,
          expiry: Date.now() + options.cacheTtl,
        });
      }

      return {
        name,
        value,
        cached: false,
        timestamp: Date.now(),
      };
    } catch (err) {
      throw new QueryError(
        `Query execution failed: ${err instanceof Error ? err.message : String(err)}`,
        name,
        err instanceof Error ? err : undefined
      );
    }
  }

  /**
   * Returns whether a handler is registered under `name`
   *
   * @param name - Query name
   * @returns True if handler exists
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Returns all registered query names
   *
   * @returns Array of query names
   */
  getQueryNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clears cached results for one query, or for all queries
   *
   * @param name - Query name; omit to clear every cached result
   */
  clearCache(name?: string): void {
    if (name) {
      this.cache.delete(name);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Returns the handler count, cache size, and registered query names
   */
  getStats(): {
    handlerCount: number;
    cacheSize: number;
    queryNames: string[];
  } {
    return {
      handlerCount: this.handlers.size,
      cacheSize: this.cache.size,
      queryNames: this.getQueryNames(),
    };
  }

  /**
   * Removes all handlers and cached results. For tests.
   */
  clear(): void {
    this.handlers.clear();
    this.cache.clear();
  }
}

/**
 * Helpers for query names and results.
 */
export class QueryHelpers {
  /**
   * Validates a query name
   *
   * @param name - Query name to validate
   * @throws {QueryError} If the name is empty, longer than 255 characters, or
   *   contains characters outside the allowed set
   */
  static validateQueryName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new QueryError('Query name must be a non-empty string', name);
    }

    if (name.length > 255) {
      throw new QueryError('Query name must not exceed 255 characters', name);
    }

    if (!hasValidNameCharacters(name)) {
      throw new QueryError(
        `Query name must contain only ${NAME_RULE}`,
        name
      );
    }
  }

  /**
   * Builds a query result stamped with the current wall-clock time
   *
   * @param name - Query name
   * @param value - Query result value
   * @param cached - Whether from cache
   * @returns Query result
   */
  static createResult<T>(name: string, value: T, cached: boolean = false): QueryResult<T> {
    return {
      name,
      value,
      cached,
      timestamp: Date.now(),
    };
  }

  /**
   * Serializes a query result to JSON
   *
   * @param result - Query result to serialize
   * @returns Serialized result
   */
  static serialize(result: QueryResult): string {
    return JSON.stringify({
      name: result.name,
      value: result.value,
      cached: result.cached,
      timestamp: result.timestamp,
    });
  }

  /**
   * Parses a query result serialized by {@link QueryHelpers.serialize}
   *
   * @param serialized - Serialized query result
   * @returns Query result
   */
  static deserialize<T>(serialized: string): QueryResult<T> {
    const parsed = JSON.parse(serialized);
    return {
      name: parsed.name,
      value: parsed.value as T,
      cached: parsed.cached,
      timestamp: parsed.timestamp,
    };
  }
}
