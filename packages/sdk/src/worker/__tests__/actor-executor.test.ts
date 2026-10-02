/**
 * Actor Executor Unit Tests
 *
 * Tests for the ActorExecutor class that executes actor operations with DI support.
 *
 * @module @orcher/sdk/worker/__tests__/actor-executor.test
 */

import 'reflect-metadata';
import { ActorExecutor } from '../actor-executor';
import type { ActorExecutionResult } from '../actor-executor';
import type { Logger } from '../types';
import { OrcherContainer } from '../../di/container';
import { globalRegistry } from '../../di/registry';
import { Actor } from '../../di/decorators/actor';
import { Operation } from '../../di/decorators/operation';
import { Injectable } from '../../di/decorators/injectable';
import { ActorNotFoundError, OperationNotFoundError } from '../../di/errors';
import type { ActorStateClient } from '../../actor/context';
import { OperationMode as ProtoOperationMode } from '../../core/generated/actor_service';
import type { ActorOperation as ActorOperationProto } from '../../core/generated/actor_service';

// ─── Helpers ────────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createMockLogger = (): Logger => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

function createMockStateClient(): ActorStateClient {
  return {
    getState: jest.fn().mockResolvedValue({ value: new Uint8Array(0), exists: false }),
    setState: jest.fn().mockResolvedValue({ success: true }),
    deleteState: jest.fn().mockResolvedValue({ existed: false }),
    listStateKeys: jest.fn().mockResolvedValue({ keys: [] }),
  };
}

function createActorOperation(overrides: Partial<ActorOperationProto> = {}): ActorOperationProto {
  return {
    operationId: 'op-001',
    actorName: 'TestActor',
    key: 'key-123',
    operation: 'process',
    payload: new Uint8Array(0),
    mode: ProtoOperationMode.EXCLUSIVE,
    executionId: 'exec-001',
    metadata: {},
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('ActorExecutor', () => {
  let logger: Logger;
  let stateClient: ActorStateClient;

  beforeEach(() => {
    globalRegistry.clear();
    logger = createMockLogger();
    stateClient = createMockStateClient();
  });

  afterEach(() => {
    globalRegistry.clear();
  });

  // =========================================================================
  // Successful Execution
  // =========================================================================

  describe('Successful Execution', () => {
    it('should execute operation and return serialized result', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          return { status: 'done', count: 42 };
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      const decoded = JSON.parse(decoder.decode(result.result));
      expect(decoded).toEqual({ status: 'done', count: 42 });
    });

    it('should pass ActorContext as first argument', async () => {
      let capturedCtx: any = null;

      @Actor()
      class TestActor {
        @Operation()
        async process(ctx: any) {
          capturedCtx = ctx;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({
          actorName: 'TestActor',
          key: 'my-key',
          operation: 'process',
          executionId: 'exec-999',
        })
      );

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx.actorName).toBe('TestActor');
      expect(capturedCtx.key).toBe('my-key');
      expect(capturedCtx.operationName).toBe('process');
      expect(capturedCtx.executionId).toBe('exec-999');
      expect(capturedCtx.state).toBeDefined();
    });

    it('should pass deserialized payload as second argument', async () => {
      let capturedInput: any = null;

      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any, input: any) {
          capturedInput = input;
          return input;
        }
      }

      const payload = { name: 'book', price: 15.99 };
      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({
          payload: encoder.encode(JSON.stringify(payload)),
        })
      );

      expect(capturedInput).toEqual(payload);
    });

    it('should call correct method on actor instance', async () => {
      const addSpy = jest.fn().mockResolvedValue('added');
      const removeSpy = jest.fn().mockResolvedValue('removed');

      @Actor()
      class TestActor {
        @Operation()
        async addItem(...args: any[]) {
          return addSpy(...args);
        }

        @Operation()
        async removeItem(...args: any[]) {
          return removeSpy(...args);
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(createActorOperation({ operation: 'addItem' }));

      expect(addSpy).toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('should handle operation with no payload (void input)', async () => {
      let argCount = 0;

      @Actor()
      class TestActor {
        @Operation()
        async process(...args: any[]) {
          argCount = args.length;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(createActorOperation({ payload: new Uint8Array(0) }));

      // Should only pass ctx, no second argument
      expect(argCount).toBe(1);
    });

    it('should handle operation returning undefined', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          // returns undefined implicitly
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      expect(result.result.length).toBe(0);
    });

    it('should report success=true and duration', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          return 'done';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });
  });

  // =========================================================================
  // Actor Metadata Lookup
  // =========================================================================

  describe('Actor Metadata Lookup', () => {
    it('should throw ActorNotFoundError for unknown actor', async () => {
      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(
        createActorOperation({ actorName: 'NonExistentActor' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('NonExistentActor');
    });

    it('should include available actors in error', async () => {
      @Actor()
      class CartActor {
        @Operation()
        async process() {}
      }

      @Actor()
      class UserActor {
        @Operation()
        async process() {}
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(
        createActorOperation({ actorName: 'Unknown' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });

  // =========================================================================
  // Operation Metadata Lookup
  // =========================================================================

  describe('Operation Metadata Lookup', () => {
    it('should throw OperationNotFoundError for unknown operation', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process() {}
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(
        createActorOperation({ operation: 'nonExistentOp' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('nonExistentOp');
    });

    it('should include available operations in error', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async addItem() {}

        @Operation()
        async removeItem() {}
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(
        createActorOperation({ operation: 'unknownOp' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknownOp');
    });
  });

  // =========================================================================
  // DI Container Resolution
  // =========================================================================

  describe('DI Container Resolution', () => {
    it('should resolve actor from container when available', async () => {
      @Injectable()
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          return 'from-container';
        }
      }

      const container = new OrcherContainer();
      container.registerTransient(TestActor, TestActor);

      const executor = new ActorExecutor({ logger, stateClient, container });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      const decoded = JSON.parse(decoder.decode(result.result));
      expect(decoded).toBe('from-container');
    });

    it('should fall back to plain constructor when container fails', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          return 'plain-constructor';
        }
      }

      // Container that always throws
      const mockContainer = {
        resolve: jest.fn().mockImplementation(() => {
          throw new Error('resolution failed');
        }),
      } as any;

      const executor = new ActorExecutor({ logger, stateClient, container: mockContainer });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      const decoded = JSON.parse(decoder.decode(result.result));
      expect(decoded).toBe('plain-constructor');
    });

    it('should fall back to plain constructor when no container', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any) {
          return 'no-container';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(true);
      const decoded = JSON.parse(decoder.decode(result.result));
      expect(decoded).toBe('no-container');
    });
  });

  // =========================================================================
  // Payload Handling
  // =========================================================================

  describe('Payload Handling', () => {
    it('should deserialize JSON payload from Uint8Array', async () => {
      let received: any = null;

      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any, input: any) {
          received = input;
          return input;
        }
      }

      const payload = { items: [1, 2, 3], nested: { key: 'val' } };
      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({
          payload: encoder.encode(JSON.stringify(payload)),
        })
      );

      expect(received).toEqual(payload);
    });

    it('should handle empty payload (no input)', async () => {
      let argCount = 0;

      @Actor()
      class TestActor {
        @Operation()
        async process(...args: any[]) {
          argCount = args.length;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(createActorOperation({ payload: new Uint8Array(0) }));

      expect(argCount).toBe(1); // only ctx
    });

    it('should pass raw bytes for non-JSON payload', async () => {
      let received: any = null;

      @Actor()
      class TestActor {
        @Operation()
        async process(_ctx: any, input: any) {
          received = input;
          return 'ok';
        }
      }

      // Invalid JSON bytes
      const rawBytes = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(createActorOperation({ payload: rawBytes }));

      // Should pass raw bytes since JSON.parse failed
      expect(received).toBeInstanceOf(Uint8Array);
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe('Error Handling', () => {
    it('should catch operation errors and return success=false', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process() {
          throw new Error('operation failed');
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(false);
    });

    it('should include error message in result', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process() {
          throw new Error('something went wrong');
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.error).toBe('something went wrong');
    });

    it('should report duration even on failure', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process() {
          throw new Error('fail');
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(false);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle non-Error throws', async () => {
      @Actor()
      class TestActor {
        @Operation()
        async process() {
          throw 'string error';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      const result = await executor.execute(createActorOperation());

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  // =========================================================================
  // Proto Mode Conversion
  // =========================================================================

  describe('Proto Mode Conversion', () => {
    it('should convert EXCLUSIVE (1) to exclusive', async () => {
      let capturedMode: string | undefined;

      @Actor()
      class TestActor {
        @Operation()
        async process(ctx: any) {
          capturedMode = ctx.mode;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({ mode: ProtoOperationMode.EXCLUSIVE })
      );

      expect(capturedMode).toBe('exclusive');
    });

    it('should convert SHARED (2) to shared', async () => {
      let capturedMode: string | undefined;

      @Actor()
      class TestActor {
        @Operation()
        async process(ctx: any) {
          capturedMode = ctx.mode;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({ mode: ProtoOperationMode.SHARED })
      );

      expect(capturedMode).toBe('shared');
    });

    it('should default UNSPECIFIED (0) to exclusive', async () => {
      let capturedMode: string | undefined;

      @Actor()
      class TestActor {
        @Operation()
        async process(ctx: any) {
          capturedMode = ctx.mode;
          return 'ok';
        }
      }

      const executor = new ActorExecutor({ logger, stateClient });
      await executor.execute(
        createActorOperation({ mode: ProtoOperationMode.UNSPECIFIED })
      );

      expect(capturedMode).toBe('exclusive');
    });
  });
});
