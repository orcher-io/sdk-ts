/**
 * Tests for the DI error classes, their codes and their messages.
 * @packageDocumentation
 */

import { OrcherContainer } from '../container';
import {
  DIError,
  DIErrorCode,
  DependencyNotFoundError,
  CircularDependencyError,
  DecoratorError,
  TaskNotFoundError,
  WorkflowNotFoundError,
  InvalidScopeError,
  LifecycleError,
  isDevelopment,
  getTokenName,
} from '../errors';
import type { OnInit, OnDestroy } from '../types';

describe('DI Error Handling - Comprehensive Tests', () => {
  let container: OrcherContainer;
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    container = new OrcherContainer();
  });

  afterEach(() => {
    container.clear();
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  describe('DIError Base Class', () => {
    it('should create error with code', () => {
      const error = new DIError(DIErrorCode.DEPENDENCY_NOT_FOUND, 'Test message');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DIError);
      expect(error.code).toBe(DIErrorCode.DEPENDENCY_NOT_FOUND);
      expect(error.message).toContain('[DI001]');
      expect(error.message).toContain('Test message');
    });

    it('should have correct error name', () => {
      const error = new DIError(DIErrorCode.CIRCULAR_DEPENDENCY, 'Test');
      expect(error.name).toBe('DIError');
    });

    it('should include error code in message', () => {
      const error = new DIError(DIErrorCode.DECORATOR_ERROR, 'Decorator misuse');
      expect(error.message).toMatch(/\[DI003\]/);
    });
  });

  describe('DependencyNotFoundError', () => {
    it('should be thrown when resolving unregistered dependency', () => {
      class UnregisteredService {}

      expect(() => {
        container.resolve(UnregisteredService);
      }).toThrow(DependencyNotFoundError);
    });

    it('should include token name in message', () => {
      class MyService {}

      try {
        container.resolve(MyService);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyNotFoundError);
        expect((error as Error).message).toContain('MyService');
      }
    });

    it('should include resolution chain', () => {
      class ServiceA {}
      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      try {
        container.resolve(ServiceB);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyNotFoundError);
        const depError = error as DependencyNotFoundError;
        expect(depError.resolutionChain).toBeDefined();
        expect(Array.isArray(depError.resolutionChain)).toBe(true);
      }
    });

    it('should include context when provided', () => {
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyNotFoundError);
        const depError = error as DependencyNotFoundError;
        expect(depError.token).toBe(TestService);
      }
    });

    it('should have correct error code', () => {
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyNotFoundError);
        expect((error as DependencyNotFoundError).code).toBe(DIErrorCode.DEPENDENCY_NOT_FOUND);
      }
    });

    it('should provide helpful suggestions in development', () => {
      process.env['NODE_ENV'] = 'development';
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('Possible solutions');
        expect(message).toContain('@Injectable()');
      }
    });

    it('should not include suggestions in production', () => {
      process.env['NODE_ENV'] = 'production';
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('Possible solutions');
      }
    });
  });

  describe('CircularDependencyError', () => {
    it('should be thrown for direct circular dependency', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      expect(() => {
        container.resolve(ServiceA);
      }).toThrow(CircularDependencyError);
    });

    it('should be thrown for indirect circular dependency', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public c: ServiceC) {}
      }

      class ServiceC {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceC)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceC,
        useFactory: (c) => new ServiceC(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      expect(() => {
        container.resolve(ServiceA);
      }).toThrow(CircularDependencyError);
    });

    it('should include cycle path in message', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      try {
        container.resolve(ServiceA);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError);
        const message = (error as Error).message;
        expect(message).toContain('ServiceA');
        expect(message).toContain('ServiceB');
        expect(message).toContain('→');
      }
    });

    it('should have correct error code', () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      try {
        container.resolve(ServiceA);
      } catch (error) {
        expect((error as CircularDependencyError).code).toBe(DIErrorCode.CIRCULAR_DEPENDENCY);
      }
    });

    it('should include solutions in development mode', () => {
      process.env['NODE_ENV'] = 'development';

      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      container.register({
        token: ServiceA,
        useFactory: (c) => new ServiceA(c.resolve(ServiceB)),
        scope: 'singleton',
      });
      container.register({
        token: ServiceB,
        useFactory: (c) => new ServiceB(c.resolve(ServiceA)),
        scope: 'singleton',
      });

      try {
        container.resolve(ServiceA);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('Possible solutions');
        expect(message).toContain('Extract shared logic');
      }
    });
  });

  describe('DecoratorError', () => {
    it('should create error with message', () => {
      const error = new DecoratorError('Invalid decorator usage');
      expect(error).toBeInstanceOf(DIError);
      expect(error.message).toContain('Invalid decorator usage');
    });

    it('should have correct error code', () => {
      const error = new DecoratorError('Test');
      expect(error.code).toBe(DIErrorCode.DECORATOR_ERROR);
    });

    describe('staticPropertyConflict', () => {
      it('should create error for static property conflict', () => {
        const error = DecoratorError.staticPropertyConflict('MyClass', 'myMethod');
        expect(error.message).toContain('MyClass.myMethod');
        expect(error.message).toContain('already exists');
      });

      it('should include solution in development', () => {
        process.env['NODE_ENV'] = 'development';
        const error = DecoratorError.staticPropertyConflict('MyClass', 'myMethod');
        expect(error.message).toContain('Solution');
        expect(error.message).toContain('Rename');
      });
    });

    describe('cannotApplyToNonClass', () => {
      it('should create error for non-class target', () => {
        const error = DecoratorError.cannotApplyToNonClass('Injectable');
        expect(error.message).toContain('@Injectable');
        expect(error.message).toContain('only be applied to classes');
      });

      it('should include help in development', () => {
        process.env['NODE_ENV'] = 'development';
        const error = DecoratorError.cannotApplyToNonClass('Tasks');
        expect(error.message).toContain('class definition');
      });
    });

    describe('cannotApplyToNonMethod', () => {
      it('should create error for non-method target', () => {
        const error = DecoratorError.cannotApplyToNonMethod('Task', 'myProperty');
        expect(error.message).toContain('@Task');
        expect(error.message).toContain('only be applied to methods');
        expect(error.message).toContain('myProperty');
      });

      it('should include help in development', () => {
        process.env['NODE_ENV'] = 'development';
        const error = DecoratorError.cannotApplyToNonMethod('Task', 'myProp');
        expect(error.message).toContain('async method');
      });
    });
  });

  describe('TaskNotFoundError', () => {
    it('should create error with task name', () => {
      const error = new TaskNotFoundError('payment.charge');
      expect(error.message).toContain('payment.charge');
      expect(error.taskName).toBe('payment.charge');
    });

    it('should have correct error code', () => {
      const error = new TaskNotFoundError('test.task');
      expect(error.code).toBe(DIErrorCode.TASK_NOT_FOUND);
    });

    it('should include available tasks in development', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new TaskNotFoundError('unknown.task', ['task.one', 'task.two', 'task.three']);
      expect(error.message).toContain('Available tasks');
      expect(error.message).toContain('task.one');
      expect(error.message).toContain('task.two');
    });

    it('should not include available tasks in production', () => {
      process.env['NODE_ENV'] = 'production';
      const error = new TaskNotFoundError('unknown.task', ['task.one', 'task.two']);
      expect(error.message).not.toContain('Available tasks');
    });
  });

  describe('WorkflowNotFoundError', () => {
    it('should create error with workflow name', () => {
      const error = new WorkflowNotFoundError('payment-workflow');
      expect(error.message).toContain('payment-workflow');
      expect(error.workflowName).toBe('payment-workflow');
    });

    it('should have correct error code', () => {
      const error = new WorkflowNotFoundError('test-workflow');
      // Its own code, not the one a missing task reports.
      expect(error.code).not.toBe(DIErrorCode.TASK_NOT_FOUND);
      expect(error.code).toBe('DI009');
      expect(error.message).toContain('[DI009]');
    });

    it('should include available workflows in development', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new WorkflowNotFoundError('unknown-workflow', ['workflow-a', 'workflow-b']);
      expect(error.message).toContain('Available workflows');
      expect(error.message).toContain('workflow-a');
    });
  });

  describe('InvalidScopeError', () => {
    it('should be thrown for invalid scope', () => {
      class TestService {}

      expect(() => {
        container.register({
          token: TestService,
          useClass: TestService,
          scope: 'invalid' as any,
        });
      }).toThrow(InvalidScopeError);
    });

    it('should include provided scope in message', () => {
      const error = new InvalidScopeError('invalid');
      expect(error.message).toContain('invalid');
      expect(error.providedScope).toBe('invalid');
    });

    it('should have correct error code', () => {
      const error = new InvalidScopeError('wrong');
      expect(error.code).toBe(DIErrorCode.INVALID_SCOPE);
    });

    it('should include valid scopes in development', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new InvalidScopeError('invalid');
      expect(error.message).toContain('Valid scopes');
      expect(error.message).toContain('singleton');
      expect(error.message).toContain('transient');
    });

    it('should explain scope meanings in development', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new InvalidScopeError('wrong');
      expect(error.message).toContain('One instance for entire application');
      expect(error.message).toContain('New instance each time');
    });
  });

  describe('LifecycleError', () => {
    it('should be thrown when onInit fails', () => {
      class TestService implements OnInit {
        onInit() {
          throw new Error('Init failed');
        }
      }

      container.registerSingleton(TestService);

      expect(() => {
        container.resolve(TestService);
      }).toThrow(LifecycleError);
    });

    it('should be thrown when onDestroy fails', async () => {
      class TestService implements OnDestroy {
        async onDestroy() {
          throw new Error('Destroy failed');
        }
      }

      container.registerSingleton(TestService);
      container.resolve(TestService);

      await expect(container.dispose()).rejects.toThrow(LifecycleError);
    });

    it('should include service name and hook name', () => {
      class MyService implements OnInit {
        onInit() {
          throw new Error('Failed');
        }
      }

      container.registerSingleton(MyService);

      try {
        container.resolve(MyService);
      } catch (error) {
        expect(error).toBeInstanceOf(LifecycleError);
        const lifecycleError = error as LifecycleError;
        expect(lifecycleError.serviceName).toContain('MyService');
        expect(lifecycleError.hook).toBe('onInit');
      }
    });

    it('should include original error', () => {
      class TestService implements OnInit {
        onInit() {
          throw new Error('Original error message');
        }
      }

      container.registerSingleton(TestService);

      try {
        container.resolve(TestService);
      } catch (error) {
        expect(error).toBeInstanceOf(LifecycleError);
        const lifecycleError = error as LifecycleError;
        expect(lifecycleError.originalError.message).toBe('Original error message');
      }
    });

    it('should have correct error code', () => {
      class TestService implements OnInit {
        onInit() {
          throw new Error('Failed');
        }
      }

      container.registerSingleton(TestService);

      try {
        container.resolve(TestService);
      } catch (error) {
        expect((error as LifecycleError).code).toBe(DIErrorCode.LIFECYCLE_ERROR);
      }
    });

    it('should include debug steps in development', () => {
      process.env['NODE_ENV'] = 'development';

      class TestService implements OnInit {
        onInit() {
          throw new Error('Failed');
        }
      }

      container.registerSingleton(TestService);

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('Debug steps');
        expect(message).toContain('Check');
        expect(message).toContain('Original stack');
      }
    });

    it('should not include debug steps in production', () => {
      process.env['NODE_ENV'] = 'production';

      class TestService implements OnInit {
        onInit() {
          throw new Error('Failed');
        }
      }

      container.registerSingleton(TestService);

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain('Debug steps');
      }
    });
  });

  describe('Helper Functions', () => {
    describe('isDevelopment', () => {
      it('should return true when NODE_ENV is not production', () => {
        process.env['NODE_ENV'] = 'development';
        expect(isDevelopment()).toBe(true);
      });

      it('should return true when NODE_ENV is not set', () => {
        delete process.env['NODE_ENV'];
        expect(isDevelopment()).toBe(true);
      });

      it('should return false when NODE_ENV is production', () => {
        process.env['NODE_ENV'] = 'production';
        expect(isDevelopment()).toBe(false);
      });
    });

    describe('getTokenName', () => {
      it('should return class name for classes', () => {
        class MyService {}
        expect(getTokenName(MyService)).toBe('MyService');
      });

      it('should return function name for named functions', () => {
        const anon = function namedFunc() {};
        expect(getTokenName(anon)).toBe('namedFunc');
      });

      it('should handle anonymous classes', () => {
        const Class = class {};
        const name = getTokenName(Class);
        // Should return some string (either empty or 'Anonymous')
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThanOrEqual(0);
      });

      it('should return symbol representation for symbols', () => {
        const sym = Symbol('test');
        expect(getTokenName(sym)).toContain('Symbol');
        expect(getTokenName(sym)).toContain('test');
      });

      it('should return string representation for strings', () => {
        expect(getTokenName('TOKEN')).toBe('TOKEN');
      });

      it('should return string representation for numbers', () => {
        expect(getTokenName(123)).toBe('123');
      });
    });
  });

  describe('DIErrorCode Enum', () => {
    it('should have correct error codes', () => {
      expect(DIErrorCode.DEPENDENCY_NOT_FOUND).toBe('DI001');
      expect(DIErrorCode.CIRCULAR_DEPENDENCY).toBe('DI002');
      expect(DIErrorCode.DECORATOR_ERROR).toBe('DI003');
      expect(DIErrorCode.TASK_NOT_FOUND).toBe('DI004');
      expect(DIErrorCode.LIFECYCLE_ERROR).toBe('DI005');
      expect(DIErrorCode.INVALID_SCOPE).toBe('DI006');
    });
  });

  describe('Error Message Quality', () => {
    it('should have actionable error messages', () => {
      process.env['NODE_ENV'] = 'development';
      class UnregisteredService {}

      try {
        container.resolve(UnregisteredService);
      } catch (error) {
        const message = (error as Error).message;
        // Should tell you what went wrong
        expect(message).toContain('Cannot resolve');
        // Should tell you how to fix it
        expect(message).toContain('Add @Injectable()');
        // Should provide context
        expect(message).toContain('UnregisteredService');
      }
    });

    it('should be concise in production', () => {
      process.env['NODE_ENV'] = 'production';
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        // Should be brief
        expect(message.length).toBeLessThan(200);
        // Should not include verbose help
        expect(message).not.toContain('Possible solutions');
      }
    });

    it('should include error codes for searchability', () => {
      class TestService {}

      try {
        container.resolve(TestService);
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toMatch(/\[DI\d{3}\]/);
      }
    });
  });
});
