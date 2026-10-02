/**
 * Tests for @Task() Decorator with TaskReference
 * @packageDocumentation
 */

import {
  Task,
  isTask,
  getTaskMetadata,
  getTaskName,
  hasTaskReference,
  getTaskReference,
  getAllTaskReferences,
} from '../decorators/task';
import { Tasks } from '../decorators/tasks';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';
import type { TaskReference } from '../types';

describe('@Task() Decorator', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Basic Functionality', () => {
    it('should decorate a method successfully', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod() {
          return 'test';
        }
      }

      expect(TestTasks).toBeDefined();
      expect(isTask(TestTasks.prototype, 'testMethod')).toBe(true);
    });

    it('should register task with GlobalRegistry', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'my-task' })
        async testMethod() {}
      }

      const metadata = registry.getTask('my-task');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('my-task');
    });

    it('should use method name as task name if not specified', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async myMethod() {}
      }

      const metadata = registry.getTask('myMethod');
      expect(metadata).toBeDefined();
      expect(metadata?.methodName).toBe('myMethod');
    });

    it('should use provided name over method name', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'custom-name' })
        async myMethod() {}
      }

      const metadata = registry.getTask('custom-name');
      expect(metadata).toBeDefined();
      expect(metadata?.methodName).toBe('myMethod');
    });

    it('should store metadata on the method', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'test-task' })
        async testMethod() {}
      }

      const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('test-task');
      expect(metadata?.methodName).toBe('testMethod');
    });
  });

  describe('TaskReference Generation', () => {
    it('should create static TaskReference property', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod() {}
      }

      // Static property should exist
      expect((TestTasks as any).testMethod).toBeDefined();
      expect(typeof (TestTasks as any).testMethod).toBe('object');
    });

    it('should have correct TaskReference structure', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'my-task' })
        async testMethod() {}
      }

      // Static property is named after taskName, not methodName
      const ref = (TestTasks as any)['my-task'] as TaskReference;
      expect(ref.taskName).toBe('my-task');
      expect(ref.handlerClass).toBe(TestTasks);
      expect(ref.methodName).toBe('testMethod');
    });

    it('should be accessible via hasTaskReference', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod() {}
      }

      expect(hasTaskReference(TestTasks, 'testMethod')).toBe(true);
      expect(hasTaskReference(TestTasks, 'nonExistent')).toBe(false);
    });

    it('should be retrievable via getTaskReference', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'test-task' })
        async testMethod() {}
      }

      // getTaskReference uses taskName, not methodName
      const ref = getTaskReference(TestTasks, 'test-task');
      expect(ref).toBeDefined();
      expect(ref?.taskName).toBe('test-task');
      expect(ref?.handlerClass).toBe(TestTasks);
      expect(ref?.methodName).toBe('testMethod');
    });

    it('should create TaskReference for each decorated method', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async method1() {}

        @Task()
        async method2() {}

        @Task()
        async method3() {}
      }

      expect(hasTaskReference(TestTasks, 'method1')).toBe(true);
      expect(hasTaskReference(TestTasks, 'method2')).toBe(true);
      expect(hasTaskReference(TestTasks, 'method3')).toBe(true);
    });

    it('should retrieve all TaskReferences from a class', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async task1() {}

        @Task()
        async task2() {}

        regularMethod() {}
      }

      const refs = getAllTaskReferences(TestTasks);
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.methodName)).toContain('task1');
      expect(refs.map((r) => r.methodName)).toContain('task2');
      expect(refs.map((r) => r.methodName)).not.toContain('regularMethod');
    });

    it('should make TaskReference immutable', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod() {}
      }

      const ref = (TestTasks as any).testMethod;

      // Attempt to modify
      expect(() => {
        (TestTasks as any).testMethod = 'something else';
      }).toThrow();

      // Should still be the same
      expect((TestTasks as any).testMethod).toBe(ref);
    });
  });

  describe('Task Options', () => {
    it('should store timeout option', () => {
      @Tasks()
      class TestTasks {
        @Task({ timeout: 5000 })
        async testMethod() {}
      }

      const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
      expect(metadata?.timeout).toBe(5000);
    });

    it('should store retry policy', () => {
      @Tasks()
      class TestTasks {
        @Task({
          retryPolicy: {
            maxAttempts: 3,
            initialInterval: 1000,
            backoffCoefficient: 2,
          },
        })
        async testMethod() {}
      }

      const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
      expect(metadata?.retryPolicy).toBeDefined();
      expect(metadata?.retryPolicy?.maxAttempts).toBe(3);
      expect(metadata?.retryPolicy?.initialInterval).toBe(1000);
      expect(metadata?.retryPolicy?.backoffCoefficient).toBe(2);
    });

    it('should store all options together', () => {
      @Tasks()
      class TestTasks {
        @Task({
          name: 'custom-task',
          timeout: 30000,
          retryPolicy: {
            maxAttempts: 5,
          },
        })
        async testMethod() {}
      }

      const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
      expect(metadata?.name).toBe('custom-task');
      expect(metadata?.timeout).toBe(30000);
      expect(metadata?.retryPolicy?.maxAttempts).toBe(5);
    });

    it('should handle empty options', () => {
      @Tasks()
      class TestTasks {
        @Task({})
        async testMethod() {}
      }

      const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('testMethod');
    });
  });

  describe('Multiple Tasks', () => {
    it('should handle multiple tasks in one class', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'task1' })
        async method1() {}

        @Task({ name: 'task2' })
        async method2() {}

        @Task({ name: 'task3' })
        async method3() {}
      }

      expect(registry.hasTask('task1')).toBe(true);
      expect(registry.hasTask('task2')).toBe(true);
      expect(registry.hasTask('task3')).toBe(true);
    });

    it('should create separate TaskReferences for each task', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async task1() {}

        @Task()
        async task2() {}
      }

      const ref1 = getTaskReference(TestTasks, 'task1');
      const ref2 = getTaskReference(TestTasks, 'task2');

      expect(ref1).not.toBe(ref2);
      expect(ref1?.methodName).toBe('task1');
      expect(ref2?.methodName).toBe('task2');
    });

    it('should handle tasks across multiple classes', () => {
      @Tasks()
      class Tasks1 {
        @Task()
        async method1() {}
      }

      @Tasks()
      class Tasks2 {
        @Task()
        async method2() {}
      }

      expect(hasTaskReference(Tasks1, 'method1')).toBe(true);
      expect(hasTaskReference(Tasks2, 'method2')).toBe(true);
      expect(hasTaskReference(Tasks1, 'method2')).toBe(false);
      expect(hasTaskReference(Tasks2, 'method1')).toBe(false);
    });
  });

  describe('Helper Functions', () => {
    describe('isTask()', () => {
      it('should return true for decorated methods', () => {
        @Tasks()
        class TestTasks {
          @Task()
          async testMethod() {}
        }

        expect(isTask(TestTasks.prototype, 'testMethod')).toBe(true);
      });

      it('should return false for undecorated methods', () => {
        @Tasks()
        class TestTasks {
          async testMethod() {}
        }

        expect(isTask(TestTasks.prototype, 'testMethod')).toBe(false);
      });

      it('should return false for non-existent methods', () => {
        @Tasks()
        class TestTasks {}

        expect(isTask(TestTasks.prototype, 'nonExistent')).toBe(false);
      });

      it('should return false for invalid inputs', () => {
        expect(isTask(null, 'test')).toBe(false);
        expect(isTask(undefined, 'test')).toBe(false);
        expect(isTask({}, 'test')).toBe(false);
      });
    });

    describe('getTaskName()', () => {
      it('should return task name for decorated method', () => {
        @Tasks()
        class TestTasks {
          @Task({ name: 'my-task' })
          async testMethod() {}
        }

        expect(getTaskName(TestTasks.prototype, 'testMethod')).toBe('my-task');
      });

      it('should return undefined for undecorated method', () => {
        @Tasks()
        class TestTasks {
          async testMethod() {}
        }

        expect(getTaskName(TestTasks.prototype, 'testMethod')).toBeUndefined();
      });
    });

    describe('getTaskMetadata()', () => {
      it('should return metadata for decorated method', () => {
        @Tasks()
        class TestTasks {
          @Task({ name: 'test', timeout: 5000 })
          async testMethod() {}
        }

        const metadata = getTaskMetadata(TestTasks.prototype, 'testMethod');
        expect(metadata).toBeDefined();
        expect(metadata?.name).toBe('test');
        expect(metadata?.timeout).toBe(5000);
      });

      it('should return undefined for undecorated method', () => {
        @Tasks()
        class TestTasks {
          async testMethod() {}
        }

        expect(getTaskMetadata(TestTasks.prototype, 'testMethod')).toBeUndefined();
      });
    });

    describe('getAllTaskReferences()', () => {
      it('should return empty array for class without tasks', () => {
        @Tasks()
        class TestTasks {
          regularMethod() {}
        }

        expect(getAllTaskReferences(TestTasks)).toEqual([]);
      });

      it('should return all task references', () => {
        @Tasks()
        class TestTasks {
          @Task()
          async task1() {}

          @Task()
          async task2() {}
        }

        const refs = getAllTaskReferences(TestTasks);
        expect(refs).toHaveLength(2);
      });
    });
  });

  describe('Error Cases', () => {
    it('should throw when applied to non-method', () => {
      expect(() => {
        @Tasks()
        class TestTasks {
          @Task()
          value = 42;
        }
      }).toThrow(DecoratorError);
    });

    it('should throw when applied to symbol property', () => {
      const sym = Symbol('test');

      expect(() => {
        @Tasks()
        class TestTasks {
          @Task()
          [sym]() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should throw when static property already exists', () => {
      expect(() => {
        @Tasks()
        class TestTasks {
          static testMethod = 'existing';

          @Task()
          testMethod() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should throw with helpful error message for static collision', () => {
      expect(() => {
        @Tasks()
        class TestTasks {
          static myTask = 'exists';

          @Task()
          myTask() {}
        }
      }).toThrow('static property');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support typical payment tasks', () => {
      @Tasks()
      class PaymentTasks {
        @Task({ name: 'charge-card', timeout: 30000 })
        async chargeCard(amount: number, token: string) {
          return { success: true, chargeId: 'ch_123' };
        }

        @Task({ name: 'refund', timeout: 15000 })
        async refund(chargeId: string) {
          return { success: true, refundId: 're_123' };
        }
      }

      // Static properties are named after taskName ('charge-card', 'refund')
      expect(hasTaskReference(PaymentTasks, 'charge-card')).toBe(true);
      expect(hasTaskReference(PaymentTasks, 'refund')).toBe(true);

      const chargeRef = getTaskReference(PaymentTasks, 'charge-card');
      expect(chargeRef?.taskName).toBe('charge-card');
    });

    it('should support tasks with retry policies', () => {
      @Tasks()
      class NetworkTasks {
        @Task({
          name: 'fetch-data',
          timeout: 10000,
          retryPolicy: {
            maxAttempts: 3,
            initialInterval: 1000,
            backoffCoefficient: 2,
            maxInterval: 10000,
          },
        })
        async fetchData(url: string) {
          return { data: 'test' };
        }
      }

      const metadata = getTaskMetadata(NetworkTasks.prototype, 'fetchData');
      expect(metadata?.retryPolicy).toBeDefined();
      expect(metadata?.retryPolicy?.maxAttempts).toBe(3);
    });

    it('should support complex task handler', () => {
      @Tasks()
      class UserTasks {
        @Task({ name: 'create-user' })
        async createUser(data: any) {
          return { id: '1', ...data };
        }

        @Task({ name: 'update-user' })
        async updateUser(id: string, data: any) {
          return { id, ...data };
        }

        @Task({ name: 'delete-user' })
        async deleteUser(id: string) {
          return { deleted: true, id };
        }

        @Task({ name: 'send-welcome-email' })
        async sendWelcomeEmail(userId: string) {
          return { sent: true, userId };
        }
      }

      const refs = getAllTaskReferences(UserTasks);
      expect(refs).toHaveLength(4);

      const taskNames = refs.map((r) => r.taskName);
      expect(taskNames).toContain('create-user');
      expect(taskNames).toContain('update-user');
      expect(taskNames).toContain('delete-user');
      expect(taskNames).toContain('send-welcome-email');
    });
  });

  describe('Integration with Registry', () => {
    it('should register task with correct metadata', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'my-task', timeout: 5000 })
        async testMethod() {}
      }

      const metadata = registry.getTask('my-task');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('my-task');
      expect(metadata?.handlerClass).toBe(TestTasks);
      expect(metadata?.methodName).toBe('testMethod');
      expect(metadata?.timeout).toBe(5000);
    });

    it('should be detectable with hasTask', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'test-task' })
        async testMethod() {}
      }

      expect(registry.hasTask('test-task')).toBe(true);
      expect(registry.hasTask('non-existent')).toBe(false);
    });

    it('should appear in getAllTasks', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'task1' })
        async method1() {}

        @Task({ name: 'task2' })
        async method2() {}
      }

      const allTasks = registry.getAllTasks();
      expect(allTasks.size).toBeGreaterThanOrEqual(2);
      expect(allTasks.get('task1')).toBeDefined();
      expect(allTasks.get('task2')).toBeDefined();
    });

    it('should work with registry clear', () => {
      @Tasks()
      class TestTasks {
        @Task({ name: 'test-task' })
        async testMethod() {}
      }

      expect(registry.hasTask('test-task')).toBe(true);

      registry.clear();

      expect(registry.hasTask('test-task')).toBe(false);
    });
  });

  describe('Type Safety', () => {
    it('should preserve method functionality', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod(input: string) {
          return input.toUpperCase();
        }
      }

      const instance = new TestTasks();
      return instance.testMethod('hello').then((result) => {
        expect(result).toBe('HELLO');
      });
    });

    it('should not interfere with instance methods', () => {
      @Tasks()
      class TestTasks {
        private value = 42;

        @Task()
        async testMethod() {
          return this.value;
        }
      }

      const instance = new TestTasks();
      return instance.testMethod().then((result) => {
        expect(result).toBe(42);
      });
    });

    it('should allow method to access constructor dependencies', () => {
      @Tasks()
      class TestTasks {
        constructor(private multiplier: number) {}

        @Task()
        async calculate(input: number) {
          return input * this.multiplier;
        }
      }

      const instance = new TestTasks(2);
      return instance.calculate(5).then((result) => {
        expect(result).toBe(10);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle async methods', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async asyncMethod() {
          return Promise.resolve('async result');
        }
      }

      expect(hasTaskReference(TestTasks, 'asyncMethod')).toBe(true);
    });

    it('should handle methods with complex signatures', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async complexMethod(
          arg1: string,
          arg2: number,
          arg3: { key: string }
        ): Promise<{ result: boolean }> {
          return { result: true };
        }
      }

      expect(hasTaskReference(TestTasks, 'complexMethod')).toBe(true);
    });

    it('should handle methods with generic types', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async genericMethod<T>(input: T): Promise<T> {
          return input;
        }
      }

      expect(hasTaskReference(TestTasks, 'genericMethod')).toBe(true);
    });

    it('should handle private methods', () => {
      @Tasks()
      class TestTasks {
        @Task()
        private async privateTask() {
          return 'private';
        }

        async callPrivate() {
          return this.privateTask();
        }
      }

      expect(hasTaskReference(TestTasks, 'privateTask')).toBe(true);
    });

    it('should handle methods with default parameters', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async methodWithDefaults(required: string, optional: number = 42) {
          return { required, optional };
        }
      }

      expect(hasTaskReference(TestTasks, 'methodWithDefaults')).toBe(true);
    });

    it('should preserve method name in TaskReference', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async veryLongMethodNameThatShouldBePreserved() {}
      }

      const ref = getTaskReference(TestTasks, 'veryLongMethodNameThatShouldBePreserved');
      expect(ref?.methodName).toBe('veryLongMethodNameThatShouldBePreserved');
    });
  });

  describe('Combination with @Tasks', () => {
    it('should work seamlessly with @Tasks decorator', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async testMethod() {}
      }

      // Both decorators should have registered
      expect(registry.hasTaskHandler(TestTasks)).toBe(true);
      expect(registry.hasTask('testMethod')).toBe(true);
    });

    it('should update getTaskMethods to find decorated tasks', () => {
      @Tasks()
      class TestTasks {
        @Task()
        async task1() {}

        @Task()
        async task2() {}

        regularMethod() {}
      }

      // The getTaskMethods from @Tasks should find these
      const prototype = TestTasks.prototype;
      expect(isTask(prototype, 'task1')).toBe(true);
      expect(isTask(prototype, 'task2')).toBe(true);
      expect(isTask(prototype, 'regularMethod')).toBe(false);
    });
  });
});
