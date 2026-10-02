/**
 * Tests for GlobalRegistry actor and operation registration.
 * @packageDocumentation
 */

import { GlobalRegistry } from '../registry';
import type { ActorMetadata, OperationMetadata, Type } from '../types';

describe('GlobalRegistry - Actor Support', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('Actor Registration', () => {
    it('should register an actor', () => {
      class MyActor {}
      const metadata: ActorMetadata = { name: 'MyActor', actorClass: MyActor };

      registry.registerActor('MyActor', metadata);

      expect(registry.hasActor('MyActor')).toBe(true);
    });

    it('should get actor by name', () => {
      class MyActor {}
      const metadata: ActorMetadata = { name: 'MyActor', actorClass: MyActor };

      registry.registerActor('MyActor', metadata);

      const result = registry.getActor('MyActor');
      expect(result).toEqual(metadata);
      expect(result?.actorClass).toBe(MyActor);
    });

    it('should return undefined for unregistered actor', () => {
      expect(registry.getActor('NonExistent')).toBeUndefined();
    });

    it('should check if actor exists with hasActor', () => {
      class MyActor {}
      registry.registerActor('MyActor', { name: 'MyActor', actorClass: MyActor });

      expect(registry.hasActor('MyActor')).toBe(true);
      expect(registry.hasActor('Other')).toBe(false);
    });

    it('should get all actors as a copy', () => {
      class ActorA {}
      class ActorB {}

      registry.registerActor('ActorA', { name: 'ActorA', actorClass: ActorA });
      registry.registerActor('ActorB', { name: 'ActorB', actorClass: ActorB });

      const all1 = registry.getAllActors();
      const all2 = registry.getAllActors();

      expect(all1.size).toBe(2);
      expect(all1).not.toBe(all2);
      expect(all1).toEqual(all2);
    });

    it('should overwrite existing actor with warning', () => {
      class MyActor {}
      const metadata1: ActorMetadata = { name: 'MyActor', actorClass: MyActor };
      const metadata2: ActorMetadata = { name: 'MyActor', actorClass: MyActor };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerActor('MyActor', metadata1);
      registry.registerActor('MyActor', metadata2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"MyActor" is already registered')
      );
      expect(registry.getActor('MyActor')).toEqual(metadata2);

      warnSpy.mockRestore();
    });
  });

  describe('Operation Registration', () => {
    class TestActor {}

    it('should register an operation', () => {
      const metadata: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };

      registry.registerOperation('addItem', TestActor, metadata);

      expect(registry.hasOperation('TestActor', 'addItem')).toBe(true);
    });

    it('should get operation by actor and operation name', () => {
      const metadata: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };

      registry.registerOperation('addItem', TestActor, metadata);

      const result = registry.getOperation('TestActor', 'addItem');
      expect(result).toEqual(metadata);
    });

    it('should return undefined for unregistered operation', () => {
      expect(registry.getOperation('TestActor', 'nonExistent')).toBeUndefined();
    });

    it('should check if operation exists with hasOperation', () => {
      const metadata: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };

      registry.registerOperation('addItem', TestActor, metadata);

      expect(registry.hasOperation('TestActor', 'addItem')).toBe(true);
      expect(registry.hasOperation('TestActor', 'removeItem')).toBe(false);
    });

    it('should get all operations as a copy', () => {
      const meta1: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };
      const meta2: OperationMetadata = {
        name: 'getTotal',
        actorClass: TestActor,
        methodName: 'getTotal',
        mode: 'shared',
      };

      registry.registerOperation('addItem', TestActor, meta1);
      registry.registerOperation('getTotal', TestActor, meta2);

      const all1 = registry.getAllOperations();
      const all2 = registry.getAllOperations();

      expect(all1.size).toBe(2);
      expect(all1).not.toBe(all2);
      expect(all1).toEqual(all2);
    });

    it('should overwrite existing operation with warning', () => {
      const meta1: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };
      const meta2: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItemV2',
        mode: 'exclusive',
      };

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      registry.registerOperation('addItem', TestActor, meta1);
      registry.registerOperation('addItem', TestActor, meta2);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"TestActor.addItem" is already registered')
      );
      expect(registry.getOperation('TestActor', 'addItem')).toEqual(meta2);

      warnSpy.mockRestore();
    });

    it('should key operations by "actorName.operationName"', () => {
      const metadata: OperationMetadata = {
        name: 'addItem',
        actorClass: TestActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };

      registry.registerOperation('addItem', TestActor, metadata);

      const all = registry.getAllOperations();
      expect(all.has('TestActor.addItem')).toBe(true);
    });

    it('should allow same operation name on different actors', () => {
      class ActorA {}
      class ActorB {}

      const metaA: OperationMetadata = {
        name: 'process',
        actorClass: ActorA,
        methodName: 'process',
        mode: 'exclusive',
      };
      const metaB: OperationMetadata = {
        name: 'process',
        actorClass: ActorB,
        methodName: 'process',
        mode: 'shared',
      };

      registry.registerOperation('process', ActorA, metaA);
      registry.registerOperation('process', ActorB, metaB);

      expect(registry.hasOperation('ActorA', 'process')).toBe(true);
      expect(registry.hasOperation('ActorB', 'process')).toBe(true);
      expect(registry.getOperation('ActorA', 'process')?.mode).toBe('exclusive');
      expect(registry.getOperation('ActorB', 'process')?.mode).toBe('shared');
    });
  });

  describe('getOperationsForActor', () => {
    it('should return all operations for an actor', () => {
      class MyActor {}

      const meta1: OperationMetadata = {
        name: 'addItem',
        actorClass: MyActor,
        methodName: 'addItem',
        mode: 'exclusive',
      };
      const meta2: OperationMetadata = {
        name: 'getTotal',
        actorClass: MyActor,
        methodName: 'getTotal',
        mode: 'shared',
      };

      registry.registerOperation('addItem', MyActor, meta1);
      registry.registerOperation('getTotal', MyActor, meta2);

      const ops = registry.getOperationsForActor('MyActor');
      expect(ops).toHaveLength(2);
      expect(ops.map((o) => o.name).sort()).toEqual(['addItem', 'getTotal']);
    });

    it('should return empty array for unknown actor', () => {
      expect(registry.getOperationsForActor('Unknown')).toEqual([]);
    });

    it('should not return operations from other actors', () => {
      class ActorA {}
      class ActorB {}

      registry.registerOperation(
        'opA',
        ActorA,
        { name: 'opA', actorClass: ActorA, methodName: 'opA', mode: 'exclusive' }
      );
      registry.registerOperation(
        'opB',
        ActorB,
        { name: 'opB', actorClass: ActorB, methodName: 'opB', mode: 'exclusive' }
      );

      const opsA = registry.getOperationsForActor('ActorA');
      expect(opsA).toHaveLength(1);
      expect(opsA[0].name).toBe('opA');
    });
  });

  describe('Clear', () => {
    it('should clear actors and operations', () => {
      class MyActor {}

      registry.registerActor('MyActor', { name: 'MyActor', actorClass: MyActor });
      registry.registerOperation(
        'op',
        MyActor,
        { name: 'op', actorClass: MyActor, methodName: 'op', mode: 'exclusive' }
      );

      expect(registry.hasActor('MyActor')).toBe(true);
      expect(registry.hasOperation('MyActor', 'op')).toBe(true);

      registry.clear();

      expect(registry.hasActor('MyActor')).toBe(false);
      expect(registry.hasOperation('MyActor', 'op')).toBe(false);
    });

    it('should return empty maps after clear', () => {
      class MyActor {}

      registry.registerActor('MyActor', { name: 'MyActor', actorClass: MyActor });

      registry.clear();

      expect(registry.getAllActors().size).toBe(0);
      expect(registry.getAllOperations().size).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should include actors and operations in getStats', () => {
      class ActorA {}
      class ActorB {}

      registry.registerActor('ActorA', { name: 'ActorA', actorClass: ActorA });
      registry.registerActor('ActorB', { name: 'ActorB', actorClass: ActorB });
      registry.registerOperation(
        'op1',
        ActorA,
        { name: 'op1', actorClass: ActorA, methodName: 'op1', mode: 'exclusive' }
      );
      registry.registerOperation(
        'op2',
        ActorA,
        { name: 'op2', actorClass: ActorA, methodName: 'op2', mode: 'shared' }
      );
      registry.registerOperation(
        'op3',
        ActorB,
        { name: 'op3', actorClass: ActorB, methodName: 'op3', mode: 'exclusive' }
      );

      const stats = registry.getStats();
      expect(stats.actors).toBe(2);
      expect(stats.operations).toBe(3);
    });

    it('should return zero for empty registry', () => {
      const stats = registry.getStats();
      expect(stats.actors).toBe(0);
      expect(stats.operations).toBe(0);
    });
  });

  describe('Summary', () => {
    it('should include actors and operations in getSummary', () => {
      class MyActor {}

      registry.registerActor('MyActor', { name: 'MyActor', actorClass: MyActor });
      registry.registerOperation(
        'op',
        MyActor,
        { name: 'op', actorClass: MyActor, methodName: 'op', mode: 'exclusive' }
      );

      const summary = registry.getSummary();

      expect(summary).toContain('Actors: 1');
      expect(summary).toContain('Operations: 1');
    });
  });

  describe('Integration', () => {
    it('should work alongside tasks and workflows', () => {
      class MyService {}
      class MyHandler {}
      class MyWorkflow {}
      class MyActor {}

      registry.registerService(MyService, { token: MyService, scope: 'singleton' });
      registry.registerTaskHandler(MyHandler, { handlerClass: MyHandler });
      registry.registerTask('my.task', {
        taskName: 'my.task',
        handlerClass: MyHandler,
        methodName: 'run',
        options: {},
      });
      registry.registerWorkflow('my-workflow', {
        name: 'my-workflow',
        workflowClass: MyWorkflow,
        version: '1.0',
      });
      registry.registerActor('MyActor', { name: 'MyActor', actorClass: MyActor });
      registry.registerOperation(
        'doSomething',
        MyActor,
        { name: 'doSomething', actorClass: MyActor, methodName: 'doSomething', mode: 'exclusive' }
      );

      const stats = registry.getStats();
      expect(stats.services).toBe(1);
      expect(stats.taskHandlers).toBe(1);
      expect(stats.tasks).toBe(1);
      expect(stats.workflows).toBe(1);
      expect(stats.actors).toBe(1);
      expect(stats.operations).toBe(1);
    });

    it('should handle complex multi-actor scenario', () => {
      class ShoppingCart {}
      class UserProfile {}
      class Inventory {}

      // Register 3 actors with multiple operations
      registry.registerActor('ShoppingCart', { name: 'ShoppingCart', actorClass: ShoppingCart });
      registry.registerActor('UserProfile', { name: 'UserProfile', actorClass: UserProfile });
      registry.registerActor('Inventory', { name: 'Inventory', actorClass: Inventory });

      registry.registerOperation('addItem', ShoppingCart, {
        name: 'addItem', actorClass: ShoppingCart, methodName: 'addItem', mode: 'exclusive',
      });
      registry.registerOperation('getTotal', ShoppingCart, {
        name: 'getTotal', actorClass: ShoppingCart, methodName: 'getTotal', mode: 'shared',
      });
      registry.registerOperation('updateProfile', UserProfile, {
        name: 'updateProfile', actorClass: UserProfile, methodName: 'updateProfile', mode: 'exclusive',
      });
      registry.registerOperation('checkStock', Inventory, {
        name: 'checkStock', actorClass: Inventory, methodName: 'checkStock', mode: 'shared',
      });
      registry.registerOperation('reserve', Inventory, {
        name: 'reserve', actorClass: Inventory, methodName: 'reserve', mode: 'exclusive',
      });

      expect(registry.getAllActors().size).toBe(3);
      expect(registry.getAllOperations().size).toBe(5);
      expect(registry.getOperationsForActor('ShoppingCart')).toHaveLength(2);
      expect(registry.getOperationsForActor('UserProfile')).toHaveLength(1);
      expect(registry.getOperationsForActor('Inventory')).toHaveLength(2);
    });
  });
});
