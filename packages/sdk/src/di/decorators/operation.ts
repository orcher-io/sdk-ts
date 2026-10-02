/**
 * The `@Operation()` method decorator and helpers for inspecting actor operations.
 *
 * `@Operation()` marks a method as an actor operation and attaches a static
 * `OperationReference` for it to the actor class.
 *
 * @packageDocumentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
// Decorator signatures are typed with `any`.

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { OperationOptions, OperationMetadata, OperationReference, Type } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a method as an actor operation and registers it with the global registry.
 *
 * The decorator attaches a static `OperationReference` to the class, named after the
 * operation. The operation name defaults to the method name. `WithOperationRefs` types the
 * references by method name, so a `name` that differs from the method name leaves the typed
 * key and the runtime static under different names.
 *
 * Concurrency modes:
 * - `exclusive` (default): only one operation runs at a time per actor key. Use for mutations.
 * - `shared`: several operations may run at once per actor key. Use for reads.
 *
 * @param options - Operation options: `name`, `mode`, and `timeout` in milliseconds.
 * @returns A method decorator.
 * @throws DecoratorError if applied to a symbol-named property or a non-method, or if the
 *   class already has a static property with the operation name.
 *
 * @example
 * Exclusive operation (the default, for mutations):
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> {
 *     const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *     cart.items.push(item);
 *     await ctx.state.set('cart', cart);
 *     return cart;
 *   }
 * }
 *
 * // Static property: ShoppingCart.addItem
 * // Operation name: 'addItem'
 * ```
 *
 * @example
 * Shared operation (for reads):
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation({ mode: 'shared' })
 *   async getTotal(ctx: ActorContext): Promise<number> {
 *     const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *     return cart.items.reduce((sum, i) => sum + i.price, 0);
 *   }
 * }
 * ```
 *
 * @example
 * Custom operation name:
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation({ name: 'add', timeout: 5000 })
 *   async addItemImpl(ctx: ActorContext, item: CartItem): Promise<Cart> { ... }
 * }
 *
 * // Static property: ShoppingCart.add (from name)
 * // Method name: 'addItemImpl'
 * ```
 */
export function Operation(options: OperationOptions = {}): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    if (typeof propertyKey === 'symbol') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Operation',
        'symbol property',
        'Operation methods must have string names'
      );
    }

    if (!descriptor || typeof descriptor.value !== 'function') {
      throw DecoratorError.cannotApplyToNonMethod(
        '@Operation',
        typeof descriptor?.value || 'undefined',
        'Operation decorator can only be applied to methods'
      );
    }

    const actorClass = target.constructor as Type<any>;
    const methodName = propertyKey;
    const operationName = options.name || methodName;
    const mode = options.mode || 'exclusive';

    const staticPropertyName = operationName;

    // Never overwrite an existing static, such as a hand-written property or another
    // operation that resolved to the same name.
    if (Object.prototype.hasOwnProperty.call(actorClass, staticPropertyName)) {
      throw DecoratorError.staticPropertyConflict(
        '@Operation',
        actorClass.name,
        staticPropertyName,
        `Cannot create static property '${staticPropertyName}' - already exists. ` +
          `Use a different operation name or remove the existing property.`
      );
    }

    const metadata: OperationMetadata = {
      name: operationName,
      actorClass,
      methodName,
      mode,
      timeout: options.timeout,
    };

    Reflect.defineMetadata('operation', true, target, propertyKey);
    Reflect.defineMetadata('operation:metadata', metadata, target, propertyKey);
    Reflect.defineMetadata('operation:name', operationName, target, propertyKey);

    // Registered under the class name. @Actor runs after the method decorators and moves
    // the entry under the actor's public name.
    const registry = GlobalRegistry.getInstance();
    registry.registerOperation(operationName, actorClass, metadata);

    const operationReference: OperationReference<any, any> = {
      operationName,
      actorClass,
      methodName,
      mode,
    };

    Object.defineProperty(actorClass, staticPropertyName, {
      value: operationReference,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    return descriptor;
  };
}

/**
 * Returns whether a method is decorated with `@Operation()`.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns true if the method is decorated with @Operation
 */
export function isOperation(target: any, propertyKey: string): boolean {
  if (!target || typeof propertyKey !== 'string') {
    return false;
  }
  return Reflect.getMetadata('operation', target, propertyKey) === true;
}

/**
 * Returns the metadata `@Operation()` stored on a method.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns Operation metadata, or undefined if not an operation
 */
export function getOperationMetadata(
  target: any,
  propertyKey: string
): OperationMetadata | undefined {
  if (!isOperation(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('operation:metadata', target, propertyKey);
}

/**
 * Returns the operation name of a decorated method.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns Operation name, or undefined if not an operation
 */
export function getOperationName(target: any, propertyKey: string): string | undefined {
  if (!isOperation(target, propertyKey)) {
    return undefined;
  }
  return Reflect.getMetadata('operation:name', target, propertyKey);
}

/**
 * Returns whether an actor class has a static `OperationReference` under the given name.
 *
 * @param actorClass - Actor class
 * @param operationName - Operation name (static property name) to check
 * @returns true if the class has an OperationReference for that operation
 */
export function hasOperationReference(actorClass: Type<any>, operationName: string): boolean {
  if (!actorClass || typeof operationName !== 'string') {
    return false;
  }
  const ref = (actorClass as any)[operationName];
  return (
    ref !== undefined &&
    typeof ref === 'object' &&
    'operationName' in ref &&
    'actorClass' in ref &&
    'methodName' in ref &&
    'mode' in ref
  );
}

/**
 * Returns every static `OperationReference` on an actor class.
 *
 * @param actorClass - Actor class
 * @returns The operation references, in property definition order
 *
 * @example
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation()
 *   async addItem() {}
 *
 *   @Operation({ mode: 'shared' })
 *   async getTotal() {}
 * }
 *
 * const refs = getAllOperationReferences(ShoppingCart);
 * // [
 * //   { operationName: 'addItem', actorClass: ShoppingCart, methodName: 'addItem',
 * //     mode: 'exclusive' },
 * //   { operationName: 'getTotal', actorClass: ShoppingCart, methodName: 'getTotal',
 * //     mode: 'shared' }
 * // ]
 * ```
 */
export function getAllOperationReferences(actorClass: Type<any>): OperationReference<any, any>[] {
  if (!actorClass) {
    return [];
  }

  const refs: OperationReference<any, any>[] = [];
  const propertyNames = Object.getOwnPropertyNames(actorClass);

  for (const propertyName of propertyNames) {
    if (hasOperationReference(actorClass, propertyName)) {
      refs.push((actorClass as any)[propertyName]);
    }
  }

  return refs;
}
