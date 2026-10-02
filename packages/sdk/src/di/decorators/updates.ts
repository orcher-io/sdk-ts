/**
 * The `@Updates()` class decorator and helpers for inspecting update handler classes.
 *
 * An `@Updates()` class groups methods decorated with `@Update()`.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { UpdateHandlerMetadata, UpdatesOptions, Type, WithUpdateRefs } from '../types';

/**
 * Marks a class as a container of `@Update()` handlers and registers it with the global
 * registry.
 *
 * To apply an update, the worker resolves the handler class from its dependency container and
 * calls the `@Update()` method; the worker registers every `@Updates()` class in the container
 * as it starts. See `@Update()` for the arguments the method receives.
 *
 * @param _options - Accepts no options.
 * @returns A class decorator.
 * @throws Error if applied to something other than a class.
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
 *
 *   @Update({ name: 'cancel_order' })
 *   async cancelOrder(ctx: WorkflowContext, input: CancelInput): Promise<CancelResult> {
 *     // ...
 *   }
 * }
 * ```
 */
export function Updates<T extends abstract new (...args: any) => any>(
  _options: UpdatesOptions = {}
): (target: T) => WithUpdateRefs<T> {
  return function (target: T): WithUpdateRefs<T> {
    if (typeof target !== 'function') {
      throw new Error('@Updates() decorator can only be applied to a class');
    }

    const metadata: UpdateHandlerMetadata = {
      token: target as unknown as Type<any>,
      registered: true,
    };

    Reflect.defineMetadata('updates', true, target);
    Reflect.defineMetadata('updates:handler', true, target);
    Reflect.defineMetadata('updates:metadata', metadata, target);

    GlobalRegistry.getInstance().registerUpdateHandler(
      target as unknown as Type<any>,
      metadata
    );

    Reflect.defineMetadata('di:updates-decorated', true, target);

    return target as WithUpdateRefs<T>;
  };
}

/**
 * Returns whether a class is decorated with `@Updates()`.
 */
export function isUpdates(target: any): boolean {
  return Reflect.getMetadata('updates', target) === true;
}

/**
 * Returns whether a class is marked as an update handler by `@Updates()`.
 */
export function isUpdateHandler(target: any): boolean {
  return Reflect.getMetadata('updates:handler', target) === true;
}

/**
 * Returns the metadata `@Updates()` stored on a class.
 */
export function getUpdateHandlerMetadata(target: any): UpdateHandlerMetadata | undefined {
  if (!isUpdates(target)) {
    return undefined;
  }
  return Reflect.getMetadata('updates:metadata', target);
}

/**
 * Returns the names of the methods decorated with `@Update()` on a class.
 *
 * Accepts either the class or its prototype.
 */
export function getUpdateMethods(target: any): string[] {
  const methods: string[] = [];
  const prototype = target.prototype || target;

  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;
    if (Reflect.getMetadata('update', prototype, key) === true) {
      methods.push(key);
    }
  }

  return methods;
}
