/**
 * The `@Query()` method decorator and helpers for inspecting query handlers.
 *
 * A query lets a client read a value from a running workflow without affecting its execution.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { QueryOptions, QueryMetadata, QueryReference, Type } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a method as a query handler and registers it with the global registry.
 *
 * The query name defaults to the method name. The decorator attaches a static
 * `QueryReference` to the class under the query name. `WithQueryRefs` types the references by
 * method name, so a `name` that differs from the method name leaves the typed key and the
 * runtime static under different names.
 *
 * Query handlers:
 * - are synchronous
 * - take no arguments
 * - return the value sent back to the calling client
 * - must not mutate state or cause side effects
 *
 * See `@Queries()` for how the worker resolves the handler class.
 *
 * @param options - Query options: `name`, `cacheTtl` in milliseconds, and `description`.
 * @returns A method decorator.
 * @throws DecoratorError if applied to a symbol-named property or a non-method, or if the
 *   class already has a static property with the query name.
 *
 * @example
 * ```typescript
 * @Queries()
 * export class OrderQueries {
 *   @Query({ name: 'get_status' })
 *   getStatus(): string {
 *     return this.status;
 *   }
 * }
 *
 * // From a client, with a WorkflowHandle:
 * const status = await handle.query<string>('get_status');
 * ```
 */
export function Query(options: QueryOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (typeof propertyKey === 'symbol') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Query',
        'symbol property',
        'Query methods must have string names'
      );
    }

    if (!descriptor || typeof descriptor.value !== 'function') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Query',
        typeof descriptor?.value || 'undefined',
        'Query decorator can only be applied to methods'
      );
    }

    const handlerClass = target.constructor as Type<any>;
    const methodName = propertyKey;
    const queryName = options.name || methodName;

    const staticPropertyName = queryName;

    // Never overwrite an existing static, such as a hand-written property or another query
    // that resolved to the same name.
    if (Object.prototype.hasOwnProperty.call(handlerClass, staticPropertyName)) {
      throw DecoratorError.staticPropertyConflict(
        '@Query',
        handlerClass.name,
        staticPropertyName,
        `Cannot create static property '${staticPropertyName}' - already exists. ` +
          `Use a different query name or rename the existing property.`
      );
    }

    const metadata: QueryMetadata = {
      name: queryName,
      handlerClass,
      methodName,
      cacheTtl: options.cacheTtl,
      description: options.description,
    };

    Reflect.defineMetadata('query', true, target, propertyKey);
    Reflect.defineMetadata('query:metadata', metadata, target, propertyKey);
    Reflect.defineMetadata('query:name', queryName, target, propertyKey);

    const registry = GlobalRegistry.getInstance();
    registry.registerQuery(queryName, metadata);

    const queryReference: QueryReference<any> = {
      queryName,
      handlerClass,
      methodName,
    };

    Object.defineProperty(handlerClass, staticPropertyName, {
      value: queryReference,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    return descriptor;
  };
}

/**
 * Returns whether a method is decorated with `@Query()`.
 */
export function isQuery(target: any, propertyKey: string): boolean {
  if (!target || typeof propertyKey !== 'string') {
    return false;
  }
  return Reflect.getMetadata('query', target, propertyKey) === true;
}

/**
 * Returns the metadata `@Query()` stored on a method.
 */
export function getQueryMetadata(target: any, propertyKey: string): QueryMetadata | undefined {
  if (!isQuery(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('query:metadata', target, propertyKey);
}

/**
 * Returns the query name of a decorated method.
 */
export function getQueryName(target: any, propertyKey: string): string | undefined {
  if (!isQuery(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('query:name', target, propertyKey);
}

/**
 * Returns whether a class has a static `QueryReference` under the given name.
 */
export function hasQueryReference(handlerClass: Type<any>, queryName: string): boolean {
  if (!handlerClass || typeof queryName !== 'string') {
    return false;
  }
  const ref = (handlerClass as any)[queryName];
  return (
    ref !== undefined &&
    typeof ref === 'object' &&
    'queryName' in ref &&
    'handlerClass' in ref &&
    'methodName' in ref
  );
}

/**
 * Returns every static `QueryReference` on a query handler class.
 */
export function getAllQueryReferences(handlerClass: Type<any>): QueryReference<any>[] {
  if (!handlerClass) {
    return [];
  }

  const refs: QueryReference<any>[] = [];
  const propertyNames = Object.getOwnPropertyNames(handlerClass);

  for (const propertyName of propertyNames) {
    const ref = (handlerClass as any)[propertyName];
    if (
      ref &&
      typeof ref === 'object' &&
      'queryName' in ref &&
      'handlerClass' in ref &&
      'methodName' in ref
    ) {
      refs.push(ref);
    }
  }

  return refs;
}
