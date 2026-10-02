/**
 * The `@Queries()` class decorator and helpers for inspecting query handler classes.
 *
 * A `@Queries()` class groups methods decorated with `@Query()`.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { QueryHandlerMetadata, QueriesOptions, Type, WithQueryRefs } from '../types';

/**
 * Marks a class as a container of `@Query()` handlers and registers it with the global registry.
 *
 * To answer a query, the worker resolves the handler class from its dependency container and
 * calls the `@Query()` method with no arguments; the worker registers every `@Queries()` class
 * in the container as it starts. The method reads the handler instance, not the workflow's state. To
 * answer from a running workflow's state, register a handler with
 * `ctx.registerQueryHandler()` inside the workflow instead.
 *
 * @param _options - Accepts no options.
 * @returns A class decorator.
 * @throws Error if applied to something other than a class.
 *
 * @example
 * ```typescript
 * @Queries()
 * export class OrderQueries {
 *   @Query({ name: 'get_status' })
 *   getStatus(): string {
 *     return this.status;
 *   }
 *
 *   @Query({ name: 'get_progress' })
 *   getProgress(): { done: number; total: number } {
 *     return { done: this.itemsProcessed, total: this.totalItems };
 *   }
 * }
 * ```
 */
export function Queries<T extends abstract new (...args: any) => any>(
  _options: QueriesOptions = {}
): (target: T) => WithQueryRefs<T> {
  return function (target: T): WithQueryRefs<T> {
    if (typeof target !== 'function') {
      throw new Error('@Queries() decorator can only be applied to a class');
    }

    const metadata: QueryHandlerMetadata = {
      token: target as unknown as Type<any>,
      registered: true,
    };

    Reflect.defineMetadata('queries', true, target);
    Reflect.defineMetadata('queries:handler', true, target);
    Reflect.defineMetadata('queries:metadata', metadata, target);

    GlobalRegistry.getInstance().registerQueryHandler(
      target as unknown as Type<any>,
      metadata
    );

    Reflect.defineMetadata('di:queries-decorated', true, target);

    return target as WithQueryRefs<T>;
  };
}

/**
 * Returns whether a class is decorated with `@Queries()`.
 */
export function isQueries(target: any): boolean {
  return Reflect.getMetadata('queries', target) === true;
}

/**
 * Returns whether a class is marked as a query handler by `@Queries()`.
 */
export function isQueryHandler(target: any): boolean {
  return Reflect.getMetadata('queries:handler', target) === true;
}

/**
 * Returns the metadata `@Queries()` stored on a class.
 */
export function getQueryHandlerMetadata(target: any): QueryHandlerMetadata | undefined {
  if (!isQueries(target)) {
    return undefined;
  }
  return Reflect.getMetadata('queries:metadata', target);
}

/**
 * Returns the names of the methods decorated with `@Query()` on a class.
 *
 * Accepts either the class or its prototype.
 */
export function getQueryMethods(target: any): string[] {
  const methods: string[] = [];
  const prototype = target.prototype || target;

  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;
    if (Reflect.getMetadata('query', prototype, key) === true) {
      methods.push(key);
    }
  }

  return methods;
}
