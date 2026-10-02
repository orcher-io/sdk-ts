/**
 * Tests for createActorProxy and ActorRef
 * @packageDocumentation
 */

import 'reflect-metadata';
import { createActorProxy } from '../actor-ref';
import type { ActorInvoker } from '../actor-ref';
import { Actor } from '../../di/decorators/actor';
import { Operation } from '../../di/decorators/operation';
import { GlobalRegistry } from '../../di/registry';

describe('createActorProxy', () => {
  let mockInvoker: ActorInvoker;
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
    mockInvoker = {
      invokeActor: jest.fn().mockResolvedValue({ success: true }),
    };
  });

  afterEach(() => {
    registry.clear();
  });

  // =========================================================================
  // Method Invocation
  // =========================================================================

  describe('Method Invocation', () => {
    it('should route method calls to invoker.invokeActor', async () => {
      class TestActor {
        async process() {}
      }

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      await (proxy as any).process();

      expect(mockInvoker.invokeActor).toHaveBeenCalled();
    });

    it('should pass correct actorName and key', async () => {
      class TestActor {
        async process() {}
      }

      const proxy = createActorProxy(TestActor, 'MyActor', 'user-123', mockInvoker);
      await (proxy as any).process();

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'MyActor',
        'user-123',
        expect.any(String),
        undefined
      );
    });

    it('should pass first argument as payload', async () => {
      class TestActor {
        async addItem(_ctx: any, _item: any) {}
      }

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      const payload = { name: 'book', price: 10 };
      await (proxy as any).addItem(payload);

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'TestActor',
        'key-1',
        'addItem',
        payload
      );
    });

    it('should pass undefined when no arguments', async () => {
      class TestActor {
        async getTotal() {}
      }

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      await (proxy as any).getTotal();

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'TestActor',
        'key-1',
        'getTotal',
        undefined
      );
    });

    it('should return result from invoker', async () => {
      class TestActor {
        async getTotal() {}
      }

      (mockInvoker.invokeActor as jest.Mock).mockResolvedValue(42);

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      const result = await (proxy as any).getTotal();

      expect(result).toBe(42);
    });
  });

  // =========================================================================
  // Operation Name Resolution
  // =========================================================================

  describe('Operation Name Resolution', () => {
    it('should use static OperationReference.operationName when present', async () => {
      @Actor()
      class CartActor {
        @Operation({ name: 'add-to-cart' })
        async addItem() {}
      }

      const proxy = createActorProxy(CartActor, 'CartActor', 'key-1', mockInvoker);
      await (proxy as any)['add-to-cart']();

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'CartActor',
        'key-1',
        'add-to-cart',
        undefined
      );
    });

    it('should fall back to property name when no static reference', async () => {
      class PlainActor {
        async doWork() {}
      }

      const proxy = createActorProxy(PlainActor, 'PlainActor', 'key-1', mockInvoker);
      await (proxy as any).doWork();

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'PlainActor',
        'key-1',
        'doWork',
        undefined
      );
    });

    it('should handle custom operation names', async () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'custom-name' })
        async internalMethod() {}
      }

      const proxy = createActorProxy(MyActor, 'MyActor', 'key-1', mockInvoker);
      // Access via the static property name (which is the operationName)
      await (proxy as any)['custom-name']();

      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'MyActor',
        'key-1',
        'custom-name',
        undefined
      );
    });
  });

  // =========================================================================
  // Multiple Operations
  // =========================================================================

  describe('Multiple Operations', () => {
    it('should support calling different operations on same proxy', async () => {
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem() {}

        @Operation()
        async removeItem() {}
      }

      const proxy = createActorProxy(ShoppingCart, 'ShoppingCart', 'key-1', mockInvoker);

      await (proxy as any).addItem({ name: 'book' });
      await (proxy as any).removeItem({ id: 1 });

      expect(mockInvoker.invokeActor).toHaveBeenCalledTimes(2);
    });

    it('should pass correct operation name for each call', async () => {
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem() {}

        @Operation({ mode: 'shared' })
        async getTotal() {}
      }

      const proxy = createActorProxy(ShoppingCart, 'ShoppingCart', 'key-1', mockInvoker);

      await (proxy as any).addItem({ name: 'pen' });
      await (proxy as any).getTotal();

      expect(mockInvoker.invokeActor).toHaveBeenNthCalledWith(
        1,
        'ShoppingCart',
        'key-1',
        'addItem',
        { name: 'pen' }
      );
      expect(mockInvoker.invokeActor).toHaveBeenNthCalledWith(
        2,
        'ShoppingCart',
        'key-1',
        'getTotal',
        undefined
      );
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe('Edge Cases', () => {
    it('should return undefined for symbol properties', () => {
      class TestActor {}

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      const sym = Symbol('test');
      expect((proxy as any)[sym]).toBeUndefined();
    });

    it('should handle async correctly (returns Promise)', async () => {
      class TestActor {
        async process() {}
      }

      (mockInvoker.invokeActor as jest.Mock).mockResolvedValue('async-result');

      const proxy = createActorProxy(TestActor, 'TestActor', 'key-1', mockInvoker);
      const resultPromise = (proxy as any).process();

      expect(resultPromise).toBeInstanceOf(Promise);
      expect(await resultPromise).toBe('async-result');
    });

    it('should work with @Actor + @Operation decorated classes', async () => {
      @Actor()
      class FullActor {
        @Operation()
        async addItem() {}

        @Operation({ mode: 'shared' })
        async getTotal() {}
      }

      (mockInvoker.invokeActor as jest.Mock).mockResolvedValue({ items: [], total: 0 });

      const proxy = createActorProxy(FullActor, 'FullActor', 'user-1', mockInvoker);
      const result = await (proxy as any).addItem({ name: 'book' });

      expect(result).toEqual({ items: [], total: 0 });
      expect(mockInvoker.invokeActor).toHaveBeenCalledWith(
        'FullActor',
        'user-1',
        'addItem',
        { name: 'book' }
      );
    });
  });
});
