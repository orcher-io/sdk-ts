/**
 * Tests for WorkflowContext Query Methods
 *
 * This file tests the query handling methods in WorkflowContext including:
 * - registerQueryHandler() - registering query handlers
 * - executeQuery() - executing queries
 * - hasQueryHandler() - checking handler existence
 * - getQueryNames() - listing registered queries
 * - Automatic queries (workflow_id, workflow_type, etc.)
 * - Integration with QueryManager
 */

import { WorkflowContext, WorkflowExecution } from '../workflow/context';
import { QueryError } from '../workflow/query';

describe('WorkflowContext Query Methods', () => {
  let ctx: WorkflowContext;
  let execution: WorkflowExecution;

  beforeEach(() => {
    execution = {
      workflowId: 'test-workflow-123',
      runId: 'test-run-456',
      workflowType: 'TestWorkflow',
      attempt: 1,
      namespace: 'default',
      taskQueue: 'test-queue',
    };

    ctx = new WorkflowContext(execution, false, '1.0.0', Date.now());
  });

  describe('registerQueryHandler', () => {
    it('should register a query handler', () => {
      expect(() => {
        ctx.registerQueryHandler('getStatus', () => 'active');
      }).not.toThrow();

      expect(ctx.hasQueryHandler('getStatus')).toBe(true);
    });

    it('should reject empty query name', () => {
      expect(() => {
        ctx.registerQueryHandler('', () => 'value');
      }).toThrow(QueryError);

      expect(() => {
        ctx.registerQueryHandler('', () => 'value');
      }).toThrow('Query name must be a non-empty string');
    });

    it('should reject invalid query names', () => {
      const invalidNames = [
        'invalid name',
        'query@name',
        'query/name',
      ];

      invalidNames.forEach(name => {
        expect(() => {
          ctx.registerQueryHandler(name, () => 'value');
        }).toThrow(QueryError);
      });
    });

    it('should accept valid query names', () => {
      const validNames = [
        'getStatus',
        'get_order_total',
        'order-status',
        'Query123',
      ];

      validNames.forEach(name => {
        expect(() => {
          ctx.registerQueryHandler(name, () => 'value');
        }).not.toThrow();
      });
    });

    it('should register multiple handlers', () => {
      ctx.registerQueryHandler('query1', () => 'value1');
      ctx.registerQueryHandler('query2', () => 'value2');
      ctx.registerQueryHandler('query3', () => 'value3');

      expect(ctx.hasQueryHandler('query1')).toBe(true);
      expect(ctx.hasQueryHandler('query2')).toBe(true);
      expect(ctx.hasQueryHandler('query3')).toBe(true);
    });

    it('should support handlers with different return types', () => {
      ctx.registerQueryHandler<string>('getString', () => 'text');
      ctx.registerQueryHandler<number>('getNumber', () => 42);
      ctx.registerQueryHandler<boolean>('getBoolean', () => true);
      ctx.registerQueryHandler<object>('getObject', () => ({ key: 'value' }));

      expect(ctx.executeQuery<string>('getString')).toBe('text');
      expect(ctx.executeQuery<number>('getNumber')).toBe(42);
      expect(ctx.executeQuery<boolean>('getBoolean')).toBe(true);
      expect(ctx.executeQuery<object>('getObject')).toEqual({ key: 'value' });
    });

    it('should register handler with options', () => {
      expect(() => {
        ctx.registerQueryHandler(
          'cachedQuery',
          () => 'value',
          { cacheTtl: 60000 }
        );
      }).not.toThrow();

      expect(ctx.hasQueryHandler('cachedQuery')).toBe(true);
    });

    it('should register handler with description', () => {
      expect(() => {
        ctx.registerQueryHandler(
          'describedQuery',
          () => 'value',
          { description: 'Returns the current status' }
        );
      }).not.toThrow();
    });
  });

  describe('executeQuery', () => {
    it('should execute registered query', () => {
      ctx.registerQueryHandler('getStatus', () => 'active');

      const result = ctx.executeQuery<string>('getStatus');
      expect(result).toBe('active');
    });

    it('should throw for non-existent query', () => {
      expect(() => {
        ctx.executeQuery('nonExistent');
      }).toThrow(QueryError);

      expect(() => {
        ctx.executeQuery('nonExistent');
      }).toThrow('Query handler not found: nonExistent');
    });

    it('should execute query with complex return type', () => {
      interface OrderStatus {
        orderId: string;
        status: string;
        total: number;
      }

      ctx.registerQueryHandler<OrderStatus>('getOrderStatus', () => ({
        orderId: '123',
        status: 'completed',
        total: 99.99,
      }));

      const result = ctx.executeQuery<OrderStatus>('getOrderStatus');
      expect(result.orderId).toBe('123');
      expect(result.status).toBe('completed');
      expect(result.total).toBe(99.99);
    });

    it('should execute query that accesses workflow state', () => {
      ctx.setState('orderTotal', 149.99);

      ctx.registerQueryHandler('getTotal', () => {
        return ctx.getState('orderTotal');
      });

      const result = ctx.executeQuery<number>('getTotal');
      expect(result).toBe(149.99);
    });

    it('should execute query that combines multiple state values', () => {
      ctx.setState('firstName', 'John');
      ctx.setState('lastName', 'Doe');

      ctx.registerQueryHandler('getFullName', () => {
        const first = ctx.getState('firstName');
        const last = ctx.getState('lastName');
        return `${first} ${last}`;
      });

      const result = ctx.executeQuery<string>('getFullName');
      expect(result).toBe('John Doe');
    });

    it('should support query caching', () => {
      let callCount = 0;
      ctx.registerQueryHandler('cachedQuery', () => {
        callCount++;
        return `call-${callCount}`;
      });

      // First execution
      const result1 = ctx.executeQuery('cachedQuery', { cacheTtl: 1000 });
      expect(result1).toBe('call-1');

      // Second execution - should use cached value
      const result2 = ctx.executeQuery('cachedQuery', { cacheTtl: 1000 });
      expect(result2).toBe('call-1');
      expect(callCount).toBe(1); // Handler called only once
    });
  });

  describe('hasQueryHandler', () => {
    it('should return false for non-existent handler', () => {
      expect(ctx.hasQueryHandler('doesNotExist')).toBe(false);
    });

    it('should return true for registered handler', () => {
      ctx.registerQueryHandler('exists', () => 'value');
      expect(ctx.hasQueryHandler('exists')).toBe(true);
    });

    it('should return true for automatic queries', () => {
      expect(ctx.hasQueryHandler('workflow_id')).toBe(true);
      expect(ctx.hasQueryHandler('workflow_type')).toBe(true);
      expect(ctx.hasQueryHandler('run_id')).toBe(true);
      expect(ctx.hasQueryHandler('workflow_info')).toBe(true);
    });

    it('should update after registration', () => {
      expect(ctx.hasQueryHandler('newQuery')).toBe(false);
      ctx.registerQueryHandler('newQuery', () => 'value');
      expect(ctx.hasQueryHandler('newQuery')).toBe(true);
    });
  });

  describe('getQueryNames', () => {
    it('should include automatic queries', () => {
      const names = ctx.getQueryNames();

      expect(names).toContain('workflow_id');
      expect(names).toContain('workflow_type');
      expect(names).toContain('run_id');
      expect(names).toContain('is_replaying');
      expect(names).toContain('attempt');
      expect(names).toContain('version');
      expect(names).toContain('namespace');
      expect(names).toContain('task_queue');
      expect(names).toContain('workflow_info');
    });

    it('should include custom registered queries', () => {
      ctx.registerQueryHandler('customQuery1', () => 'value1');
      ctx.registerQueryHandler('customQuery2', () => 'value2');

      const names = ctx.getQueryNames();
      expect(names).toContain('customQuery1');
      expect(names).toContain('customQuery2');
    });

    it('should return all queries (automatic + custom)', () => {
      ctx.registerQueryHandler('query1', () => 'value1');
      ctx.registerQueryHandler('query2', () => 'value2');

      const names = ctx.getQueryNames();
      expect(names.length).toBeGreaterThanOrEqual(11); // 9 automatic + 2 custom
    });
  });

  describe('automatic queries', () => {
    it('should provide workflow_id query', () => {
      const workflowId = ctx.executeQuery<string>('workflow_id');
      expect(workflowId).toBe('test-workflow-123');
    });

    it('should provide workflow_type query', () => {
      const workflowType = ctx.executeQuery<string>('workflow_type');
      expect(workflowType).toBe('TestWorkflow');
    });

    it('should provide run_id query', () => {
      const runId = ctx.executeQuery<string>('run_id');
      expect(runId).toBe('test-run-456');
    });

    it('should provide is_replaying query', () => {
      const isReplaying = ctx.executeQuery<boolean>('is_replaying');
      expect(isReplaying).toBe(false);
    });

    it('should provide attempt query', () => {
      const attempt = ctx.executeQuery<number>('attempt');
      expect(attempt).toBe(1);
    });

    it('should provide version query', () => {
      const version = ctx.executeQuery<string>('version');
      expect(version).toBe('1.0.0');
    });

    it('should provide namespace query', () => {
      const namespace = ctx.executeQuery<string>('namespace');
      expect(namespace).toBe('default');
    });

    it('should provide task_queue query', () => {
      const taskQueue = ctx.executeQuery<string>('task_queue');
      expect(taskQueue).toBe('test-queue');
    });

    it('should provide workflow_info query', () => {
      const info = ctx.executeQuery<any>('workflow_info');

      expect(info.workflowId).toBe('test-workflow-123');
      expect(info.runId).toBe('test-run-456');
      expect(info.workflowType).toBe('TestWorkflow');
      expect(info.namespace).toBe('default');
      expect(info.taskQueue).toBe('test-queue');
      expect(info.attempt).toBe(1);
      expect(info.version).toBe('1.0.0');
      expect(info.isReplaying).toBe(false);
    });

    it('should update is_replaying when context is replaying', () => {
      const replayingCtx = new WorkflowContext(execution, true);
      const isReplaying = replayingCtx.executeQuery<boolean>('is_replaying');
      expect(isReplaying).toBe(true);
    });

    it('should update attempt in automatic queries', () => {
      const retryExecution: WorkflowExecution = {
        ...execution,
        attempt: 3,
      };
      const retryCtx = new WorkflowContext(retryExecution);

      const attempt = retryCtx.executeQuery<number>('attempt');
      expect(attempt).toBe(3);
    });
  });

  describe('integration scenarios', () => {
    it('should support workflow status query pattern', () => {
      // Workflow sets status in state
      ctx.setState('status', 'processing');
      ctx.setState('progress', 50);

      // Register status query
      ctx.registerQueryHandler('getStatus', () => ({
        status: ctx.getState('status'),
        progress: ctx.getState('progress'),
      }));

      const result = ctx.executeQuery<any>('getStatus');
      expect(result.status).toBe('processing');
      expect(result.progress).toBe(50);
    });

    it('should support order workflow query pattern', () => {
      ctx.setState('orderId', 'order-123');
      ctx.setState('status', 'pending');
      ctx.setState('items', ['item1', 'item2']);
      ctx.setState('total', 99.99);

      ctx.registerQueryHandler('getOrderDetails', () => ({
        orderId: ctx.getState('orderId'),
        status: ctx.getState('status'),
        items: ctx.getState('items'),
        total: ctx.getState('total'),
      }));

      const order = ctx.executeQuery<any>('getOrderDetails');
      expect(order.orderId).toBe('order-123');
      expect(order.items).toHaveLength(2);
    });

    it('should support multiple related queries', () => {
      ctx.setState('orderStatus', 'processing');
      ctx.setState('orderTotal', 149.99);
      ctx.setState('orderItems', ['item1', 'item2', 'item3']);

      ctx.registerQueryHandler('getStatus', () => ctx.getState('orderStatus'));
      ctx.registerQueryHandler('getTotal', () => ctx.getState('orderTotal'));
      ctx.registerQueryHandler('getItemCount', () => ctx.getState('orderItems').length);

      expect(ctx.executeQuery<string>('getStatus')).toBe('processing');
      expect(ctx.executeQuery<number>('getTotal')).toBe(149.99);
      expect(ctx.executeQuery<number>('getItemCount')).toBe(3);
    });

    it('should combine automatic and custom queries', () => {
      ctx.registerQueryHandler('getCustomData', () => 'custom-value');

      // Can query both automatic and custom
      const workflowId = ctx.executeQuery<string>('workflow_id');
      const customData = ctx.executeQuery<string>('getCustomData');

      expect(workflowId).toBe('test-workflow-123');
      expect(customData).toBe('custom-value');
    });

    it('should support computed queries', () => {
      ctx.setState('price', 100);
      ctx.setState('quantity', 3);
      ctx.setState('taxRate', 0.08);

      ctx.registerQueryHandler('getTotal', () => {
        const price = ctx.getState('price');
        const quantity = ctx.getState('quantity');
        const taxRate = ctx.getState('taxRate');
        const subtotal = price * quantity;
        const tax = subtotal * taxRate;
        return subtotal + tax;
      });

      const total = ctx.executeQuery<number>('getTotal');
      expect(total).toBe(324); // (100 * 3) * 1.08
    });
  });

  describe('type safety', () => {
    it('should support generic type parameters', () => {
      interface StatusData {
        status: string;
        updatedAt: string;
      }

      ctx.registerQueryHandler<StatusData>('getStatus', () => ({
        status: 'active',
        updatedAt: new Date().toISOString(),
      }));

      const result = ctx.executeQuery<StatusData>('getStatus');
      expect(typeof result.status).toBe('string');
      expect(typeof result.updatedAt).toBe('string');
    });

    it('should work with complex nested types', () => {
      interface OrderData {
        orderId: string;
        customer: {
          id: string;
          name: string;
        };
        items: Array<{
          id: string;
          quantity: number;
        }>;
      }

      ctx.registerQueryHandler<OrderData>('getOrder', () => ({
        orderId: '123',
        customer: {
          id: 'cust-456',
          name: 'John Doe',
        },
        items: [
          { id: 'item-1', quantity: 2 },
          { id: 'item-2', quantity: 1 },
        ],
      }));

      const order = ctx.executeQuery<OrderData>('getOrder');
      expect(order.customer.name).toBe('John Doe');
      expect(order.items).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should provide clear error for invalid query name', () => {
      try {
        ctx.registerQueryHandler('invalid name', () => 'value');
        fail('Should have thrown validation error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(QueryError);
        expect(err.message).toContain('Query name must contain only alphanumeric');
      }
    });

    it('should provide clear error for non-existent query', () => {
      try {
        ctx.executeQuery('doesNotExist');
        fail('Should have thrown error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(QueryError);
        expect(err.message).toContain('Query handler not found: doesNotExist');
      }
    });

    it('should wrap handler errors', () => {
      ctx.registerQueryHandler('errorQuery', () => {
        throw new Error('Handler error');
      });

      try {
        ctx.executeQuery('errorQuery');
        fail('Should have thrown error');
      } catch (err: any) {
        expect(err).toBeInstanceOf(QueryError);
        expect(err.message).toContain('Query execution failed');
        expect(err.message).toContain('Handler error');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very long query names (max 255)', () => {
      const longName = 'a'.repeat(255);

      expect(() => {
        ctx.registerQueryHandler(longName, () => 'value');
      }).not.toThrow();

      expect(ctx.hasQueryHandler(longName)).toBe(true);
    });

    it('should reject query names over 255 characters', () => {
      const tooLongName = 'a'.repeat(256);

      expect(() => {
        ctx.registerQueryHandler(tooLongName, () => 'value');
      }).toThrow(QueryError);
      expect(() => {
        ctx.registerQueryHandler(tooLongName, () => 'value');
      }).toThrow('Query name must not exceed 255 characters');
    });

    it('should handle queries returning null', () => {
      ctx.registerQueryHandler('getNullable', () => null);
      const result = ctx.executeQuery('getNullable');
      expect(result).toBeNull();
    });

    it('should handle queries returning undefined', () => {
      ctx.registerQueryHandler('getUndefined', () => undefined);
      const result = ctx.executeQuery('getUndefined');
      expect(result).toBeUndefined();
    });

    it('should handle rapid sequential query registrations', () => {
      for (let i = 0; i < 100; i++) {
        ctx.registerQueryHandler(`query${i}`, () => `value${i}`);
      }

      const names = ctx.getQueryNames();
      expect(names.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('metadata and context', () => {
    it('should maintain workflow metadata during query operations', () => {
      ctx.registerQueryHandler('test', () => 'value');
      ctx.executeQuery('test');

      // Metadata should still be accessible
      expect(ctx.workflowId()).toBe('test-workflow-123');
      expect(ctx.runId()).toBe('test-run-456');
      expect(ctx.workflowType()).toBe('TestWorkflow');
    });

    it('should maintain state during query operations', () => {
      ctx.setState('key', 'value');
      ctx.registerQueryHandler('test', () => 'query-value');
      ctx.executeQuery('test');

      // State should be preserved
      expect(ctx.getState('key')).toBe('value');
    });

    it('should not modify state during query execution', () => {
      ctx.setState('counter', 0);

      ctx.registerQueryHandler('getCounter', () => {
        // Queries should not modify state
        return ctx.getState('counter');
      });

      ctx.executeQuery('getCounter');
      ctx.executeQuery('getCounter');
      ctx.executeQuery('getCounter');

      // Counter should remain 0
      expect(ctx.getState('counter')).toBe(0);
    });
  });
});
