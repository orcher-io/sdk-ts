/**
 * The `@Update()` method decorator and helpers for inspecting update handlers.
 *
 * An update lets a client send a change to a running workflow and wait for the handler's
 * result.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { UpdateOptions, UpdateMetadata, UpdateReference, Type } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a method as an update handler and registers it with the global registry.
 *
 * The update name defaults to the method name. The decorator attaches a static
 * `UpdateReference` to the class under the update name. `WithUpdateRefs` types the references
 * by method name and expects the signature `(ctx, input) => Promise<output>`, so a `name` that
 * differs from the method name leaves the typed key and the runtime static under different
 * names.
 *
 * The handler's resolved value is sent back to the calling client. See `@Updates()` for how the
 * worker resolves the handler class.
 *
 * The worker calls the method with the context of the workflow activation that carries the
 * update and the argument the client sent, decoded from JSON (`undefined` when it sent none).
 *
 * @param options - Update options: `name`, `timeout` in milliseconds, and `description`.
 * @returns A method decorator.
 * @throws DecoratorError if applied to a symbol-named property or a non-method, or if the
 *   class already has a static property with the update name.
 *
 * @example
 * ```typescript
 * @Updates()
 * export class OrderUpdates {
 *   @Update({ name: 'change_address' })
 *   async changeAddress(
 *     ctx: WorkflowContext,
 *     input: ChangeAddressInput
 *   ): Promise<ChangeAddressResult> {
 *     // ...
 *   }
 * }
 *
 * // From a client, with a WorkflowHandle:
 * const result = await handle.update<ChangeAddressResult>('change_address', input);
 * ```
 */
export function Update(options: UpdateOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (typeof propertyKey === 'symbol') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Update',
        'symbol property',
        'Update methods must have string names'
      );
    }

    if (!descriptor || typeof descriptor.value !== 'function') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Update',
        typeof descriptor?.value || 'undefined',
        'Update decorator can only be applied to methods'
      );
    }

    const handlerClass = target.constructor as Type<any>;
    const methodName = propertyKey;
    const updateName = options.name || methodName;

    const staticPropertyName = updateName;

    // Never overwrite an existing static, such as a hand-written property or another update
    // that resolved to the same name.
    if (Object.prototype.hasOwnProperty.call(handlerClass, staticPropertyName)) {
      throw DecoratorError.staticPropertyConflict(
        '@Update',
        handlerClass.name,
        staticPropertyName,
        `Cannot create static property '${staticPropertyName}' - already exists. ` +
          `Use a different update name or rename the existing property.`
      );
    }

    const metadata: UpdateMetadata = {
      name: updateName,
      handlerClass,
      methodName,
      timeout: options.timeout,
      description: options.description,
    };

    Reflect.defineMetadata('update', true, target, propertyKey);
    Reflect.defineMetadata('update:metadata', metadata, target, propertyKey);
    Reflect.defineMetadata('update:name', updateName, target, propertyKey);

    const registry = GlobalRegistry.getInstance();
    registry.registerUpdate(updateName, metadata);

    const updateReference: UpdateReference<any, any> = {
      updateName,
      handlerClass,
      methodName,
    };

    Object.defineProperty(handlerClass, staticPropertyName, {
      value: updateReference,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    return descriptor;
  };
}

/**
 * Returns whether a method is decorated with `@Update()`.
 */
export function isUpdate(target: any, propertyKey: string): boolean {
  if (!target || typeof propertyKey !== 'string') {
    return false;
  }
  return Reflect.getMetadata('update', target, propertyKey) === true;
}

/**
 * Returns the metadata `@Update()` stored on a method.
 */
export function getUpdateMetadata(target: any, propertyKey: string): UpdateMetadata | undefined {
  if (!isUpdate(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('update:metadata', target, propertyKey);
}

/**
 * Returns the update name of a decorated method.
 */
export function getUpdateName(target: any, propertyKey: string): string | undefined {
  if (!isUpdate(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('update:name', target, propertyKey);
}

/**
 * Returns whether a class has a static `UpdateReference` under the given name.
 */
export function hasUpdateReference(handlerClass: Type<any>, updateName: string): boolean {
  if (!handlerClass || typeof updateName !== 'string') {
    return false;
  }
  const ref = (handlerClass as any)[updateName];
  return (
    ref !== undefined &&
    typeof ref === 'object' &&
    'updateName' in ref &&
    'handlerClass' in ref &&
    'methodName' in ref
  );
}

/**
 * Returns every static `UpdateReference` on an update handler class.
 */
export function getAllUpdateReferences(handlerClass: Type<any>): UpdateReference<any, any>[] {
  if (!handlerClass) {
    return [];
  }

  const refs: UpdateReference<any, any>[] = [];
  const propertyNames = Object.getOwnPropertyNames(handlerClass);

  for (const propertyName of propertyNames) {
    const ref = (handlerClass as any)[propertyName];
    if (
      ref &&
      typeof ref === 'object' &&
      'updateName' in ref &&
      'handlerClass' in ref &&
      'methodName' in ref
    ) {
      refs.push(ref);
    }
  }

  return refs;
}
