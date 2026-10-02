/**
 * Tests for @Actor() Decorator
 * @packageDocumentation
 */

import 'reflect-metadata';
import {
  Actor,
  isActor,
  getActorMetadata,
  getActorName,
  getOperationMethods,
} from '../decorators/actor';
import { Operation } from '../decorators/operation';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';

describe('@Actor() Decorator', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Functionality', () => {
    it('should mark a class as an actor', () => {
      @Actor()
      class MyActor {}

      expect(isActor(MyActor)).toBe(true);
    });

    it('should use class name as default actor name', () => {
      @Actor()
      class ShoppingCart {}

      expect(getActorName(ShoppingCart)).toBe('ShoppingCart');
    });

    it('should register actor with GlobalRegistry', () => {
      @Actor()
      class ShoppingCart {}

      expect(registry.hasActor('ShoppingCart')).toBe(true);
      const meta = registry.getActor('ShoppingCart');
      expect(meta).toBeDefined();
      expect(meta?.actorClass).toBe(ShoppingCart);
    });

    it('should store metadata via Reflect.defineMetadata', () => {
      @Actor()
      class MyActor {}

      expect(Reflect.getMetadata('actor', MyActor)).toBe(true);
      expect(Reflect.getMetadata('actor:name', MyActor)).toBe('MyActor');
      expect(Reflect.getMetadata('actor:metadata', MyActor)).toBeDefined();
    });
  });

  describe('Options', () => {
    it('should use custom name from options', () => {
      @Actor({ name: 'shopping-cart' })
      class ShoppingCartActor {}

      expect(getActorName(ShoppingCartActor)).toBe('shopping-cart');
      expect(registry.hasActor('shopping-cart')).toBe(true);
      expect(registry.hasActor('ShoppingCartActor')).toBe(false);
    });

    it('should accept empty options', () => {
      @Actor({})
      class MyActor {}

      expect(isActor(MyActor)).toBe(true);
      expect(getActorName(MyActor)).toBe('MyActor');
    });
  });

  describe('Helper Functions', () => {
    describe('isActor', () => {
      it('should return true for decorated classes', () => {
        @Actor()
        class MyActor {}

        expect(isActor(MyActor)).toBe(true);
      });

      it('should return false for non-actor classes', () => {
        class NotAnActor {}

        expect(isActor(NotAnActor)).toBe(false);
      });

      it('should return false for non-functions', () => {
        expect(isActor(null)).toBe(false);
        expect(isActor(undefined)).toBe(false);
        expect(isActor(42)).toBe(false);
        expect(isActor('string')).toBe(false);
        expect(isActor({})).toBe(false);
      });
    });

    describe('getActorMetadata', () => {
      it('should return metadata for actors', () => {
        @Actor()
        class MyActor {}

        const metadata = getActorMetadata(MyActor);
        expect(metadata).toBeDefined();
        expect(metadata?.name).toBe('MyActor');
        expect(metadata?.actorClass).toBe(MyActor);
      });

      it('should return undefined for non-actors', () => {
        class NotAnActor {}

        expect(getActorMetadata(NotAnActor)).toBeUndefined();
      });
    });

    describe('getActorName', () => {
      it('should return the actor name', () => {
        @Actor({ name: 'custom-name' })
        class MyActor {}

        expect(getActorName(MyActor)).toBe('custom-name');
      });

      it('should return undefined for non-actors', () => {
        class NotAnActor {}

        expect(getActorName(NotAnActor)).toBeUndefined();
      });
    });

    describe('getOperationMethods', () => {
      it('should return operation method names', () => {
        @Actor()
        class MyActor {
          @Operation()
          async addItem() {}

          @Operation()
          async removeItem() {}
        }

        const methods = getOperationMethods(MyActor);
        expect(methods.sort()).toEqual(['addItem', 'removeItem']);
      });

      it('should return empty for non-actors', () => {
        class NotAnActor {}

        expect(getOperationMethods(NotAnActor)).toEqual([]);
      });

      it('should not include non-operation methods', () => {
        @Actor()
        class MyActor {
          @Operation()
          async addItem() {}

          regularMethod() {
            return 'hello';
          }
        }

        const methods = getOperationMethods(MyActor);
        expect(methods).toEqual(['addItem']);
        expect(methods).not.toContain('regularMethod');
      });

      it('should not include constructor', () => {
        @Actor()
        class MyActor {
          constructor() {}

          @Operation()
          async process() {}
        }

        const methods = getOperationMethods(MyActor);
        expect(methods).not.toContain('constructor');
      });
    });
  });

  describe('Error Cases', () => {
    it('should throw when applied to non-class', () => {
      expect(() => {
        const notAClass = {} as any;
        Actor()(notAClass);
      }).toThrow(DecoratorError);
    });

    it('should throw DecoratorError with proper message', () => {
      expect(() => {
        const notAClass = 42 as any;
        Actor()(notAClass);
      }).toThrow('@Actor');
    });
  });

  describe('Integration with @Operation', () => {
    it('should work with @Operation decorated methods', () => {
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem() {
          return { items: [] };
        }
      }

      expect(isActor(ShoppingCart)).toBe(true);
      expect(registry.hasOperation('ShoppingCart', 'addItem')).toBe(true);
    });

    it('should support multiple operations', () => {
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem() {}

        @Operation({ mode: 'shared' })
        async getTotal() {}

        @Operation()
        async checkout() {}
      }

      const ops = registry.getOperationsForActor('ShoppingCart');
      expect(ops).toHaveLength(3);
      expect(ops.map((o) => o.name).sort()).toEqual(['addItem', 'checkout', 'getTotal']);
    });
  });

  describe('Integration with @Injectable', () => {
    it('should work with @Injectable for DI', () => {
      // A stand-in for @Injectable, so this test depends only on @Actor.
      function MockInjectable(): ClassDecorator {
        return (target: any) => {
          Reflect.defineMetadata('injectable', true, target);
          return target;
        };
      }

      @MockInjectable()
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem() {}
      }

      expect(isActor(ShoppingCart)).toBe(true);
      expect(Reflect.getMetadata('injectable', ShoppingCart)).toBe(true);
    });

    it('should preserve decorator order', () => {
      function CustomDecorator(): ClassDecorator {
        return (target: any) => {
          Reflect.defineMetadata('custom', 'value', target);
          return target;
        };
      }

      @CustomDecorator()
      @Actor()
      class MyActor {}

      expect(isActor(MyActor)).toBe(true);
      expect(Reflect.getMetadata('custom', MyActor)).toBe('value');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle shopping cart actor pattern', () => {
      interface CartItem {
        name: string;
        price: number;
      }

      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem(_ctx: any, _item: CartItem) {
          return { items: [], total: 0 };
        }

        @Operation()
        async removeItem(_ctx: any, _itemName: string) {
          return { items: [], total: 0 };
        }

        @Operation({ mode: 'shared' })
        async getTotal(_ctx: any) {
          return 0;
        }
      }

      expect(isActor(ShoppingCart)).toBe(true);
      expect(registry.hasActor('ShoppingCart')).toBe(true);
      expect(getOperationMethods(ShoppingCart).sort()).toEqual([
        'addItem',
        'getTotal',
        'removeItem',
      ]);
    });

    it('should handle counter actor pattern', () => {
      @Actor({ name: 'counter' })
      class CounterActor {
        @Operation()
        async increment(_ctx: any) {
          return 1;
        }

        @Operation()
        async decrement(_ctx: any) {
          return -1;
        }

        @Operation({ mode: 'shared' })
        async getValue(_ctx: any) {
          return 0;
        }
      }

      expect(getActorName(CounterActor)).toBe('counter');
      expect(registry.hasActor('counter')).toBe(true);
      expect(getOperationMethods(CounterActor)).toHaveLength(3);
    });

    it('should handle actor with constructor dependencies', () => {
      class DatabaseService {
        query() {
          return [];
        }
      }

      @Actor()
      class UserActor {
        constructor(private db: DatabaseService) {}

        @Operation()
        async getProfile(_ctx: any) {
          return this.db.query();
        }
      }

      expect(isActor(UserActor)).toBe(true);

      const db = new DatabaseService();
      const instance = new UserActor(db);
      expect(instance).toBeDefined();
    });
  });
});
