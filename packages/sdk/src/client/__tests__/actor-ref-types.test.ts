/**
 * Type-level tests for `ActorRef`.
 *
 * jest strips types (ts-jest runs with `isolatedModules`), so the assertions
 * that matter here are checked by `npm run type-check:tests`, which compiles
 * this file: a `@ts-expect-error` that no longer has an error to expect, or a
 * call the type rejects, fails that step. The runtime test only proves the
 * proxy sends what the types promise.
 */

import type { ActorRef } from '../actor-ref';
import { createActorProxy } from '../actor-ref';
import type { ActorInvoker } from '../actor-ref';

interface CartItem {
  name: string;
  price: number;
}

class ShoppingCart {
  async addItem(_ctx: unknown, item: CartItem): Promise<CartItem[]> {
    return [item];
  }

  async getTotal(_ctx: unknown): Promise<number> {
    return 0;
  }

  async note(_ctx: unknown, text?: string): Promise<string> {
    return text ?? '';
  }

  // Not reachable through the proxy, which sends one payload.
  async twoInputs(_ctx: unknown, _a: string, _b: string): Promise<void> {}

  // Not an operation: no promise.
  label(): string {
    return 'cart';
  }
}

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(_proof?: T): void => {};

type Ref = ActorRef<ShoppingCart>;

// The shapes the docs promise.
assertType<Equals<Ref['getTotal'], () => Promise<number>>>();
assertType<Equals<Ref['addItem'], (item: CartItem) => Promise<CartItem[]>>>();
assertType<Equals<Ref['note'], (text?: string) => Promise<string>>>();
assertType<Equals<Ref['twoInputs'], never>>();
assertType<Equals<'label' extends keyof Ref ? true : false, false>>();

// Calls as a caller writes them. Never run: only compiled.
export async function typeChecks(ref: Ref): Promise<void> {
  const total: number = await ref.getTotal();
  const items: CartItem[] = await ref.addItem({ name: 'book', price: 10 });
  await ref.note();
  await ref.note('gift');

  // @ts-expect-error getTotal takes no input
  await ref.getTotal(1);
  // @ts-expect-error addItem needs its input
  await ref.addItem();
  // @ts-expect-error the input is typed
  await ref.addItem('book');

  void total;
  void items;
}

describe('ActorRef zero-argument operations', () => {
  it('invoke with no payload', async () => {
    const invoker: ActorInvoker = { invokeActor: jest.fn().mockResolvedValue(42) };
    const cart = createActorProxy(ShoppingCart, 'ShoppingCart', 'user-1', invoker);

    await expect(cart.getTotal()).resolves.toBe(42);
    expect(invoker.invokeActor).toHaveBeenCalledWith(
      'ShoppingCart',
      'user-1',
      'getTotal',
      undefined
    );
  });
});
