/**
 * Typed proxy for invoking actor operations from a client.
 *
 * The proxy drops the `ctx` parameter from each operation's signature, so a
 * caller passes only the operation input.
 *
 * @packageDocumentation
 */

import type { Type } from '../di/types';

/**
 * The client-side view of an actor class, with the `ActorContext` parameter removed.
 *
 * Each method shaped `(ctx, input) => Promise<O>` or `(ctx) => Promise<O>` becomes
 * the same method without `ctx`. Other members are omitted.
 *
 * @example
 * ```typescript
 * @Actor()
 * class ShoppingCart {
 *   @Operation()
 *   async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> { ... }
 *
 *   @Operation({ mode: 'shared' })
 *   async getTotal(ctx: ActorContext): Promise<number> { ... }
 * }
 *
 * // ActorRef<ShoppingCart> produces:
 * // {
 * //   addItem(item: CartItem): Promise<Cart>,
 * //   getTotal(): Promise<number>
 * // }
 * ```
 */
export type ActorRef<T> = {
  [K in keyof T as T[K] extends (ctx: any, ...args: any[]) => Promise<any>
    ? K
    : never]: T[K] extends (ctx: any, ...args: infer A) => Promise<infer O>
    ? ActorOperation<A, O>
    : never;
};

/**
 * One operation as the client calls it, from the parameters that follow `ctx`.
 *
 * The parameter list is matched as a tuple rather than with
 * `(ctx, input: infer I) => ...`: a `(ctx) => ...` method is assignable to that
 * shape too, with `I` inferred as `unknown`, which would demand an argument the
 * operation does not take. `[]` gives `() => Promise<O>`, `[I]` and `[I?]` keep
 * the input as declared, and anything longer is not callable through the proxy,
 * which sends one payload.
 */
type ActorOperation<A extends any[], O> = A extends [unknown?]
  ? (...args: A) => Promise<O>
  : never;

/**
 * Sends an actor operation to the server. `Client` implements it.
 */
export interface ActorInvoker {
  invokeActor(
    actorName: string,
    key: string,
    operation: string,
    payload?: any
  ): Promise<any>;
}

/**
 * Create a typed actor proxy.
 *
 * Each method call on the proxy becomes an `invoker.invokeActor()` call with
 * the first argument as the payload.
 *
 * @param actorClass - The actor class, used to resolve static `OperationReference` properties
 * @param actorName - The actor type name
 * @param key - The actor instance key
 * @param invoker - The invocation mechanism (Client)
 * @returns A typed proxy with operation methods
 *
 * @example
 * ```typescript
 * const cart = createActorProxy(ShoppingCart, 'ShoppingCart', 'user-123', client);
 * const result = await cart.addItem({ name: 'book', price: 10 });
 * // result is typed as Cart
 * ```
 */
export function createActorProxy<T>(
  actorClass: Type<T>,
  actorName: string,
  key: string,
  invoker: ActorInvoker
): ActorRef<T> {
  return new Proxy({} as ActorRef<T>, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined;
      }

      return async (...args: any[]) => {
        // A static OperationReference on the class carries the registered
        // operation name, which may differ from the method name.
        const ref = (actorClass as any)[prop];
        const operationName = ref?.operationName ?? prop;
        const payload = args.length > 0 ? args[0] : undefined;
        return invoker.invokeActor(actorName, key, operationName, payload);
      };
    },
  });
}
