/**
 * Tests for ActorContext and ActorState
 * @packageDocumentation
 */

import { ActorContext, ActorState } from '../context';
import type { ActorStateClient, ActorExecution } from '../context';

// ─── Helpers ────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function createMockClient(): ActorStateClient {
  return {
    getState: jest.fn(),
    setState: jest.fn(),
    deleteState: jest.fn(),
    listStateKeys: jest.fn(),
  };
}

function createExecution(overrides: Partial<ActorExecution> = {}): ActorExecution {
  return {
    actorName: 'TestActor',
    key: 'test-key-123',
    operationName: 'testOp',
    operationId: 'op-001',
    executionId: 'exec-001',
    mode: 'exclusive',
    ...overrides,
  };
}

// ─── ActorState Tests ───────────────────────────────────────────────────────────

describe('ActorState', () => {
  let mockClient: ActorStateClient;
  let state: ActorState;

  beforeEach(() => {
    mockClient = createMockClient();
    state = new ActorState('TestActor', 'key-123', 'exec-001', mockClient);
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return deserialized value when key exists', async () => {
      const value = { items: ['book', 'pen'], total: 25 };
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(value)),
        exists: true,
      });

      const result = await state.get<typeof value>('cart');
      expect(result).toEqual(value);
    });

    it('should return undefined when key does not exist', async () => {
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: new Uint8Array(0),
        exists: false,
      });

      const result = await state.get('missing');
      expect(result).toBeUndefined();
    });

    it('should pass correct args to client.getState', async () => {
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: new Uint8Array(0),
        exists: false,
      });

      await state.get('myKey');

      expect(mockClient.getState).toHaveBeenCalledWith(
        'TestActor',
        'key-123',
        'myKey',
        'exec-001'
      );
    });

    it('should handle complex objects (nested JSON)', async () => {
      const complex = {
        user: { name: 'Alice', address: { city: 'NYC', zip: '10001' } },
        orders: [{ id: 1, items: [{ sku: 'A' }] }],
      };
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(complex)),
        exists: true,
      });

      const result = await state.get('profile');
      expect(result).toEqual(complex);
    });

    it('should handle arrays', async () => {
      const arr = [1, 2, 3, 'four', { five: 5 }];
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(arr)),
        exists: true,
      });

      const result = await state.get('list');
      expect(result).toEqual(arr);
    });

    it('should handle primitive types', async () => {
      // String
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify('hello')),
        exists: true,
      });
      expect(await state.get('str')).toBe('hello');

      // Number
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(42)),
        exists: true,
      });
      expect(await state.get('num')).toBe(42);

      // Boolean
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(true)),
        exists: true,
      });
      expect(await state.get('bool')).toBe(true);
    });

    it('should handle null', async () => {
      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify(null)),
        exists: true,
      });

      const result = await state.get('nullable');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe('set', () => {
    it('should serialize value and call client.setState', async () => {
      (mockClient.setState as jest.Mock).mockResolvedValue({ success: true });

      const value = { count: 5, name: 'test' };
      await state.set('data', value);

      expect(mockClient.setState).toHaveBeenCalledTimes(1);
      const [actorName, key, stateKey, bytes, execId] = (
        mockClient.setState as jest.Mock
      ).mock.calls[0];
      expect(actorName).toBe('TestActor');
      expect(key).toBe('key-123');
      expect(stateKey).toBe('data');
      expect(execId).toBe('exec-001');

      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded).toEqual(value);
    });

    it('should pass correct args to client.setState', async () => {
      (mockClient.setState as jest.Mock).mockResolvedValue({ success: true });

      await state.set('key', 'value');

      expect(mockClient.setState).toHaveBeenCalledWith(
        'TestActor',
        'key-123',
        'key',
        expect.any(Uint8Array),
        'exec-001'
      );
    });

    it('should throw when setState returns success=false', async () => {
      (mockClient.setState as jest.Mock).mockResolvedValue({ success: false });

      await expect(state.set('key', 'value')).rejects.toThrow('Failed to set state key');
    });

    it('should handle complex objects', async () => {
      (mockClient.setState as jest.Mock).mockResolvedValue({ success: true });

      const complex = {
        nested: { deep: { value: [1, 2, 3] } },
        arr: ['a', 'b'],
      };

      await state.set('complex', complex);

      const bytes = (mockClient.setState as jest.Mock).mock.calls[0][3] as Uint8Array;
      const decoded = JSON.parse(new TextDecoder().decode(bytes));
      expect(decoded).toEqual(complex);
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should call client.deleteState and return existed', async () => {
      (mockClient.deleteState as jest.Mock).mockResolvedValue({ existed: true });

      const result = await state.delete('myKey');

      expect(mockClient.deleteState).toHaveBeenCalledWith(
        'TestActor',
        'key-123',
        'myKey',
        'exec-001'
      );
      expect(result).toBe(true);
    });

    it('should return true when key existed', async () => {
      (mockClient.deleteState as jest.Mock).mockResolvedValue({ existed: true });
      expect(await state.delete('existing')).toBe(true);
    });

    it('should return false when key did not exist', async () => {
      (mockClient.deleteState as jest.Mock).mockResolvedValue({ existed: false });
      expect(await state.delete('missing')).toBe(false);
    });
  });

  // =========================================================================
  // listKeys
  // =========================================================================

  describe('listKeys', () => {
    it('should call client.listStateKeys and return keys', async () => {
      (mockClient.listStateKeys as jest.Mock).mockResolvedValue({
        keys: ['cart', 'profile', 'settings'],
      });

      const result = await state.listKeys();
      expect(result).toEqual(['cart', 'profile', 'settings']);
    });

    it('should pass prefix when provided', async () => {
      (mockClient.listStateKeys as jest.Mock).mockResolvedValue({ keys: ['cart:items'] });

      await state.listKeys('cart:');

      expect(mockClient.listStateKeys).toHaveBeenCalledWith(
        'TestActor',
        'key-123',
        'exec-001',
        'cart:'
      );
    });

    it('should pass undefined prefix when not provided', async () => {
      (mockClient.listStateKeys as jest.Mock).mockResolvedValue({ keys: [] });

      await state.listKeys();

      expect(mockClient.listStateKeys).toHaveBeenCalledWith(
        'TestActor',
        'key-123',
        'exec-001',
        undefined
      );
    });

    it('should return empty array when no keys', async () => {
      (mockClient.listStateKeys as jest.Mock).mockResolvedValue({ keys: [] });

      const result = await state.listKeys();
      expect(result).toEqual([]);
    });
  });
});

// ─── ActorContext Tests ─────────────────────────────────────────────────────────

describe('ActorContext', () => {
  let mockClient: ActorStateClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  // =========================================================================
  // Construction
  // =========================================================================

  describe('Construction', () => {
    it('should expose actorName, key, operationName, operationId, executionId, mode', () => {
      const execution = createExecution({
        actorName: 'ShoppingCart',
        key: 'user-456',
        operationName: 'addItem',
        operationId: 'op-789',
        executionId: 'exec-012',
        mode: 'exclusive',
      });

      const ctx = new ActorContext(execution, mockClient);

      expect(ctx.actorName).toBe('ShoppingCart');
      expect(ctx.key).toBe('user-456');
      expect(ctx.operationName).toBe('addItem');
      expect(ctx.operationId).toBe('op-789');
      expect(ctx.executionId).toBe('exec-012');
      expect(ctx.mode).toBe('exclusive');
    });

    it('should expose metadata (defaulting to empty object)', () => {
      const withMeta = new ActorContext(
        createExecution({ metadata: { tenant: 'acme' } }),
        mockClient
      );
      expect(withMeta.metadata).toEqual({ tenant: 'acme' });

      const withoutMeta = new ActorContext(createExecution(), mockClient);
      expect(withoutMeta.metadata).toEqual({});
    });

    it('should create ActorState instance as ctx.state', () => {
      const ctx = new ActorContext(createExecution(), mockClient);

      expect(ctx.state).toBeInstanceOf(ActorState);
    });

    it('should handle shared mode', () => {
      const ctx = new ActorContext(createExecution({ mode: 'shared' }), mockClient);
      expect(ctx.mode).toBe('shared');
    });
  });

  // =========================================================================
  // State Integration
  // =========================================================================

  describe('State Integration', () => {
    it('should delegate state operations to ActorState', async () => {
      const execution = createExecution({
        actorName: 'MyActor',
        key: 'key-1',
        executionId: 'exec-1',
      });

      (mockClient.getState as jest.Mock).mockResolvedValue({
        value: encoder.encode(JSON.stringify({ count: 42 })),
        exists: true,
      });
      (mockClient.setState as jest.Mock).mockResolvedValue({ success: true });
      (mockClient.deleteState as jest.Mock).mockResolvedValue({ existed: true });
      (mockClient.listStateKeys as jest.Mock).mockResolvedValue({ keys: ['count'] });

      const ctx = new ActorContext(execution, mockClient);

      // get
      const value = await ctx.state.get<{ count: number }>('count');
      expect(value).toEqual({ count: 42 });
      expect(mockClient.getState).toHaveBeenCalledWith('MyActor', 'key-1', 'count', 'exec-1');

      // set
      await ctx.state.set('count', { count: 43 });
      expect(mockClient.setState).toHaveBeenCalled();

      // delete
      const existed = await ctx.state.delete('count');
      expect(existed).toBe(true);

      // listKeys
      const keys = await ctx.state.listKeys();
      expect(keys).toEqual(['count']);
    });
  });
});
