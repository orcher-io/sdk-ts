/**
 * Tests for Query Infrastructure
 *
 * This file tests the query handling infrastructure including:
 * - QueryManager (handler registration, execution, caching)
 * - QueryHelpers (validation, serialization)
 * - QueryError
 * - Query caching with TTL
 * - Query statistics
 */

import {
  QueryManager,
  QueryHelpers,
  QueryError,
  QueryHandler,
  QueryOptions,
  QueryResult,
} from '../workflow/query';

describe('QueryManager', () => {
  let manager: QueryManager;

  beforeEach(() => {
    manager = new QueryManager();
  });

  describe('registerHandler', () => {
    it('should register a query handler', () => {
      const handler: QueryHandler<string> = () => 'test-value';

      expect(() => {
        manager.registerHandler('testQuery', handler);
      }).not.toThrow();

      expect(manager.hasHandler('testQuery')).toBe(true);
    });

    it('should reject empty query name', () => {
      const handler = () => 'value';

      expect(() => {
        manager.registerHandler('', handler);
      }).toThrow(QueryError);

      expect(() => {
        manager.registerHandler('', handler);
      }).toThrow('Query name must be a non-empty string');
    });

    it('should reject whitespace-only query name', () => {
      const handler = () => 'value';

      expect(() => {
        manager.registerHandler('   ', handler);
      }).toThrow(QueryError);
    });

    it('should reject non-function handler', () => {
      expect(() => {
        manager.registerHandler('test', 'not a function' as any);
      }).toThrow(QueryError);

      expect(() => {
        manager.registerHandler('test', 'not a function' as any);
      }).toThrow('Query handler must be a function');
    });

    it('should register multiple handlers', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');
      manager.registerHandler('query3', () => 'value3');

      expect(manager.hasHandler('query1')).toBe(true);
      expect(manager.hasHandler('query2')).toBe(true);
      expect(manager.hasHandler('query3')).toBe(true);
    });

    it('should overwrite existing handler', () => {
      manager.registerHandler('query', () => 'old-value');
      manager.registerHandler('query', () => 'new-value');

      const result = manager.executeQuery('query');
      expect(result.value).toBe('new-value');
    });

    it('should support handlers with different return types', () => {
      manager.registerHandler<string>('getString', () => 'text');
      manager.registerHandler<number>('getNumber', () => 42);
      manager.registerHandler<boolean>('getBoolean', () => true);
      manager.registerHandler<object>('getObject', () => ({ key: 'value' }));

      expect(manager.executeQuery<string>('getString').value).toBe('text');
      expect(manager.executeQuery<number>('getNumber').value).toBe(42);
      expect(manager.executeQuery<boolean>('getBoolean').value).toBe(true);
      expect(manager.executeQuery<object>('getObject').value).toEqual({ key: 'value' });
    });
  });

  describe('executeQuery', () => {
    it('should execute registered handler', () => {
      manager.registerHandler('getStatus', () => 'active');

      const result = manager.executeQuery('getStatus');

      expect(result.name).toBe('getStatus');
      expect(result.value).toBe('active');
      expect(result.cached).toBe(false);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should throw for non-existent handler', () => {
      expect(() => {
        manager.executeQuery('nonExistent');
      }).toThrow(QueryError);

      expect(() => {
        manager.executeQuery('nonExistent');
      }).toThrow('Query handler not found: nonExistent');
    });

    it('should execute handler with complex return type', () => {
      interface OrderData {
        orderId: string;
        status: string;
        total: number;
        items: string[];
      }

      manager.registerHandler<OrderData>('getOrder', () => ({
        orderId: '123',
        status: 'completed',
        total: 99.99,
        items: ['item1', 'item2'],
      }));

      const result = manager.executeQuery<OrderData>('getOrder');
      expect(result.value.orderId).toBe('123');
      expect(result.value.items).toHaveLength(2);
    });

    it('should include timestamp in result', () => {
      manager.registerHandler('test', () => 'value');

      const beforeTime = Date.now();
      const result = manager.executeQuery('test');
      const afterTime = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(result.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should catch and wrap handler errors', () => {
      manager.registerHandler('errorQuery', () => {
        throw new Error('Handler error');
      });

      expect(() => {
        manager.executeQuery('errorQuery');
      }).toThrow(QueryError);

      expect(() => {
        manager.executeQuery('errorQuery');
      }).toThrow('Query execution failed: Handler error');
    });
  });

  describe('caching', () => {
    it('should cache query results when cacheTtl is set', () => {
      let callCount = 0;
      manager.registerHandler('cachedQuery', () => {
        callCount++;
        return `call-${callCount}`;
      });

      // First call - not cached
      const result1 = manager.executeQuery('cachedQuery', { cacheTtl: 1000 });
      expect(result1.value).toBe('call-1');
      expect(result1.cached).toBe(false);

      // Second call - should be cached
      const result2 = manager.executeQuery('cachedQuery', { cacheTtl: 1000 });
      expect(result2.value).toBe('call-1'); // Same value
      expect(result2.cached).toBe(true);
      expect(callCount).toBe(1); // Handler called only once
    });

    it('should not cache when cacheTtl is 0', () => {
      let callCount = 0;
      manager.registerHandler('noCacheQuery', () => {
        callCount++;
        return `call-${callCount}`;
      });

      const result1 = manager.executeQuery('noCacheQuery', { cacheTtl: 0 });
      const result2 = manager.executeQuery('noCacheQuery', { cacheTtl: 0 });

      expect(result1.value).toBe('call-1');
      expect(result2.value).toBe('call-2');
      expect(callCount).toBe(2);
    });

    it('should not cache when cacheTtl is not provided', () => {
      let callCount = 0;
      manager.registerHandler('query', () => {
        callCount++;
        return `call-${callCount}`;
      });

      manager.executeQuery('query');
      manager.executeQuery('query');

      expect(callCount).toBe(2);
    });

    it('should expire cache after TTL', async () => {
      let callCount = 0;
      manager.registerHandler('expiringQuery', () => {
        callCount++;
        return `call-${callCount}`;
      });

      // First call
      const result1 = manager.executeQuery('expiringQuery', { cacheTtl: 50 });
      expect(result1.value).toBe('call-1');
      expect(result1.cached).toBe(false);

      // Immediate second call - cached
      const result2 = manager.executeQuery('expiringQuery', { cacheTtl: 50 });
      expect(result2.value).toBe('call-1');
      expect(result2.cached).toBe(true);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Third call after expiry - not cached
      const result3 = manager.executeQuery('expiringQuery', { cacheTtl: 50 });
      expect(result3.value).toBe('call-2');
      expect(result3.cached).toBe(false);
      expect(callCount).toBe(2);
    });

    it('should cache different queries independently', () => {
      let count1 = 0;
      let count2 = 0;

      manager.registerHandler('query1', () => {
        count1++;
        return `q1-${count1}`;
      });

      manager.registerHandler('query2', () => {
        count2++;
        return `q2-${count2}`;
      });

      // Execute both with caching
      manager.executeQuery('query1', { cacheTtl: 1000 });
      manager.executeQuery('query2', { cacheTtl: 1000 });

      // Execute again
      const result1 = manager.executeQuery('query1', { cacheTtl: 1000 });
      const result2 = manager.executeQuery('query2', { cacheTtl: 1000 });

      expect(result1.value).toBe('q1-1');
      expect(result2.value).toBe('q2-1');
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  describe('clearCache', () => {
    it('should clear specific query cache', () => {
      let callCount = 0;
      manager.registerHandler('query', () => {
        callCount++;
        return `call-${callCount}`;
      });

      // Cache result
      manager.executeQuery('query', { cacheTtl: 1000 });
      expect(callCount).toBe(1);

      // Verify cached
      manager.executeQuery('query', { cacheTtl: 1000 });
      expect(callCount).toBe(1);

      manager.clearCache('query');

      // Execute again - not cached
      const result = manager.executeQuery('query', { cacheTtl: 1000 });
      expect(result.cached).toBe(false);
      expect(callCount).toBe(2);
    });

    it('should clear all cache when no name provided', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');

      // Cache both
      manager.executeQuery('query1', { cacheTtl: 1000 });
      manager.executeQuery('query2', { cacheTtl: 1000 });

      manager.clearCache();

      // Both should be uncached
      const result1 = manager.executeQuery('query1', { cacheTtl: 1000 });
      const result2 = manager.executeQuery('query2', { cacheTtl: 1000 });

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
    });
  });

  describe('hasHandler', () => {
    it('should return true for registered handler', () => {
      manager.registerHandler('exists', () => 'value');
      expect(manager.hasHandler('exists')).toBe(true);
    });

    it('should return false for non-existent handler', () => {
      expect(manager.hasHandler('doesNotExist')).toBe(false);
    });

    it('should return true after registration', () => {
      expect(manager.hasHandler('newQuery')).toBe(false);
      manager.registerHandler('newQuery', () => 'value');
      expect(manager.hasHandler('newQuery')).toBe(true);
    });
  });

  describe('getQueryNames', () => {
    it('should return empty array when no handlers', () => {
      expect(manager.getQueryNames()).toEqual([]);
    });

    it('should return all registered query names', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');
      manager.registerHandler('query3', () => 'value3');

      const names = manager.getQueryNames();
      expect(names).toContain('query1');
      expect(names).toContain('query2');
      expect(names).toContain('query3');
      expect(names).toHaveLength(3);
    });

    it('should not include duplicates', () => {
      manager.registerHandler('query', () => 'value1');
      manager.registerHandler('query', () => 'value2'); // Overwrite

      const names = manager.getQueryNames();
      expect(names).toEqual(['query']);
    });
  });

  describe('getStats', () => {
    it('should return empty stats initially', () => {
      const stats = manager.getStats();
      expect(stats.handlerCount).toBe(0);
      expect(stats.cacheSize).toBe(0);
      expect(stats.queryNames).toEqual([]);
    });

    it('should report handler count', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');

      const stats = manager.getStats();
      expect(stats.handlerCount).toBe(2);
    });

    it('should report cache size', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');

      manager.executeQuery('query1', { cacheTtl: 1000 });
      manager.executeQuery('query2', { cacheTtl: 1000 });

      const stats = manager.getStats();
      expect(stats.cacheSize).toBe(2);
    });

    it('should include query names', () => {
      manager.registerHandler('getStatus', () => 'active');
      manager.registerHandler('getTotal', () => 100);

      const stats = manager.getStats();
      expect(stats.queryNames).toContain('getStatus');
      expect(stats.queryNames).toContain('getTotal');
    });
  });

  describe('clear', () => {
    it('should clear all handlers and cache', () => {
      manager.registerHandler('query1', () => 'value1');
      manager.registerHandler('query2', () => 'value2');
      manager.executeQuery('query1', { cacheTtl: 1000 });

      manager.clear();

      const stats = manager.getStats();
      expect(stats.handlerCount).toBe(0);
      expect(stats.cacheSize).toBe(0);
      expect(stats.queryNames).toEqual([]);
    });
  });
});

describe('QueryHelpers', () => {
  describe('validateQueryName', () => {
    it('should accept valid query names', () => {
      const validNames = [
        'getStatus',
        'get_order_total',
        'order-status',
        'Query123',
        'QUERY_NAME',
      ];

      validNames.forEach(name => {
        expect(() => QueryHelpers.validateQueryName(name)).not.toThrow();
      });
    });

    it('should reject empty query name', () => {
      expect(() => QueryHelpers.validateQueryName('')).toThrow(QueryError);
      expect(() => QueryHelpers.validateQueryName('')).toThrow(
        'Query name must be a non-empty string'
      );
    });

    it('should reject whitespace-only query name', () => {
      expect(() => QueryHelpers.validateQueryName('   ')).toThrow(QueryError);
    });

    it('should reject query name exceeding 255 characters', () => {
      const longName = 'a'.repeat(256);
      expect(() => QueryHelpers.validateQueryName(longName)).toThrow(QueryError);
      expect(() => QueryHelpers.validateQueryName(longName)).toThrow(
        'Query name must not exceed 255 characters'
      );
    });

    it('should accept query name with exactly 255 characters', () => {
      const maxName = 'a'.repeat(255);
      expect(() => QueryHelpers.validateQueryName(maxName)).not.toThrow();
    });

    it('should reject query names with spaces', () => {
      expect(() => QueryHelpers.validateQueryName('invalid name')).toThrow(QueryError);
      expect(() => QueryHelpers.validateQueryName('invalid name')).toThrow(
        'Query name must contain only alphanumeric characters'
      );
    });

    it('should accept dotted query names', () => {
      expect(() => QueryHelpers.validateQueryName('order.status')).not.toThrow();
    });

    it('should reject query names with special characters', () => {
      const invalidNames = [
        'query@name',
        'query/name',
        'query\\name',
        'query!name',
        'query#name',
      ];

      invalidNames.forEach(name => {
        expect(() => QueryHelpers.validateQueryName(name)).toThrow(QueryError);
      });
    });
  });

  describe('createResult', () => {
    it('should create query result', () => {
      const result = QueryHelpers.createResult('testQuery', 'test-value');

      expect(result.name).toBe('testQuery');
      expect(result.value).toBe('test-value');
      expect(result.cached).toBe(false);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should create cached result', () => {
      const result = QueryHelpers.createResult('testQuery', 'value', true);
      expect(result.cached).toBe(true);
    });

    it('should include timestamp', () => {
      const beforeTime = Date.now();
      const result = QueryHelpers.createResult('query', 'value');
      const afterTime = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(result.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should handle complex values', () => {
      const complexValue = {
        nested: {
          data: [1, 2, 3],
          metadata: { key: 'value' },
        },
      };

      const result = QueryHelpers.createResult('query', complexValue);
      expect(result.value).toEqual(complexValue);
    });
  });

  describe('serialize', () => {
    it('should serialize query result to JSON', () => {
      const result: QueryResult<string> = {
        name: 'testQuery',
        value: 'test-value',
        cached: false,
        timestamp: 1234567890,
      };

      const serialized = QueryHelpers.serialize(result);
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('testQuery');
      expect(parsed.value).toBe('test-value');
      expect(parsed.cached).toBe(false);
      expect(parsed.timestamp).toBe(1234567890);
    });

    it('should serialize complex result values', () => {
      const result: QueryResult = {
        name: 'complexQuery',
        value: {
          orderId: '123',
          items: ['item1', 'item2'],
          total: 99.99,
        },
        cached: true,
        timestamp: Date.now(),
      };

      const serialized = QueryHelpers.serialize(result);
      const parsed = JSON.parse(serialized);

      expect(parsed.value.orderId).toBe('123');
      expect(parsed.value.items).toEqual(['item1', 'item2']);
    });
  });

  describe('deserialize', () => {
    it('should deserialize JSON to query result', () => {
      const json = JSON.stringify({
        name: 'testQuery',
        value: 'test-value',
        cached: false,
        timestamp: 1234567890,
      });

      const result = QueryHelpers.deserialize<string>(json);

      expect(result.name).toBe('testQuery');
      expect(result.value).toBe('test-value');
      expect(result.cached).toBe(false);
      expect(result.timestamp).toBe(1234567890);
    });

    it('should deserialize complex values', () => {
      const json = JSON.stringify({
        name: 'query',
        value: {
          orderId: '123',
          status: 'completed',
        },
        cached: true,
        timestamp: Date.now(),
      });

      const result = QueryHelpers.deserialize<{ orderId: string; status: string }>(json);
      expect(result.value.orderId).toBe('123');
      expect(result.value.status).toBe('completed');
    });

    it('should handle type parameter', () => {
      interface OrderData {
        orderId: string;
        total: number;
      }

      const json = JSON.stringify({
        name: 'getOrder',
        value: { orderId: '123', total: 99.99 },
        cached: false,
        timestamp: Date.now(),
      });

      const result = QueryHelpers.deserialize<OrderData>(json);
      expect(result.value.orderId).toBe('123');
      expect(result.value.total).toBe(99.99);
    });
  });

  describe('serialization round-trip', () => {
    it('should survive serialize-deserialize cycle', () => {
      const original: QueryResult<{ key: string; value: number }> = {
        name: 'testQuery',
        value: { key: 'test', value: 42 },
        cached: true,
        timestamp: 1234567890,
      };

      const serialized = QueryHelpers.serialize(original);
      const deserialized = QueryHelpers.deserialize<{ key: string; value: number }>(serialized);

      expect(deserialized).toEqual(original);
    });
  });
});

describe('QueryError', () => {
  it('should create query error with message and query name', () => {
    const error = new QueryError('Test error', 'testQuery');

    expect(error.message).toBe('Test error');
    expect(error.queryName).toBe('testQuery');
    expect(error.name).toBe('QueryError');
  });

  it('should include cause error', () => {
    const causeError = new Error('Original error');
    const error = new QueryError('Wrapped error', 'query', causeError);

    expect(error.cause).toBe(causeError);
  });

  it('should be instanceof Error', () => {
    const error = new QueryError('Error', 'query');
    expect(error).toBeInstanceOf(Error);
  });
});
