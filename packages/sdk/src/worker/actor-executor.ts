/**
 * Runs actor operations: resolves the actor, builds its context, and serializes the result.
 *
 * It is the actor counterpart of the task executor.
 *
 * @module @orcher/sdk/worker/actor-executor
 */

import type { Logger } from './types';
import type { OrcherContainer } from '../di/container';
import { globalRegistry as diGlobalRegistry } from '../di/registry';
import { ActorContext } from '../actor/context';
import type { ActorExecution, ActorStateClient } from '../actor/context';
import type { ActorOperation as ActorOperationProto } from '../core/generated/actor_service';
import { OperationMode as ProtoOperationMode } from '../core/generated/actor_service';
import { ActorNotFoundError, OperationNotFoundError } from '../di/errors';
import type { OperationMode } from '../di/types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Actor executor configuration
 */
export interface ActorExecutorOptions {
  /** Logger instance */
  logger: Logger;

  /** DI container for resolving actor instances */
  container?: OrcherContainer;

  /** State client for server-backed state access */
  stateClient: ActorStateClient;
}

/**
 * Result of executing an actor operation
 */
export interface ActorExecutionResult {
  /** Serialized result as bytes */
  result: Uint8Array;
  /** Whether execution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Runs actor operations polled from the server.
 *
 * Each operation runs in this order:
 * 1. Look up the actor and operation metadata in the global registry.
 * 2. Create an ActorContext backed by server-side state.
 * 3. Resolve the actor instance from the DI container, falling back to its plain constructor.
 * 4. Deserialize the payload and call the operation method.
 * 5. Serialize the result to JSON bytes.
 *
 * Failures are returned as an unsuccessful {@link ActorExecutionResult}, never thrown.
 */
export class ActorExecutor {
  private readonly logger: Logger;
  private readonly container: OrcherContainer | null;
  private readonly stateClient: ActorStateClient;

  constructor(options: ActorExecutorOptions) {
    this.logger = options.logger;
    this.container = options.container ?? null;
    this.stateClient = options.stateClient;
  }

  /**
   * Execute an actor operation from a polled proto message
   *
   * The method receives the context and, when the payload is non-empty, the decoded input.
   * A payload that is not valid JSON is passed as raw bytes.
   *
   * @returns Execution result; failures are returned, not thrown
   */
  async execute(operation: ActorOperationProto): Promise<ActorExecutionResult> {
    const startTime = Date.now();
    const { actorName, key, operation: operationName, operationId, executionId } = operation;

    this.logger.info(
      `Executing actor operation: ${actorName}.${operationName} (key=${key}, id=${operationId})`
    );

    try {
      const actorMeta = diGlobalRegistry.getActor(actorName);
      if (!actorMeta) {
        const available = Array.from(diGlobalRegistry.getAllActors().keys());
        throw new ActorNotFoundError(actorName, available);
      }

      const operationMeta = diGlobalRegistry.getOperation(actorName, operationName);
      if (!operationMeta) {
        const availableOps = diGlobalRegistry
          .getOperationsForActor(actorName)
          .map((op) => op.name);
        throw new OperationNotFoundError(operationName, actorName, availableOps);
      }

      const mode = this.protoModeToMode(operation.mode);
      const execution: ActorExecution = {
        actorName,
        key,
        operationName,
        operationId,
        executionId,
        mode,
        metadata: operation.metadata,
      };
      const ctx = new ActorContext(execution, this.stateClient);

      const { actorClass } = actorMeta;
      let instance: any;

      if (this.container) {
        try {
          instance = this.container.resolve(actorClass);
        } catch {
          this.logger.debug(
            `DI resolution failed for ${actorName}, falling back to plain constructor`
          );
          instance = new actorClass();
        }
      } else {
        instance = new actorClass();
      }

      const { methodName } = operationMeta;
      const method = instance[methodName];
      if (typeof method !== 'function') {
        throw new Error(`Method ${methodName} not found on ${actorName}`);
      }

      let input: any;
      if (operation.payload.length > 0) {
        // Operations arrive from the native bridge as JSON, which encodes the
        // payload bytes as a base64 string (serde bytes to JSON). Decode it, or the
        // handler would receive the encoded form as its input. number[] and
        // Uint8Array payloads are accepted too.
        const raw = operation.payload as unknown;
        const payloadBytes =
          typeof raw === 'string'
            ? Buffer.from(raw, 'base64')
            : raw instanceof Uint8Array
              ? raw
              : Uint8Array.from(raw as ArrayLike<number>);
        try {
          input = JSON.parse(decoder.decode(payloadBytes));
        } catch {
          // Not valid JSON: a binary payload is passed as raw bytes.
          input = payloadBytes;
        }
      }

      let result: any;
      if (input !== undefined) {
        result = await method.call(instance, ctx, input);
      } else {
        result = await method.call(instance, ctx);
      }

      // An undefined result is sent as an empty payload.
      const resultBytes =
        result !== undefined ? encoder.encode(JSON.stringify(result)) : new Uint8Array(0);

      const duration = Date.now() - startTime;
      this.logger.info(
        `Actor operation completed: ${actorName}.${operationName} (key=${key}) in ${duration}ms`
      );

      return { result: resultBytes, success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Actor operation failed: ${actorName}.${operationName} (key=${key}) after ${duration}ms: ${errorMessage}`
      );

      return {
        result: new Uint8Array(0),
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Convert the proto OperationMode enum to the SDK OperationMode string
   *
   * Any mode other than SHARED, including an unrecognized one, maps to `exclusive`.
   */
  private protoModeToMode(protoMode: ProtoOperationMode): OperationMode {
    switch (protoMode) {
      case ProtoOperationMode.SHARED:
        return 'shared';
      case ProtoOperationMode.EXCLUSIVE:
      default:
        return 'exclusive';
    }
  }
}
