/**
 * Typed wrapper around the native client operations.
 *
 * Validates input on the TypeScript side, converts arguments to payloads, and
 * wraps native failures in OrcherError subclasses.
 *
 * @module @orcher/sdk/core/client
 */

import { ClientError, wrapError } from './errors';
import { hasValidNameCharacters, NAME_RULE } from './names';
import { getNativeModule } from './native';
import { fromPayload, Payload, toPayload } from './protobuf';
import {
  ClientConfig,
  Disposable,
  NativeClientHandle,
  NativeWorkflowHandle,
  WorkflowHandleOptions,
  WorkflowStartOptions,
} from './types';

/**
 * Validation and serialization for event and query names and payloads.
 *
 * @internal
 */
class EventHelpers {
  /**
   * Validate an event or query name: non-empty, at most 255 characters, allowed characters only.
   *
   * @param eventName - Event name to validate
   * @throws {ClientError} If invalid
   */
  static validateEventName(eventName: string): void {
    if (!eventName || eventName.trim().length === 0) {
      throw new ClientError('Event name must be a non-empty string');
    }

    if (eventName.length > 255) {
      throw new ClientError('Event name must not exceed 255 characters');
    }

    if (!hasValidNameCharacters(eventName)) {
      throw new ClientError(
        `Event name must contain only ${NAME_RULE}`
      );
    }
  }

  /**
   * Serialize an event payload to a string. Strings pass through unchanged; anything
   * else is JSON-encoded.
   *
   * @param payload - Payload to serialize
   * @returns Serialized payload
   */
  static serialize(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }
    return JSON.stringify(payload);
  }
}

/**
 * Handle for managing one workflow execution.
 *
 * @example
 * ```typescript
 * const handle = client.startWorkflow({
 *   workflowId: 'order-123',
 *   workflowType: 'orderWorkflow',
 *   taskQueue: 'orders',
 *   args: [{ orderId: 123 }]
 * });
 *
 * const result = await handle.result();
 * console.log('Workflow result:', result);
 * ```
 */
export class WorkflowHandle<T = unknown> implements Disposable {
  private disposed = false;

  /**
   * @internal
   */
  constructor(
    private readonly native: NativeWorkflowHandle,
    public readonly workflowId: string,
    public readonly runId?: string
  ) {}

  /**
   * Get the workflow result.
   *
   * Resolves once the workflow completes.
   *
   * @returns Promise that resolves with the workflow result
   * @throws {OrcherError} If the workflow fails or times out
   *
   * @example
   * ```typescript
   * const result = await handle.result();
   * console.log('Result:', result);
   * ```
   */
  async result(): Promise<T> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      const resultPayload = await nativeModule.workflowHandleGetResult(this.native);
      return fromPayload<T>(resultPayload as Payload);
    } catch (err) {
      throw wrapError(err, 'Failed to get workflow result');
    }
  }

  /**
   * Request cancellation of the workflow.
   *
   * The workflow decides how to respond: it may clean up and stop, or ignore the request.
   *
   * @throws {OrcherError} If cancellation fails
   *
   * @example
   * ```typescript
   * await handle.cancel();
   * console.log('Workflow cancelled');
   * ```
   */
  async cancel(): Promise<void> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      await nativeModule.workflowHandleCancel(this.native);
    } catch (err) {
      throw wrapError(err, 'Failed to cancel workflow');
    }
  }

  /**
   * Terminate the workflow immediately.
   *
   * Unlike {@link cancel}, the workflow gets no chance to clean up or react.
   *
   * @param reason - Optional reason for termination
   * @throws {OrcherError} If termination fails
   *
   * @example
   * ```typescript
   * await handle.terminate('User requested termination');
   * ```
   */
  async terminate(reason?: string): Promise<void> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      await nativeModule.workflowHandleTerminate(this.native, reason);
    } catch (err) {
      throw wrapError(err, 'Failed to terminate workflow');
    }
  }

  /**
   * Send an event to the running workflow.
   *
   * Events are asynchronous messages from outside a workflow. The workflow waits
   * for them with `ctx.waitForEvent()` or `ctx.waitForEventWithTimeout()`.
   *
   * @param eventName - Name of the event to send
   * @param payload - Event payload (will be serialized to JSON)
   * @throws {ClientError} If the event name is invalid
   * @throws {OrcherError} If sending the event fails
   *
   * @example
   * ```typescript
   * // Send approval event
   * handle.sendEvent('approve', {
   *   approved: true,
   *   approver: 'manager@company.com',
   *   reason: 'Order verified',
   *   timestamp: new Date().toISOString(),
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Type-safe event sending
   * interface ApprovalData {
   *   approved: boolean;
   *   approver: string;
   *   reason: string;
   * }
   *
   * handle.sendEvent<ApprovalData>('approve', {
   *   approved: true,
   *   approver: 'manager@company.com',
   *   reason: 'Verified',
   * });
   * ```
   */
  sendEvent<TPayload = unknown>(eventName: string, payload: TPayload): void {
    this.ensureNotDisposed();

    try {
      EventHelpers.validateEventName(eventName);

      const nativeModule = getNativeModule();
      (nativeModule as any).workflowHandleSendEvent(this.native, eventName, payload);
    } catch (err) {
      if (err instanceof ClientError) {
        throw err;
      }
      throw wrapError(err, `Failed to send event '${eventName}' to workflow ${this.workflowId}`);
    }
  }

  /**
   * Query the workflow state.
   *
   * Queries read the current state of a running workflow without modifying it.
   * The workflow registers query handlers with `ctx.registerQueryHandler()`.
   *
   * @param queryName - Name of the query to execute
   * @param _options - Not supported yet: the timeout is accepted but ignored
   * @returns Promise that resolves with the query result
   * @throws {ClientError} If the query name is invalid
   * @throws {OrcherError} If the query execution fails
   *
   * @example
   * ```typescript
   * // Query order status
   * const status = await handle.query<string>('getOrderStatus');
   * console.log('Order status:', status);
   * ```
   *
   * @example
   * ```typescript
   * // Query with type safety
   * interface OrderData {
   *   orderId: string;
   *   status: string;
   *   total: number;
   * }
   *
   * const order = await handle.query<OrderData>('getOrderData');
   * console.log('Order:', order.orderId, order.status);
   * ```
   */
  async query<TResult = unknown>(
    queryName: string,
    _options?: { timeout?: number }
  ): Promise<TResult> {
    this.ensureNotDisposed();

    try {
      EventHelpers.validateEventName(queryName);

      const nativeModule = getNativeModule();
      const result = await nativeModule.workflowHandleQuery(this.native, queryName);
      return result as TResult;
    } catch (err) {
      if (err instanceof ClientError) {
        throw err;
      }
      throw wrapError(err, `Failed to query workflow ${this.workflowId} with query '${queryName}'`);
    }
  }

  /**
   * Dispose of the workflow handle.
   *
   * Any later call on the handle throws a ClientError.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      // The native handle is freed by its Rust `Drop` when garbage-collected.
    }
  }

  /**
   * Symbol.dispose for explicit resource management
   *
   * @example
   * ```typescript
   * {
   *   using handle = client.startWorkflow(...);
   *   await handle.result();
   * } // Automatically disposed here
   * ```
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Ensure the handle is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new ClientError('Workflow handle has been disposed');
    }
  }
}

/**
 * Low-level client for the Orcher server.
 *
 * Starts workflows, returns handles to existing ones, and manages the connection.
 *
 * @example
 * ```typescript
 * const client = new Client({
 *   serverUrl: 'http://localhost:50051',
 *   namespace: 'default'
 * });
 *
 * client.connect();
 *
 * const handle = client.startWorkflow({
 *   workflowId: 'my-workflow-1',
 *   workflowType: 'myWorkflow',
 *   taskQueue: 'my-queue',
 *   args: [{ data: 'hello' }]
 * });
 *
 * const result = await handle.result();
 * console.log('Result:', result);
 *
 * client.close();
 * ```
 */
export class Client implements Disposable {
  private native: NativeClientHandle | null = null;
  private disposed = false;
  private connected = false;

  /**
   * Create a client. Does not connect; call {@link connect} before use.
   *
   * @param config - Client configuration
   * @throws {ClientError} If `serverUrl` or `namespace` is missing, or `serverUrl` is not a URL
   *
   * @example
   * ```typescript
   * const client = new Client({
   *   serverUrl: 'http://localhost:50051',
   *   namespace: 'default',
   *   identity: 'my-client'
   * });
   * ```
   */
  constructor(private readonly config: ClientConfig) {
    this.validateConfig();
  }

  /**
   * Connect to the Orcher server.
   *
   * Must be called before any other operation. Calling it again while connected does nothing.
   *
   * @throws {OrcherError} If connection fails
   *
   * @example
   * ```typescript
   * client.connect();
   * console.log('Connected to Orcher server');
   * ```
   */
  connect(): void {
    if (this.connected) {
      return;
    }

    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      this.native = nativeModule.clientConnect(this.config);
      this.connected = true;
    } catch (err) {
      throw wrapError(err, `Failed to connect to ${this.config.serverUrl}`);
    }
  }

  /**
   * Start a workflow execution.
   *
   * Only the first element of `args` is sent as the workflow input; with no `args`,
   * the input is `null`.
   *
   * @param options - Workflow start options
   * @returns Workflow handle for the started workflow
   * @throws {OrcherError} If the workflow fails to start
   *
   * @example
   * ```typescript
   * const handle = client.startWorkflow({
   *   workflowId: 'order-123',
   *   workflowType: 'processOrder',
   *   taskQueue: 'orders',
   *   args: [{
   *     orderId: 123,
   *     items: ['item1', 'item2']
   *   }]
   * });
   * ```
   */
  startWorkflow<T = unknown>(options: WorkflowStartOptions): WorkflowHandle<T> {
    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();

      const payloadArgs = options.args?.map((arg) => toPayload(arg)) || [];

      const nativeOptions = {
        ...options,
        input: payloadArgs.length > 0 ? payloadArgs[0] : toPayload(null),
      };

      const nativeHandle = nativeModule.clientStartWorkflow(this.native!, nativeOptions);

      return new WorkflowHandle<T>(nativeHandle, options.workflowId);
    } catch (err) {
      throw wrapError(
        err,
        `Failed to start workflow ${options.workflowType} (${options.workflowId})`
      );
    }
  }

  /**
   * Get a handle to an existing workflow.
   *
   * @param options - Workflow handle options (workflowId and optional runId)
   * @returns Workflow handle
   * @throws {OrcherError} If the workflow is not found
   *
   * @example
   * ```typescript
   * const handle = client.getWorkflowHandle({
   *   workflowId: 'order-123'
   * });
   *
   * const result = await handle.result();
   * ```
   */
  getWorkflowHandle<T = unknown>(options: WorkflowHandleOptions): WorkflowHandle<T> {
    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();
      const nativeHandle = nativeModule.clientGetWorkflowHandle(
        this.native!,
        options.workflowId,
        options.runId
      );

      return new WorkflowHandle<T>(nativeHandle, options.workflowId, options.runId);
    } catch (err) {
      throw wrapError(err, `Failed to get workflow handle for ${options.workflowId}`);
    }
  }

  /**
   * Close the connection to the Orcher server.
   *
   * After closing, the client cannot be used until connect() is called again.
   * Does nothing if the client is not connected.
   *
   * @throws {OrcherError} If closing fails
   *
   * @example
   * ```typescript
   * client.close();
   * console.log('Client closed');
   * ```
   */
  close(): void {
    if (!this.connected || !this.native) {
      return;
    }

    try {
      const nativeModule = getNativeModule();
      nativeModule.clientClose(this.native);
      this.native = null;
      this.connected = false;
    } catch (err) {
      throw wrapError(err, 'Failed to close client');
    }
  }

  /**
   * Dispose of the client.
   *
   * Closes the connection, ignoring any error from closing. After disposal the
   * client cannot be used.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      if (this.connected && this.native) {
        try {
          const nativeModule = getNativeModule();
          nativeModule.clientClose(this.native);
        } catch {
          // Disposal must not throw, so a failed close is ignored.
        }
        this.native = null;
        this.connected = false;
      }
    }
  }

  /**
   * Symbol.dispose for explicit resource management
   *
   * @example
   * ```typescript
   * {
   *   using client = new Client({ ... });
   *   client.connect();
   *   // Use client...
   * } // Automatically disposed here
   * ```
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected && this.native !== null;
  }

  /**
   * Validate client configuration
   */
  private validateConfig(): void {
    if (!this.config.serverUrl || this.config.serverUrl.trim().length === 0) {
      throw new ClientError('serverUrl is required');
    }

    if (!this.config.namespace || this.config.namespace.trim().length === 0) {
      throw new ClientError('namespace is required');
    }

    try {
      new URL(this.config.serverUrl);
    } catch {
      throw new ClientError(`Invalid serverUrl: ${this.config.serverUrl} (must be a valid URL)`);
    }
  }

  /**
   * Ensure the client is connected
   */
  private ensureConnected(): void {
    this.ensureNotDisposed();

    if (!this.connected || !this.native) {
      throw new ClientError('Client is not connected. Call connect() first.');
    }
  }

  /**
   * Ensure the client is not disposed
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new ClientError('Client has been disposed');
    }
  }
}
