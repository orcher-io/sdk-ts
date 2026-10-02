/**
 * Tests for @Workflow() Decorator
 * @packageDocumentation
 */

import {
  Workflow,
  isWorkflow,
  getWorkflowMetadata,
  getWorkflowName,
  getWorkflowVersion,
} from '../decorators/workflow';
import { GlobalRegistry } from '../registry';
import { DecoratorError } from '../errors';
import type { WorkflowMetadata } from '../types';

describe('@Workflow() Decorator', () => {
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
      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run() {
          return 'test';
        }
      }

      expect(TestWorkflow).toBeDefined();
      expect(isWorkflow(TestWorkflow)).toBe(true);
    });

    it('should register workflow with GlobalRegistry', () => {
      @Workflow({ name: 'my-workflow' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = registry.getWorkflow('my-workflow');
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('my-workflow');
    });

    it('should store metadata on class', () => {
      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('test-workflow');
      expect(metadata?.workflowClass).toBe(TestWorkflow);
    });

    it('should use provided name', () => {
      @Workflow({ name: 'custom-workflow' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.name).toBe('custom-workflow');
    });

    it('should default version to 1.0', () => {
      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.version).toBe('1.0');
    });

    it('should store custom version', () => {
      @Workflow({ name: 'test-workflow', version: '2.5' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.version).toBe('2.5');
    });

    it('should store timeout if provided', () => {
      @Workflow({ name: 'test-workflow', timeout: 60000 })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.timeout).toBe(60000);
    });

    it('should store description if provided', () => {
      @Workflow({ name: 'test-workflow', description: 'Test workflow description' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.description).toBe('Test workflow description');
    });
  });

  describe('run() Method Validation', () => {
    it('should validate run() method exists', () => {
      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run() {
          return 'success';
        }
      }

      expect(isWorkflow(TestWorkflow)).toBe(true);
    });

    it('should throw error if run() method is missing', () => {
      expect(() => {
        @Workflow({ name: 'invalid-workflow' })
        class InvalidWorkflow {
          // No run() method
        }
      }).toThrow(DecoratorError);
    });

    it('should throw error if run() is not a function', () => {
      expect(() => {
        @Workflow({ name: 'invalid-workflow' })
        class InvalidWorkflow {
          run = 'not a function'; // Property, not method
        }
      }).toThrow(DecoratorError);
    });

    it('should accept async run() method', () => {
      @Workflow({ name: 'async-workflow' })
      class AsyncWorkflow {
        async run() {
          return Promise.resolve('async result');
        }
      }

      expect(isWorkflow(AsyncWorkflow)).toBe(true);
    });

    it('should accept run() method returning Promise', () => {
      @Workflow({ name: 'promise-workflow' })
      class PromiseWorkflow {
        run() {
          return Promise.resolve('promise result');
        }
      }

      expect(isWorkflow(PromiseWorkflow)).toBe(true);
    });

    it('should include helpful error message when run() is missing', () => {
      expect(() => {
        @Workflow({ name: 'invalid' })
        class InvalidWorkflow {}
      }).toThrow(/requires InvalidWorkflow to have a run\(\) method/);
    });
  });

  describe('Options Validation', () => {
    it('should require name option', () => {
      expect(() => {
        @Workflow({} as any)
        class TestWorkflow {
          async run() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should throw error if name is empty string', () => {
      expect(() => {
        @Workflow({ name: '' })
        class TestWorkflow {
          async run() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should throw error if name is whitespace only', () => {
      expect(() => {
        @Workflow({ name: '   ' })
        class TestWorkflow {
          async run() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should accept workflow with only name', () => {
      @Workflow({ name: 'simple-workflow' })
      class SimpleWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(SimpleWorkflow);
      expect(metadata?.name).toBe('simple-workflow');
      expect(metadata?.version).toBe('1.0');
      expect(metadata?.description).toBeUndefined();
      expect(metadata?.timeout).toBeUndefined();
    });
  });

  describe('Metadata Storage', () => {
    it('should store complete metadata', () => {
      @Workflow({
        name: 'full-workflow',
        version: '2.0',
        description: 'A complete workflow',
        timeout: 120000,
      })
      class FullWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(FullWorkflow);
      expect(metadata).toEqual({
        name: 'full-workflow',
        version: '2.0',
        description: 'A complete workflow',
        workflowClass: FullWorkflow,
        timeout: 120000,
      });
    });

    it('should store workflow class reference', () => {
      @Workflow({ name: 'test-workflow' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.workflowClass).toBe(TestWorkflow);
    });

    it('should store metadata in GlobalRegistry', () => {
      @Workflow({ name: 'registry-workflow' })
      class RegistryWorkflow {
        async run() {}
      }

      const metadata = registry.getWorkflow('registry-workflow');
      expect(metadata?.name).toBe('registry-workflow');
      expect(metadata?.workflowClass).toBe(RegistryWorkflow);
    });
  });

  describe('Multiple Workflows', () => {
    it('should register multiple workflows', () => {
      @Workflow({ name: 'workflow-1' })
      class Workflow1 {
        async run() {}
      }

      @Workflow({ name: 'workflow-2' })
      class Workflow2 {
        async run() {}
      }

      expect(registry.hasWorkflow('workflow-1')).toBe(true);
      expect(registry.hasWorkflow('workflow-2')).toBe(true);
    });

    it('should keep workflows separate in registry', () => {
      @Workflow({ name: 'workflow-a', version: '1.0' })
      class WorkflowA {
        async run() {}
      }

      @Workflow({ name: 'workflow-b', version: '2.0' })
      class WorkflowB {
        async run() {}
      }

      const metadataA = registry.getWorkflow('workflow-a');
      const metadataB = registry.getWorkflow('workflow-b');

      expect(metadataA?.version).toBe('1.0');
      expect(metadataB?.version).toBe('2.0');
      expect(metadataA?.workflowClass).toBe(WorkflowA);
      expect(metadataB?.workflowClass).toBe(WorkflowB);
    });
  });

  describe('Helper Functions', () => {
    it('isWorkflow() should return true for decorated classes', () => {
      @Workflow({ name: 'test' })
      class TestWorkflow {
        async run() {}
      }

      expect(isWorkflow(TestWorkflow)).toBe(true);
    });

    it('isWorkflow() should return false for non-decorated classes', () => {
      class NotAWorkflow {
        async run() {}
      }

      expect(isWorkflow(NotAWorkflow)).toBe(false);
    });

    it('isWorkflow() should return false for null/undefined', () => {
      expect(isWorkflow(null)).toBe(false);
      expect(isWorkflow(undefined)).toBe(false);
    });

    it('isWorkflow() should return false for non-classes', () => {
      expect(isWorkflow({})).toBe(false);
      expect(isWorkflow('string')).toBe(false);
      expect(isWorkflow(123)).toBe(false);
    });

    it('getWorkflowMetadata() should return metadata for decorated classes', () => {
      @Workflow({ name: 'test', version: '1.5' })
      class TestWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('test');
      expect(metadata?.version).toBe('1.5');
    });

    it('getWorkflowMetadata() should return undefined for non-workflows', () => {
      class NotAWorkflow {}

      expect(getWorkflowMetadata(NotAWorkflow)).toBeUndefined();
    });

    it('getWorkflowName() should return workflow name', () => {
      @Workflow({ name: 'my-workflow' })
      class MyWorkflow {
        async run() {}
      }

      expect(getWorkflowName(MyWorkflow)).toBe('my-workflow');
    });

    it('getWorkflowName() should return undefined for non-workflows', () => {
      class NotAWorkflow {}

      expect(getWorkflowName(NotAWorkflow)).toBeUndefined();
    });

    it('getWorkflowVersion() should return workflow version', () => {
      @Workflow({ name: 'my-workflow', version: '3.0' })
      class MyWorkflow {
        async run() {}
      }

      expect(getWorkflowVersion(MyWorkflow)).toBe('3.0');
    });

    it('getWorkflowVersion() should return default version if not specified', () => {
      @Workflow({ name: 'my-workflow' })
      class MyWorkflow {
        async run() {}
      }

      expect(getWorkflowVersion(MyWorkflow)).toBe('1.0');
    });

    it('getWorkflowVersion() should return undefined for non-workflows', () => {
      class NotAWorkflow {}

      expect(getWorkflowVersion(NotAWorkflow)).toBeUndefined();
    });
  });

  describe('Error Cases', () => {
    it('should throw error for non-class target', () => {
      const obj = {};

      expect(() => {
        Workflow({ name: 'test' })(obj as any);
      }).toThrow(DecoratorError);
    });

    it('should throw DecoratorError for missing run() method', () => {
      expect(() => {
        @Workflow({ name: 'invalid' })
        class InvalidWorkflow {}
      }).toThrow(DecoratorError);
    });

    it('should throw error for missing name', () => {
      expect(() => {
        @Workflow({} as any)
        class TestWorkflow {
          async run() {}
        }
      }).toThrow(DecoratorError);
    });

    it('should provide clear error messages', () => {
      expect(() => {
        @Workflow({ name: 'invalid' })
        class InvalidWorkflow {}
      }).toThrow(/requires InvalidWorkflow to have a run\(\) method/);
    });

    it('should include usage example in error message', () => {
      expect(() => {
        @Workflow({} as any)
        class TestWorkflow {
          async run() {}
        }
      }).toThrow(/Usage: @Workflow/);
    });
  });

  describe('Integration with Registry', () => {
    it('should be retrievable from registry by name', () => {
      @Workflow({ name: 'registry-test' })
      class RegistryTestWorkflow {
        async run() {}
      }

      const metadata = registry.getWorkflow('registry-test');
      expect(metadata).toBeDefined();
      expect(metadata?.workflowClass).toBe(RegistryTestWorkflow);
    });

    it('should update registry statistics', () => {
      const statsBefore = registry.getStats();

      @Workflow({ name: 'stats-workflow' })
      class StatsWorkflow {
        async run() {}
      }

      const statsAfter = registry.getStats();
      expect(statsAfter.workflows).toBe(statsBefore.workflows + 1);
    });

    it('getAllWorkflows() should include decorated workflow', () => {
      @Workflow({ name: 'all-workflows-test' })
      class AllWorkflowsTest {
        async run() {}
      }

      const allWorkflows = registry.getAllWorkflows();
      expect(allWorkflows.has('all-workflows-test')).toBe(true);
    });

    it('hasWorkflow() should return true for registered workflow', () => {
      @Workflow({ name: 'has-workflow-test' })
      class HasWorkflowTest {
        async run() {}
      }

      expect(registry.hasWorkflow('has-workflow-test')).toBe(true);
    });

    it('clear() should remove workflow from registry', () => {
      @Workflow({ name: 'clear-test' })
      class ClearTest {
        async run() {}
      }

      expect(registry.hasWorkflow('clear-test')).toBe(true);

      registry.clear();

      expect(registry.hasWorkflow('clear-test')).toBe(false);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should support payment workflow pattern', () => {
      @Workflow({
        name: 'payment-workflow',
        version: '1.0',
        timeout: 60000,
        description: 'Process payment with validation and confirmation',
      })
      class PaymentWorkflow {
        async run(ctx: any, input: any): Promise<any> {
          // A real workflow would call tasks here.
          return { success: true, paymentId: 'pay_123' };
        }
      }

      expect(isWorkflow(PaymentWorkflow)).toBe(true);
      const metadata = getWorkflowMetadata(PaymentWorkflow);
      expect(metadata?.name).toBe('payment-workflow');
      expect(metadata?.timeout).toBe(60000);
    });

    it('should support multi-step workflow', () => {
      @Workflow({ name: 'order-fulfillment', version: '2.0' })
      class OrderFulfillmentWorkflow {
        async run(ctx: any, input: any): Promise<any> {
          // A real workflow would validate the order, reserve inventory, take payment and
          // create the shipment, in that order.
          return { orderId: input.id, status: 'fulfilled' };
        }
      }

      expect(isWorkflow(OrderFulfillmentWorkflow)).toBe(true);
      expect(getWorkflowVersion(OrderFulfillmentWorkflow)).toBe('2.0');
    });

    it('should support workflow with error handling', () => {
      @Workflow({ name: 'resilient-workflow' })
      class ResilientWorkflow {
        async run(ctx: any, input: any): Promise<any> {
          try {
            // Execute tasks
            return { success: true };
          } catch (error) {
            // Workflow-level error handling
            return { success: false, error };
          }
        }
      }

      expect(isWorkflow(ResilientWorkflow)).toBe(true);
    });

    it('should support workflow with conditional logic', () => {
      @Workflow({ name: 'conditional-workflow' })
      class ConditionalWorkflow {
        async run(ctx: any, input: any): Promise<any> {
          if (input.priority === 'high') {
            // Execute high-priority path
            return { path: 'high-priority' };
          } else {
            // Execute normal path
            return { path: 'normal' };
          }
        }
      }

      expect(isWorkflow(ConditionalWorkflow)).toBe(true);
    });

    it('should support workflow without dependencies (correct pattern)', () => {
      // The correct pattern: a workflow takes no constructor dependencies.
      @Workflow({ name: 'no-deps-workflow' })
      class NoDepsWorkflow {
        async run(ctx: any, input: any): Promise<any> {
          // A workflow uses only ctx and task references.
          return { success: true };
        }
      }

      expect(isWorkflow(NoDepsWorkflow)).toBe(true);
      // A workflow must be constructible without the container.
      const instance = new NoDepsWorkflow();
      expect(instance).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle workflow with only required options', () => {
      @Workflow({ name: 'minimal' })
      class MinimalWorkflow {
        async run() {}
      }

      const metadata = getWorkflowMetadata(MinimalWorkflow);
      expect(metadata?.name).toBe('minimal');
      expect(metadata?.version).toBe('1.0');
      expect(metadata?.description).toBeUndefined();
      expect(metadata?.timeout).toBeUndefined();
    });

    it('should handle workflow with static methods', () => {
      @Workflow({ name: 'static-methods' })
      class StaticMethodsWorkflow {
        static helper() {
          return 'helper';
        }

        async run() {
          return StaticMethodsWorkflow.helper();
        }
      }

      expect(isWorkflow(StaticMethodsWorkflow)).toBe(true);
    });

    it('should handle workflow with private methods', () => {
      @Workflow({ name: 'private-methods' })
      class PrivateMethodsWorkflow {
        private helper() {
          return 'helper';
        }

        async run() {
          return this.helper();
        }
      }

      expect(isWorkflow(PrivateMethodsWorkflow)).toBe(true);
    });

    it('should handle workflow with properties', () => {
      @Workflow({ name: 'with-properties' })
      class WithPropertiesWorkflow {
        private counter = 0;

        async run() {
          this.counter++;
          return this.counter;
        }
      }

      expect(isWorkflow(WithPropertiesWorkflow)).toBe(true);
    });

    it('should handle workflow class extending another class', () => {
      class BaseWorkflow {
        protected helper() {
          return 'base';
        }
      }

      @Workflow({ name: 'extended' })
      class ExtendedWorkflow extends BaseWorkflow {
        async run() {
          return this.helper();
        }
      }

      expect(isWorkflow(ExtendedWorkflow)).toBe(true);
    });

    it('should preserve class name', () => {
      @Workflow({ name: 'preserve-name' })
      class MySpecialWorkflow {
        async run() {}
      }

      expect(MySpecialWorkflow.name).toBe('MySpecialWorkflow');
    });

    it('should handle duplicate workflow names (last one wins)', () => {
      @Workflow({ name: 'duplicate' })
      class Workflow1 {
        async run() {
          return '1';
        }
      }

      @Workflow({ name: 'duplicate' })
      class Workflow2 {
        async run() {
          return '2';
        }
      }

      const metadata = registry.getWorkflow('duplicate');
      expect(metadata?.workflowClass).toBe(Workflow2);
    });
  });

  describe('Type Safety', () => {
    it('should preserve run() method functionality', () => {
      @Workflow({ name: 'functional' })
      class FunctionalWorkflow {
        async run(ctx: any, input: string): Promise<string> {
          return input.toUpperCase();
        }
      }

      const instance = new FunctionalWorkflow();
      expect(instance.run({}, 'test')).resolves.toBe('TEST');
    });

    it('should allow workflow to be instantiated', () => {
      @Workflow({ name: 'instantiable' })
      class InstantiableWorkflow {
        async run() {
          return 'success';
        }
      }

      const instance = new InstantiableWorkflow();
      expect(instance).toBeInstanceOf(InstantiableWorkflow);
      expect(instance.run()).resolves.toBe('success');
    });

    it('should not interfere with class methods', () => {
      @Workflow({ name: 'methods' })
      class MethodsWorkflow {
        helper() {
          return 'helper';
        }

        async run() {
          return this.helper();
        }
      }

      const instance = new MethodsWorkflow();
      expect(instance.helper()).toBe('helper');
    });
  });
});
