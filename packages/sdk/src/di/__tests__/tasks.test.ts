/**
 * Tests for @Tasks() Decorator
 * @packageDocumentation
 */

import {
  Tasks,
  isTasks,
  isTaskHandler,
  getTaskHandlerMetadata,
  getTaskMethods,
} from '../decorators/tasks';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';

describe('@Tasks() Decorator', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Functionality', () => {
    it('should decorate a class successfully', () => {
      @Tasks()
      class TestTasks {}

      expect(TestTasks).toBeDefined();
      expect(typeof TestTasks).toBe('function');
    });

    it('should auto-register task handler with GlobalRegistry', () => {
      @Tasks()
      class TestTasks {}

      const metadata = registry.getTaskHandler(TestTasks);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestTasks);
    });

    it('should mark class as task handler', () => {
      @Tasks()
      class TestTasks {}

      expect(isTasks(TestTasks)).toBe(true);
      expect(isTaskHandler(TestTasks)).toBe(true);
    });

    it('should not mark undecorated class as task handler', () => {
      class TestTasks {}

      expect(isTasks(TestTasks)).toBe(false);
      expect(isTaskHandler(TestTasks)).toBe(false);
    });

    it('should store metadata on the class', () => {
      @Tasks()
      class TestTasks {}

      const metadata = getTaskHandlerMetadata(TestTasks);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestTasks);
      expect(metadata?.registered).toBe(true);
    });
  });

  describe('Multiple Task Handlers', () => {
    it('should register multiple task handlers', () => {
      @Tasks()
      class Tasks1 {}

      @Tasks()
      class Tasks2 {}

      @Tasks()
      class Tasks3 {}

      expect(registry.getTaskHandler(Tasks1)).toBeDefined();
      expect(registry.getTaskHandler(Tasks2)).toBeDefined();
      expect(registry.getTaskHandler(Tasks3)).toBeDefined();

      const stats = registry.getStats();
      expect(stats.taskHandlers).toBe(3);
    });

    it('should handle multiple task handlers independently', () => {
      @Tasks()
      class PaymentTasks {}

      @Tasks()
      class UserTasks {}

      expect(isTasks(PaymentTasks)).toBe(true);
      expect(isTasks(UserTasks)).toBe(true);
      expect(registry.hasTaskHandler(PaymentTasks)).toBe(true);
      expect(registry.hasTaskHandler(UserTasks)).toBe(true);
    });
  });

  describe('Class Features', () => {
    it('should work with classes that have constructors', () => {
      @Tasks()
      class TestTasks {
        constructor(private value: number = 42) {}

        getValue() {
          return this.value;
        }
      }

      const metadata = registry.getTaskHandler(TestTasks);
      expect(metadata).toBeDefined();

      // Can still instantiate
      const instance = new TestTasks(100);
      expect(instance.getValue()).toBe(100);
    });

    it('should work with classes that have methods', () => {
      @Tasks()
      class TestTasks {
        async processTask() {
          return { success: true };
        }

        async anotherTask() {
          return { success: false };
        }
      }

      expect(registry.getTaskHandler(TestTasks)).toBeDefined();
    });

    it('should work with classes that have properties', () => {
      @Tasks()
      class TestTasks {
        public name = 'TestTasks';
        private secret = 'hidden';

        getSecret() {
          return this.secret;
        }
      }

      expect(registry.getTaskHandler(TestTasks)).toBeDefined();

      const instance = new TestTasks();
      expect(instance.name).toBe('TestTasks');
      expect(instance.getSecret()).toBe('hidden');
    });

    it('should work with classes that extend other classes', () => {
      class BaseTasks {
        baseMethod() {
          return 'base';
        }
      }

      @Tasks()
      class ExtendedTasks extends BaseTasks {
        extendedMethod() {
          return 'extended';
        }
      }

      expect(registry.getTaskHandler(ExtendedTasks)).toBeDefined();

      const instance = new ExtendedTasks();
      expect(instance.baseMethod()).toBe('base');
      expect(instance.extendedMethod()).toBe('extended');
    });

    it('should preserve class name', () => {
      @Tasks()
      class PaymentTasks {}

      expect(PaymentTasks.name).toBe('PaymentTasks');
    });
  });

  describe('Helper Functions', () => {
    describe('isTasks()', () => {
      it('should return true for decorated classes', () => {
        @Tasks()
        class TestTasks {}

        expect(isTasks(TestTasks)).toBe(true);
      });

      it('should return false for undecorated classes', () => {
        class TestTasks {}

        expect(isTasks(TestTasks)).toBe(false);
      });

      it('should return false for non-class values', () => {
        expect(isTasks(null)).toBe(false);
        expect(isTasks(undefined)).toBe(false);
        expect(isTasks(42)).toBe(false);
        expect(isTasks('string')).toBe(false);
        expect(isTasks({})).toBe(false);
        expect(isTasks([])).toBe(false);
      });

      it('should return false for functions that are not classes', () => {
        function regularFunction() {}

        expect(isTasks(regularFunction)).toBe(false);
      });
    });

    describe('isTaskHandler()', () => {
      it('should return true for decorated classes', () => {
        @Tasks()
        class TestTasks {}

        expect(isTaskHandler(TestTasks)).toBe(true);
      });

      it('should return false for undecorated classes', () => {
        class TestTasks {}

        expect(isTaskHandler(TestTasks)).toBe(false);
      });

      it('should be equivalent to isTasks()', () => {
        @Tasks()
        class TestTasks {}

        expect(isTaskHandler(TestTasks)).toBe(isTasks(TestTasks));
      });
    });

    describe('getTaskHandlerMetadata()', () => {
      it('should return metadata for decorated classes', () => {
        @Tasks()
        class TestTasks {}

        const metadata = getTaskHandlerMetadata(TestTasks);
        expect(metadata).toBeDefined();
        expect(metadata?.token).toBe(TestTasks);
        expect(metadata?.registered).toBe(true);
      });

      it('should return undefined for undecorated classes', () => {
        class TestTasks {}

        expect(getTaskHandlerMetadata(TestTasks)).toBeUndefined();
      });

      it('should return undefined for non-class values', () => {
        expect(getTaskHandlerMetadata(null)).toBeUndefined();
        expect(getTaskHandlerMetadata({})).toBeUndefined();
      });
    });

    describe('getTaskMethods()', () => {
      it('should return empty array for class without task methods', () => {
        @Tasks()
        class TestTasks {
          regularMethod() {
            return 'regular';
          }
        }

        const methods = getTaskMethods(TestTasks);
        expect(methods).toEqual([]);
      });

      it('should return empty array for undecorated class', () => {
        class TestTasks {}

        const methods = getTaskMethods(TestTasks);
        expect(methods).toEqual([]);
      });

      it('should not include constructor', () => {
        @Tasks()
        class TestTasks {
          constructor() {}
        }

        const methods = getTaskMethods(TestTasks);
        expect(methods).not.toContain('constructor');
      });

      // getTaskMethods on classes with @Task() methods is covered in task.test.ts.
    });
  });

  describe('Error Cases', () => {
    it('should throw when applied to non-class', () => {
      expect(() => {
        const notAClass = {} as any;
        Tasks()(notAClass);
      }).toThrow(DecoratorError);
    });

    it('should throw DecoratorError with proper message', () => {
      expect(() => {
        const notAClass = 42 as any;
        Tasks()(notAClass);
      }).toThrow('@Tasks');
    });
  });

  describe('Integration with Registry', () => {
    it('should be retrievable from registry', () => {
      @Tasks()
      class TestTasks {}

      const metadata = registry.getTaskHandler(TestTasks);
      expect(metadata).toBeDefined();
      expect(metadata?.token).toBe(TestTasks);
    });

    it('should update registry statistics', () => {
      const statsBefore = registry.getStats();
      const handlersBefore = statsBefore.taskHandlers;

      @Tasks()
      class TestTasks {}

      const statsAfter = registry.getStats();
      expect(statsAfter.taskHandlers).toBe(handlersBefore + 1);
    });

    it('should appear in getAllTaskHandlers()', () => {
      @Tasks()
      class TestTasks {}

      const allHandlers = registry.getAllTaskHandlers();
      expect(allHandlers.size).toBe(1);
      expect(allHandlers.get(TestTasks)?.token).toBe(TestTasks);
    });

    it('should be detectable with hasTaskHandler()', () => {
      @Tasks()
      class TestTasks {}

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);
    });

    it('should work with registry clear()', () => {
      @Tasks()
      class TestTasks {}

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);

      registry.clear();

      expect(registry.hasTaskHandler(TestTasks)).toBe(false);
      expect(registry.getStats().taskHandlers).toBe(0);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support typical task handler', () => {
      @Tasks()
      class PaymentTasks {
        async chargeCard(amount: number, token: string) {
          return { success: true, amount, token };
        }

        async refund(chargeId: string) {
          return { success: true, chargeId };
        }
      }

      expect(registry.hasTaskHandler(PaymentTasks)).toBe(true);
    });

    it('should support task handler with dependencies', () => {
      class StripeService {
        charge(amount: number) {
          return { id: 'ch_123', amount };
        }
      }

      @Tasks()
      class PaymentTasks {
        constructor(private stripe: StripeService) {}

        async chargeCard(amount: number) {
          return this.stripe.charge(amount);
        }
      }

      expect(registry.hasTaskHandler(PaymentTasks)).toBe(true);

      // Can still instantiate with dependencies
      const stripe = new StripeService();
      const tasks = new PaymentTasks(stripe);
      expect(tasks).toBeDefined();
    });

    it('should support multiple task handlers in a system', () => {
      @Tasks()
      class PaymentTasks {
        async charge() {}
        async refund() {}
      }

      @Tasks()
      class UserTasks {
        async createUser() {}
        async deleteUser() {}
      }

      @Tasks()
      class NotificationTasks {
        async sendEmail() {}
        async sendSms() {}
      }

      expect(registry.hasTaskHandler(PaymentTasks)).toBe(true);
      expect(registry.hasTaskHandler(UserTasks)).toBe(true);
      expect(registry.hasTaskHandler(NotificationTasks)).toBe(true);

      const stats = registry.getStats();
      expect(stats.taskHandlers).toBe(3);
    });

    it('should support task handler with async methods', () => {
      @Tasks()
      class AsyncTasks {
        async process(input: any) {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { processed: input };
        }
      }

      expect(registry.hasTaskHandler(AsyncTasks)).toBe(true);

      // Can execute async methods
      const instance = new AsyncTasks();
      return instance.process({ test: true }).then((result) => {
        expect(result.processed).toEqual({ test: true });
      });
    });
  });

  describe('Combination with Other Decorators', () => {
    it('should work with @Injectable() decorator', () => {
      // This test checks only that the decorators can be combined; @Injectable() is
      // covered in injectable.test.ts. A stand-in decorator keeps this test independent of it.
      function MockInjectable(): ClassDecorator {
        return (target: any) => {
          Reflect.defineMetadata('injectable', true, target);
          return target;
        };
      }

      @MockInjectable()
      @Tasks()
      class TestTasks {}

      expect(isTasks(TestTasks)).toBe(true);
      expect(Reflect.getMetadata('injectable', TestTasks)).toBe(true);
    });

    it('should preserve other decorator metadata', () => {
      function CustomDecorator(): ClassDecorator {
        return (target: any) => {
          Reflect.defineMetadata('custom', 'value', target);
          return target;
        };
      }

      @CustomDecorator()
      @Tasks()
      class TestTasks {}

      expect(isTasks(TestTasks)).toBe(true);
      expect(Reflect.getMetadata('custom', TestTasks)).toBe('value');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty options object', () => {
      @Tasks({})
      class TestTasks {}

      expect(isTasks(TestTasks)).toBe(true);
    });

    it('should handle class with no methods', () => {
      @Tasks()
      class TestTasks {}

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);
    });

    it('should handle class with static members', () => {
      @Tasks()
      class TestTasks {
        static staticValue = 42;

        static getStaticValue() {
          return TestTasks.staticValue;
        }

        instanceMethod() {
          return TestTasks.staticValue;
        }
      }

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);
      expect(TestTasks.getStaticValue()).toBe(42);
    });

    it('should handle class with private methods', () => {
      @Tasks()
      class TestTasks {
        private privateMethod() {
          return 'private';
        }

        public publicMethod() {
          return this.privateMethod();
        }
      }

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);

      const instance = new TestTasks();
      expect(instance.publicMethod()).toBe('private');
    });

    it('should handle class with getters and setters', () => {
      @Tasks()
      class TestTasks {
        private _value = 0;

        get value() {
          return this._value;
        }

        set value(v: number) {
          this._value = v;
        }
      }

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);

      const instance = new TestTasks();
      instance.value = 42;
      expect(instance.value).toBe(42);
    });

    it('should handle abstract classes', () => {
      @Tasks()
      abstract class AbstractTasks {
        abstract process(): void;
      }

      expect(registry.hasTaskHandler(AbstractTasks)).toBe(true);
    });

    it('should handle class with constructor parameters', () => {
      @Tasks()
      class TestTasks {
        constructor(
          public dep1: any,
          private dep2: any
        ) {}
      }

      expect(registry.hasTaskHandler(TestTasks)).toBe(true);
    });
  });
});
