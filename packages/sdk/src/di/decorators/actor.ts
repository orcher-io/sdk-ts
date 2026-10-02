/**
 * The `@Actor()` class decorator and helpers for inspecting actor classes.
 *
 * An actor class groups methods decorated with `@Operation()`. Each operation runs against the
 * actor's state.
 *
 * `@Operation` attaches a static OperationReference for each operation at runtime.
 * Cast the class to `WithOperationRefs<typeof Class>` to reach them with full typing.
 * TypeScript cannot see them on the class itself, because a class decorator's return type
 * does not change the class's type.
 *
 * @packageDocumentation
 */

import 'reflect-metadata';
import { GlobalRegistry } from '../registry';
import type { ActorOptions, Type, ActorMetadata, WithOperationRefs } from '../types';
import { DecoratorError } from '../errors';

/**
 * Marks a class as an actor and registers it with the global registry.
 *
 * Decorate the class's operation methods with `@Operation()`. The actor name defaults to the
 * class name. The worker creates a new instance for each operation, since actor state lives on
 * the server, and injects its constructor dependencies from the container.
 *
 * @param options - Actor options. `name` overrides the actor type name.
 * @returns A class decorator.
 * @throws DecoratorError if applied to something other than a class.
 *
 * @example
 * Basic usage:
 * ```typescript
 * @Actor()
 * export class ShoppingCart {
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> { ... }
 *
 *   @Operation({ mode: 'shared' })
 *   async getTotal(ctx: ActorContext): Promise<number> { ... }
 * }
 *
 * // Cast to reach the generated references with types intact:
 * const CartActor = ShoppingCart as WithOperationRefs<typeof ShoppingCart>;
 * CartActor.addItem // OperationReference<CartItem, Cart>
 * ```
 *
 * @example
 * With dependency injection:
 * ```typescript
 * @Injectable()
 * @Actor()
 * export class ShoppingCart {
 *   constructor(private db: DatabaseService) {}
 *
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> {
 *     await this.db.save(item);
 *     // ...
 *   }
 * }
 * ```
 *
 * @example
 * Custom actor name:
 * ```typescript
 * @Actor({ name: 'shopping-cart' })
 * export class ShoppingCartActor {
 *   // Actor type name is 'shopping-cart', not 'ShoppingCartActor'
 * }
 * ```
 */
export function Actor<T extends abstract new (...args: any) => any>(
  options: ActorOptions = {}
): (target: T) => WithOperationRefs<T> {
  return function (target: T): WithOperationRefs<T> {
    if (typeof target !== 'function') {
      throw DecoratorError.cannotApplyToNonClass('@Actor', typeof target);
    }

    const actorName = options.name || (target as unknown as { name: string }).name;

    const metadata: ActorMetadata = {
      name: actorName,
      actorClass: target as unknown as Type<any>,
    };

    Reflect.defineMetadata('actor', true, target);
    Reflect.defineMetadata('actor:metadata', metadata, target);
    Reflect.defineMetadata('actor:name', actorName, target);

    const registry = GlobalRegistry.getInstance();
    registry.registerActor(actorName, metadata);

    // Method decorators run before the class decorator, so the operations were registered
    // under the class identifier. Move them under the actor's public name.
    registry.rekeyActorOperations(target as unknown as Type<any>, actorName);

    Reflect.defineMetadata('di:actor-decorated', true, target);

    // The static operation references were attached by @Operation; this only widens the type.
    return target as WithOperationRefs<T>;
  };
}

/**
 * Returns whether a class is decorated with `@Actor()`.
 *
 * @param target - Class to check
 * @returns true if the class is decorated with @Actor
 *
 * @example
 * ```typescript
 * @Actor()
 * class MyActor {}
 *
 * isActor(MyActor); // true
 * isActor(class Other {}); // false
 * ```
 */
export function isActor(target: any): boolean {
  if (!target || typeof target !== 'function') {
    return false;
  }
  return Reflect.getMetadata('actor', target) === true;
}

/**
 * Returns the metadata `@Actor()` stored on a class.
 *
 * @param target - Class to get metadata from
 * @returns Actor metadata, or undefined if not decorated
 *
 * @example
 * ```typescript
 * @Actor()
 * class MyActor {}
 *
 * const metadata = getActorMetadata(MyActor);
 * console.log(metadata.name); // 'MyActor'
 * console.log(metadata.actorClass); // MyActor
 * ```
 */
export function getActorMetadata(target: any): ActorMetadata | undefined {
  if (!isActor(target)) {
    return undefined;
  }
  return Reflect.getMetadata('actor:metadata', target);
}

/**
 * Returns the actor type name of a decorated class.
 *
 * @param target - Class to get name from
 * @returns Actor name, or undefined if not decorated
 *
 * @example
 * ```typescript
 * @Actor({ name: 'shopping-cart' })
 * class ShoppingCartActor {}
 *
 * getActorName(ShoppingCartActor); // 'shopping-cart'
 * ```
 */
export function getActorName(target: any): string | undefined {
  if (!isActor(target)) {
    return undefined;
  }
  return Reflect.getMetadata('actor:name', target);
}

/**
 * Returns the names of the methods decorated with `@Operation()` on an actor class.
 *
 * Only the class's own prototype is inspected; inherited methods are not included.
 *
 * @param target - Actor class to inspect
 * @returns Array of method names that are operations
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
 * getOperationMethods(ShoppingCart); // ['addItem', 'getTotal']
 * ```
 */
export function getOperationMethods(target: any): string[] {
  if (!isActor(target)) {
    return [];
  }

  const prototype = target.prototype;
  if (!prototype) {
    return [];
  }

  const operationMethods: string[] = [];
  const propertyNames = Object.getOwnPropertyNames(prototype);

  for (const propertyName of propertyNames) {
    if (propertyName === 'constructor') {
      continue;
    }

    const isOperation = Reflect.getMetadata('operation', prototype, propertyName);
    if (isOperation) {
      operationMethods.push(propertyName);
    }
  }

  return operationMethods;
}
