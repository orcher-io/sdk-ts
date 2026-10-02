/**
 * Tests for @Operation() Decorator
 * @packageDocumentation
 */

import 'reflect-metadata';
import { Actor } from '../decorators/actor';
import {
  Operation,
  isOperation,
  getOperationMetadata,
  getOperationName,
  hasOperationReference,
  getAllOperationReferences,
} from '../decorators/operation';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';
import type { OperationReference } from '../types';

describe('@Operation() Decorator', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Functionality', () => {
    it('should mark a method as an operation', () => {
      @Actor()
      class MyActor {
        @Operation()
        async testMethod() {}
      }

      expect(isOperation(MyActor.prototype, 'testMethod')).toBe(true);
    });

    it('should use method name as default operation name', () => {
      @Actor()
      class MyActor {
        @Operation()
        async addItem() {}
      }

      expect(getOperationName(MyActor.prototype, 'addItem')).toBe('addItem');
    });

    it('should register operation with GlobalRegistry', () => {
      @Actor()
      class MyActor {
        @Operation()
        async addItem() {}
      }

      expect(registry.hasOperation('MyActor', 'addItem')).toBe(true);
      const meta = registry.getOperation('MyActor', 'addItem');
      expect(meta).toBeDefined();
      expect(meta?.methodName).toBe('addItem');
    });

    it('should store metadata via Reflect.defineMetadata', () => {
      @Actor()
      class MyActor {
        @Operation()
        async process() {}
      }

      expect(Reflect.getMetadata('operation', MyActor.prototype, 'process')).toBe(true);
      expect(Reflect.getMetadata('operation:name', MyActor.prototype, 'process')).toBe('process');
      expect(Reflect.getMetadata('operation:metadata', MyActor.prototype, 'process')).toBeDefined();
    });
  });

  describe('Options', () => {
    it('should use custom name from options', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'custom-add' })
        async addItemImpl() {}
      }

      expect(getOperationName(MyActor.prototype, 'addItemImpl')).toBe('custom-add');
      expect(registry.hasOperation('MyActor', 'custom-add')).toBe(true);
    });

    it('should default mode to exclusive', () => {
      @Actor()
      class MyActor {
        @Operation()
        async mutate() {}
      }

      const meta = getOperationMetadata(MyActor.prototype, 'mutate');
      expect(meta?.mode).toBe('exclusive');
    });

    it('should accept shared mode', () => {
      @Actor()
      class MyActor {
        @Operation({ mode: 'shared' })
        async read() {}
      }

      const meta = getOperationMetadata(MyActor.prototype, 'read');
      expect(meta?.mode).toBe('shared');
    });

    it('should accept timeout option', () => {
      @Actor()
      class MyActor {
        @Operation({ timeout: 5000 })
        async process() {}
      }

      const meta = getOperationMetadata(MyActor.prototype, 'process');
      expect(meta?.timeout).toBe(5000);
    });

    it('should accept all options together', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'custom-op', mode: 'shared', timeout: 10000 })
        async myMethod() {}
      }

      const meta = getOperationMetadata(MyActor.prototype, 'myMethod');
      expect(meta?.name).toBe('custom-op');
      expect(meta?.mode).toBe('shared');
      expect(meta?.timeout).toBe(10000);
    });
  });

  describe('OperationReference Generation', () => {
    it('should create static OperationReference property', () => {
      @Actor()
      class MyActor {
        @Operation()
        async testMethod() {}
      }

      expect((MyActor as any)['testMethod']).toBeDefined();
      expect(typeof (MyActor as any)['testMethod']).toBe('object');
    });

    it('should use operationName as static property name', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'customOp' })
        async internalMethod() {}
      }

      // Static property is named after operationName, not methodName
      expect((MyActor as any)['customOp']).toBeDefined();
    });

    it('should include correct operationName in reference', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'add-item' })
        async addItem() {}
      }

      const ref = (MyActor as any)['add-item'] as OperationReference;
      expect(ref.operationName).toBe('add-item');
    });

    it('should include correct actorClass in reference', () => {
      @Actor()
      class MyActor {
        @Operation()
        async process() {}
      }

      const ref = (MyActor as any)['process'] as OperationReference;
      expect(ref.actorClass).toBe(MyActor);
    });

    it('should include correct methodName in reference', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'custom' })
        async internalMethod() {}
      }

      const ref = (MyActor as any)['custom'] as OperationReference;
      expect(ref.methodName).toBe('internalMethod');
    });

    it('should include correct mode in reference', () => {
      @Actor()
      class MyActor {
        @Operation({ mode: 'shared' })
        async readOp() {}
      }

      const ref = (MyActor as any)['readOp'] as OperationReference;
      expect(ref.mode).toBe('shared');
    });

    it('should make static property immutable (non-writable)', () => {
      @Actor()
      class MyActor {
        @Operation()
        async addItem() {}
      }

      const descriptor = Object.getOwnPropertyDescriptor(MyActor, 'addItem');
      expect(descriptor?.writable).toBe(false);
      expect(descriptor?.configurable).toBe(false);
    });

    it('should create multiple references for multiple operations', () => {
      @Actor()
      class MyActor {
        @Operation()
        async addItem() {}

        @Operation({ mode: 'shared' })
        async getTotal() {}

        @Operation()
        async checkout() {}
      }

      expect((MyActor as any)['addItem']).toBeDefined();
      expect((MyActor as any)['getTotal']).toBeDefined();
      expect((MyActor as any)['checkout']).toBeDefined();

      expect((MyActor as any)['addItem'].mode).toBe('exclusive');
      expect((MyActor as any)['getTotal'].mode).toBe('shared');
      expect((MyActor as any)['checkout'].mode).toBe('exclusive');
    });
  });

  describe('Helper Functions', () => {
    describe('isOperation', () => {
      it('should return true for decorated methods', () => {
        @Actor()
        class MyActor {
          @Operation()
          async process() {}
        }

        expect(isOperation(MyActor.prototype, 'process')).toBe(true);
      });

      it('should return false for non-operation methods', () => {
        @Actor()
        class MyActor {
          regularMethod() {}
        }

        expect(isOperation(MyActor.prototype, 'regularMethod')).toBe(false);
      });

      it('should return false for nonexistent methods', () => {
        @Actor()
        class MyActor {}

        expect(isOperation(MyActor.prototype, 'nonExistent')).toBe(false);
      });
    });

    describe('getOperationMetadata', () => {
      it('should return metadata for operations', () => {
        @Actor()
        class MyActor {
          @Operation({ mode: 'shared', timeout: 3000 })
          async read() {}
        }

        const meta = getOperationMetadata(MyActor.prototype, 'read');
        expect(meta).toBeDefined();
        expect(meta?.name).toBe('read');
        expect(meta?.mode).toBe('shared');
        expect(meta?.timeout).toBe(3000);
      });

      it('should return undefined for non-operations', () => {
        class NotAnActor {
          regularMethod() {}
        }

        expect(getOperationMetadata(NotAnActor.prototype, 'regularMethod')).toBeUndefined();
      });
    });

    describe('getOperationName', () => {
      it('should return the operation name', () => {
        @Actor()
        class MyActor {
          @Operation({ name: 'custom' })
          async method() {}
        }

        expect(getOperationName(MyActor.prototype, 'method')).toBe('custom');
      });

      it('should return undefined for non-operations', () => {
        class NotAnActor {
          method() {}
        }

        expect(getOperationName(NotAnActor.prototype, 'method')).toBeUndefined();
      });
    });

    describe('hasOperationReference', () => {
      it('should return true when present', () => {
        @Actor()
        class MyActor {
          @Operation()
          async process() {}
        }

        expect(hasOperationReference(MyActor, 'process')).toBe(true);
      });

      it('should return false when absent', () => {
        @Actor()
        class MyActor {}

        expect(hasOperationReference(MyActor, 'nonExistent')).toBe(false);
      });
    });

    describe('getAllOperationReferences', () => {
      it('should return all references', () => {
        @Actor()
        class MyActor {
          @Operation()
          async addItem() {}

          @Operation({ mode: 'shared' })
          async getTotal() {}
        }

        const refs = getAllOperationReferences(MyActor);
        expect(refs).toHaveLength(2);
        expect(refs.map((r) => r.operationName).sort()).toEqual(['addItem', 'getTotal']);
      });

      it('should return empty for non-actors', () => {
        class PlainClass {}

        expect(getAllOperationReferences(PlainClass)).toEqual([]);
      });
    });
  });

  describe('Error Cases', () => {
    it('should throw when applied to symbol property', () => {
      const sym = Symbol('test');

      expect(() => {
        const decorator = Operation();
        const descriptor: PropertyDescriptor = {
          value: async function () {},
          writable: true,
          enumerable: false,
          configurable: true,
        };
        decorator({} as any, sym, descriptor);
      }).toThrow(DecoratorError);
    });

    it('should throw when applied to non-method', () => {
      expect(() => {
        const decorator = Operation();
        const descriptor: PropertyDescriptor = {
          value: 'not a function',
          writable: true,
          enumerable: false,
          configurable: true,
        };
        decorator({} as any, 'prop', descriptor);
      }).toThrow(DecoratorError);
    });

    it('should throw on static property collision', () => {
      expect(() => {
        @Actor()
        class MyActor {
          static existingProp = 42;

          @Operation({ name: 'existingProp' })
          async myMethod() {}
        }
      }).toThrow(DecoratorError);
    });
  });

  describe('Custom Name Mapping', () => {
    it('should use custom name for static property (not method name)', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'addToCart' })
        async addItemImplementation() {}
      }

      // Static property uses operationName
      expect((MyActor as any)['addToCart']).toBeDefined();
      // The reference's methodName is the actual method
      expect((MyActor as any)['addToCart'].methodName).toBe('addItemImplementation');
    });

    it('should allow method name and operation name to differ', () => {
      @Actor()
      class MyActor {
        @Operation({ name: 'pub-op' })
        async internalHandler() {}
      }

      expect(getOperationName(MyActor.prototype, 'internalHandler')).toBe('pub-op');
      expect(registry.hasOperation('MyActor', 'pub-op')).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle exclusive mutation operations', () => {
      @Actor()
      class BankAccount {
        @Operation()
        async deposit(_ctx: any, _amount: number) {
          return { balance: 100 };
        }

        @Operation()
        async withdraw(_ctx: any, _amount: number) {
          return { balance: 50 };
        }
      }

      const refs = getAllOperationReferences(BankAccount);
      expect(refs).toHaveLength(2);
      expect(refs.every((r) => r.mode === 'exclusive')).toBe(true);
    });

    it('should handle shared read operations', () => {
      @Actor()
      class Dashboard {
        @Operation({ mode: 'shared' })
        async getMetrics(_ctx: any) {
          return {};
        }

        @Operation({ mode: 'shared' })
        async getStatus(_ctx: any) {
          return 'ok';
        }
      }

      const refs = getAllOperationReferences(Dashboard);
      expect(refs).toHaveLength(2);
      expect(refs.every((r) => r.mode === 'shared')).toBe(true);
    });

    it('should handle mixed mode operations on same actor', () => {
      @Actor()
      class ShoppingCart {
        @Operation()
        async addItem(_ctx: any, _item: any) {}

        @Operation()
        async removeItem(_ctx: any, _itemId: string) {}

        @Operation({ mode: 'shared' })
        async getItems(_ctx: any) {
          return [];
        }

        @Operation({ mode: 'shared' })
        async getTotal(_ctx: any) {
          return 0;
        }
      }

      const refs = getAllOperationReferences(ShoppingCart);
      const exclusiveOps = refs.filter((r) => r.mode === 'exclusive');
      const sharedOps = refs.filter((r) => r.mode === 'shared');

      expect(exclusiveOps).toHaveLength(2);
      expect(sharedOps).toHaveLength(2);
    });
  });
});
