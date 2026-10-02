/**
 * The context passed to every `@Operation()` method, and the server-backed
 * state API it exposes.
 *
 * @packageDocumentation
 */

import type { OperationMode } from '../di/types';

/**
 * Access to an actor's server-side state.
 *
 * Implementations call the ActorService state RPCs. The `Worker` supplies one
 * backed by the native module.
 */
export interface ActorStateClient {
  getState(
    actorName: string,
    key: string,
    stateKey: string,
    executionId: string
  ): Promise<{ value: Uint8Array; exists: boolean }>;

  setState(
    actorName: string,
    key: string,
    stateKey: string,
    value: Uint8Array,
    executionId: string
  ): Promise<{ success: boolean }>;

  deleteState(
    actorName: string,
    key: string,
    stateKey: string,
    executionId: string
  ): Promise<{ existed: boolean }>;

  listStateKeys(
    actorName: string,
    key: string,
    executionId: string,
    prefix?: string
  ): Promise<{ keys: string[] }>;
}

// State values are stored as JSON-encoded bytes.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function serialize(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function deserialize<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

/**
 * Server-backed state for an actor instance.
 *
 * Every state operation is an RPC to the server. State lives on the server,
 * not in the actor instance, because actor instances are transient.
 *
 * @example
 * ```typescript
 * @Operation()
 * async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> {
 *   const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *   cart.items.push(item);
 *   await ctx.state.set('cart', cart);
 *   return cart;
 * }
 * ```
 */
export class ActorState {
  constructor(
    private readonly _actorName: string,
    private readonly _key: string,
    private readonly _executionId: string,
    private readonly _client: ActorStateClient
  ) {}

  /**
   * Get a state value by key.
   *
   * @param stateKey - The key to retrieve
   * @returns The deserialized value, or `undefined` if the key does not exist
   */
  async get<T>(stateKey: string): Promise<T | undefined> {
    const response = await this._client.getState(
      this._actorName,
      this._key,
      stateKey,
      this._executionId
    );
    if (!response.exists) {
      return undefined;
    }
    return deserialize<T>(response.value);
  }

  /**
   * Set a state value.
   *
   * @param stateKey - The key to set
   * @param value - The value to store, serialized to JSON
   * @throws {Error} If the server reports that the write did not succeed
   */
  async set<T>(stateKey: string, value: T): Promise<void> {
    const bytes = serialize(value);
    const response = await this._client.setState(
      this._actorName,
      this._key,
      stateKey,
      bytes,
      this._executionId
    );
    if (!response.success) {
      throw new Error(`Failed to set state key "${stateKey}" for actor ${this._actorName}[${this._key}]`);
    }
  }

  /**
   * Delete a state value.
   *
   * @param stateKey - The key to delete
   * @returns `true` if the key existed before deletion
   */
  async delete(stateKey: string): Promise<boolean> {
    const response = await this._client.deleteState(
      this._actorName,
      this._key,
      stateKey,
      this._executionId
    );
    return response.existed;
  }

  /**
   * List all state keys, optionally filtered by prefix.
   *
   * @param prefix - Optional prefix to filter keys
   * @returns Array of matching state keys
   */
  async listKeys(prefix?: string): Promise<string[]> {
    const response = await this._client.listStateKeys(
      this._actorName,
      this._key,
      this._executionId,
      prefix
    );
    return response.keys;
  }
}

/**
 * The data needed to construct an {@link ActorContext}.
 *
 * Populated from the polled `ActorOperation` proto message.
 */
export interface ActorExecution {
  actorName: string;
  key: string;
  operationName: string;
  operationId: string;
  executionId: string;
  mode: OperationMode;
  metadata?: Record<string, string>;
}

/**
 * Context passed to every `@Operation()` method as the first parameter.
 *
 * Provides access to:
 * - Actor identity (name, key)
 * - Operation identity (name, ID, execution ID)
 * - Concurrency mode
 * - Server-backed state via `ctx.state`
 *
 * @example
 * ```typescript
 * @Operation()
 * async addItem(ctx: ActorContext, item: CartItem): Promise<Cart> {
 *   console.log(`Actor: ${ctx.actorName}, Key: ${ctx.key}`);
 *   console.log(`Operation: ${ctx.operationName}, Mode: ${ctx.mode}`);
 *
 *   const cart = await ctx.state.get<Cart>('cart') ?? { items: [] };
 *   cart.items.push(item);
 *   await ctx.state.set('cart', cart);
 *   return cart;
 * }
 * ```
 */
export class ActorContext {
  /** Server-backed state for this actor instance. */
  public readonly state: ActorState;

  /** Actor type name. */
  public readonly actorName: string;

  /** Actor instance key. */
  public readonly key: string;

  /** Name of the operation being executed. */
  public readonly operationName: string;

  /** Unique id of this operation invocation. */
  public readonly operationId: string;

  /** Execution id, used for tracing and idempotency. */
  public readonly executionId: string;

  /** Concurrency mode of this operation. */
  public readonly mode: OperationMode;

  /** Metadata from the operation request; empty when none was sent. */
  public readonly metadata: Record<string, string>;

  constructor(execution: ActorExecution, stateClient: ActorStateClient) {
    this.actorName = execution.actorName;
    this.key = execution.key;
    this.operationName = execution.operationName;
    this.operationId = execution.operationId;
    this.executionId = execution.executionId;
    this.mode = execution.mode;
    this.metadata = execution.metadata ?? {};
    this.state = new ActorState(
      execution.actorName,
      execution.key,
      execution.executionId,
      stateClient
    );
  }
}
