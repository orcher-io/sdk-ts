/**
 * The Orcher client: connects to the server, starts workflows, and hands out
 * workflow handles and actor references.
 *
 * @module @orcher/sdk
 */

import { randomUUID } from 'crypto';
import { ClientError, wrapError } from '../core/errors';
import { tlsForUrl } from '../core/tls';
import { wrapWorkflowError } from '../errors/from-native';
import { durationToMillis, type DurationInput } from '../workflow/types';
import { getNativeModule } from '../core/native';
import type {
  ClientConfig,
  NativeClientHandle,
  Disposable,
  ListWorkflowsOptions,
  SearchWorkflowsOptions,
  WorkflowListPage,
} from '../core/types';
import type { Type } from '../di/types';
import { getActorName } from '../di/decorators/actor';
import { createActorProxy } from './actor-ref';
import type { ActorRef } from './actor-ref';

import type { WorkflowStartOptions, WorkflowHandleOptions } from './types';
import { WorkflowIdReusePolicy } from './types';
import { WorkflowHandle } from './workflow-handle';

/**
 * Start options that are declared on {@link WorkflowStartOptions} but do not
 * reach the server.
 *
 * `memo` and `searchAttributes` have wire fields (`annotations` and `labels`)
 * that the SDK does not populate. Setting either is rejected, because silently
 * dropping a caller's metadata is worse than refusing it.
 */
const UNSUPPORTED_START_OPTIONS: ReadonlyArray<keyof WorkflowStartOptions> = [
  'memo',
  'searchAttributes',
];

const REUSE_POLICIES: ReadonlyArray<string> = Object.values(WorkflowIdReusePolicy);

function rejectUnsupportedStartOptions(options: WorkflowStartOptions): void {
  for (const key of UNSUPPORTED_START_OPTIONS) {
    if (options[key] !== undefined) {
      throw new ClientError(
        `The '${String(key)}' start option is not supported yet: this SDK does not ` +
          `send it to the server. Remove it from the start options.`
      );
    }
  }
  // The native layer would refuse an unknown policy too. Rejecting it here
  // gives an error that names the option and the values it accepts.
  const policy = options.workflowIdReusePolicy;
  if (policy !== undefined && !REUSE_POLICIES.includes(policy)) {
    throw new ClientError(
      `workflowIdReusePolicy must be one of ${REUSE_POLICIES.join(', ')}; got ${String(policy)}`
    );
  }
}

/** Convert an optional duration option to milliseconds, preserving `undefined`
 * so an unset timeout stays unset rather than becoming 0. */
function optionalMillis(value: DurationInput | undefined): number | undefined {
  return value === undefined ? undefined : durationToMillis(value);
}

/**
 * Client for starting and interacting with workflows on an Orcher server.
 *
 * Call {@link Client.connect} before any other operation. The client can also
 * invoke actor operations and list or search workflow executions.
 *
 * @example
 * ```typescript
 * import { Client } from '@orcher/sdk';
 *
 * const client = new Client({
 *   serverUrl: 'http://localhost:50051',
 *   namespace: 'default'
 * });
 *
 * await client.connect();
 *
 * const handle = await client.startWorkflow({
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

  private readonly config: ClientConfig;

  /**
   * Create a client. The connection is not opened until {@link Client.connect}.
   *
   * TLS follows the URL scheme (`https` enables it) unless `config.tls` is set.
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
  constructor(config: ClientConfig) {
    // TLS follows the URL scheme unless set explicitly; see tlsForUrl.
    this.config = { ...config, tls: tlsForUrl(config.serverUrl, config.tls) };
    this.validateConfig();
  }

  /**
   * Connect to the Orcher server.
   *
   * Must be called before any other operation. Calling it again while
   * connected does nothing.
   *
   * @throws {OrcherError} If the connection fails
   *
   * @example
   * ```typescript
   * await client.connect();
   * ```
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();

      // The direct bindings return a Promise; the FFI bindings return the
      // handle synchronously.
      const result = nativeModule.clientConnect(this.config);
      this.native = result instanceof Promise ? await result : result;

      this.connected = true;
    } catch (err) {
      throw wrapError(err, `Failed to connect to ${this.config.serverUrl}`);
    }
  }

  /**
   * Start a workflow execution.
   *
   * `workflowId` defaults to a random UUID and `taskQueue` to `default`. Only
   * the first element of `args` is sent as the workflow input.
   *
   * @param options - Workflow start options
   * @returns Workflow handle for the started workflow
   * @throws {OrcherError} If the workflow fails to start
   *
   * @example
   * ```typescript
   * const handle = await client.startWorkflow({
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
  async startWorkflow<T = unknown>(options: WorkflowStartOptions): Promise<WorkflowHandle<T>> {
    // Validate the caller's options before the connection check: an option that
    // cannot be honored is a programming error, and reporting it should not
    // depend on connection state.
    rejectUnsupportedStartOptions(options);

    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();

      // workflowId and taskQueue are optional, as in the Rust and Python SDKs:
      // a caller should not have to invent an id just to start a workflow.
      const workflowId = options.workflowId ?? randomUUID();
      const taskQueue = options.taskQueue ?? 'default';

      // The first argument is sent as a plain value that the native client
      // serializes to JSON, not wrapped in a Payload envelope, as in the Rust SDK.
      // Durations are normalized to milliseconds here, at the one boundary the
      // native layer reads. Callers may pass the Duration helper or a bare
      // number of milliseconds; below this line only milliseconds exist.
      const nativeOptions = {
        ...options,
        workflowId,
        taskQueue,
        input: options.args && options.args.length > 0 ? options.args[0] : null,
        workflowExecutionTimeout: optionalMillis(options.workflowExecutionTimeout),
        workflowRunTimeout: optionalMillis(options.workflowRunTimeout),
        workflowTaskTimeout: optionalMillis(options.workflowTaskTimeout),
      };

      // The direct bindings return a Promise; the FFI bindings return the
      // handle synchronously.
      const result = nativeModule.clientStartWorkflow(this.native!, nativeOptions);
      const nativeHandle = result instanceof Promise ? await result : result;

      // Record the run this start created, so the handle can say which run it
      // is and a caller can tell it apart from the run a later refused start names.
      const runId = nativeModule.workflowHandleRunId?.(nativeHandle) || undefined;
      return new WorkflowHandle<T>(nativeHandle, workflowId, runId);
    } catch (err) {
      throw wrapWorkflowError(
        err,
        `Failed to start workflow ${options.workflowType} (${options.workflowId ?? 'auto'})`,
        options.workflowId ?? options.workflowType
      );
    }
  }

  /**
   * Get a handle to an existing workflow.
   *
   * Omitting `runId` addresses the latest run of that workflow id, which is
   * what a caller holding only a business key wants.
   *
   * @param options - Workflow handle options (workflowId and optional runId)
   * @returns Workflow handle
   * @throws {OrcherError} If the handle cannot be created
   *
   * @example
   * ```typescript
   * const handle = client.getWorkflowHandle({
   *   workflowId: 'order-123'
   * });
   *
   * await handle.sendEvent('payment.status', { state: 'paid' });
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
      throw wrapWorkflowError(
        err,
        `Failed to get workflow handle for ${options.workflowId}`,
        options.workflowId
      );
    }
  }

  /**
   * List workflow executions with optional filters.
   *
   * Returns a paginated list of workflow summaries. Use `nextPageToken`
   * from the response to fetch subsequent pages.
   *
   * @param options - Filter, sort, and pagination options
   * @returns A page of workflow execution summaries
   * @throws {OrcherError} If the list operation fails
   *
   * @example
   * ```typescript
   * // List running workflows of a specific type
   * const page = await client.listWorkflows({
   *   workflowType: 'OrderProcessing',
   *   statusFilter: ['RUNNING'],
   *   pageSize: 50,
   * });
   *
   * for (const exec of page.executions) {
   *   console.log(exec.workflowId, exec.status);
   * }
   *
   * // Fetch next page
   * if (page.nextPageToken.length > 0) {
   *   const nextPage = await client.listWorkflows({
   *     nextPageToken: page.nextPageToken,
   *   });
   * }
   * ```
   */
  async listWorkflows(options: ListWorkflowsOptions = {}): Promise<WorkflowListPage> {
    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();
      return await nativeModule.clientListWorkflows(this.native!, options);
    } catch (err) {
      throw wrapError(err, 'Failed to list workflows');
    }
  }

  /**
   * Search workflow executions with a query string.
   *
   * Supports SQL-like query strings for advanced filtering on workflow
   * attributes including custom search attributes.
   *
   * @param query - SQL-like query string
   * @param options - Pagination options
   * @returns A page of matching workflow execution summaries
   * @throws {OrcherError} If the search operation fails
   *
   * @example
   * ```typescript
   * const page = await client.searchWorkflows(
   *   "WorkflowType = 'OrderProcessing' AND Status = 'Running'"
   * );
   *
   * console.log(`Found ${page.executions.length} workflows`);
   * ```
   */
  async searchWorkflows(
    query: string,
    options: SearchWorkflowsOptions = {}
  ): Promise<WorkflowListPage> {
    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();
      return await nativeModule.clientSearchWorkflows(this.native!, query, options);
    } catch (err) {
      throw wrapError(err, `Failed to search workflows with query: ${query}`);
    }
  }

  // Actor operations

  /**
   * Get a typed actor reference for invoking operations.
   *
   * Returns a proxy object where each method call is routed to the server
   * as an actor operation invocation. The proxy strips the `ctx` parameter
   * and preserves full input/output type inference.
   *
   * @param actorClass - The actor class decorated with @Actor()
   * @param key - The actor instance key (e.g., user ID, cart ID)
   * @returns A typed proxy with operation methods
   *
   * @example
   * ```typescript
   * const cart = client.actorRef(ShoppingCart, 'user-123');
   * const result = await cart.addItem({ name: 'book', price: 10 });
   * // result is typed as Cart
   *
   * const total = await cart.getTotal();
   * // total is typed as number
   * ```
   */
  actorRef<T>(actorClass: Type<T>, key: string): ActorRef<T> {
    this.ensureConnected();
    const actorName = getActorName(actorClass) ?? actorClass.name;
    return createActorProxy(actorClass, actorName, key, this);
  }

  /**
   * Invoke an actor operation by name, without type information.
   *
   * Use this for cross-service or dynamic invocations where the actor class
   * is not available at compile time. The payload and result are JSON.
   *
   * @param actorName - Actor type name
   * @param key - Actor instance key
   * @param operation - Operation name
   * @param payload - Optional operation payload
   * @returns The operation result, or `undefined` if it returned nothing
   * @throws {OrcherError} If the native module does not support actors or the call fails
   *
   * @example
   * ```typescript
   * const result = await client.invokeActor('ShoppingCart', 'user-123', 'addItem', {
   *   name: 'book',
   *   price: 10
   * });
   * ```
   */
  async invokeActor(
    actorName: string,
    key: string,
    operation: string,
    payload?: any
  ): Promise<any> {
    this.ensureConnected();

    try {
      const nativeModule = getNativeModule();

      const payloadBytes =
        payload !== undefined
          ? new TextEncoder().encode(JSON.stringify(payload))
          : new Uint8Array(0);

      if (nativeModule.clientInvokeActorOperation) {
        const resultBytes = await nativeModule.clientInvokeActorOperation(
          this.native!,
          actorName,
          key,
          operation,
          payloadBytes
        );

        if (resultBytes && resultBytes.length > 0) {
          return JSON.parse(new TextDecoder().decode(resultBytes));
        }
        return undefined;
      }

      throw new ClientError(
        'Actor operations not available - ensure native module supports actors'
      );
    } catch (err) {
      throw wrapError(
        err,
        `Failed to invoke actor operation ${actorName}.${operation} (key=${key})`
      );
    }
  }

  /**
   * Close the connection to the Orcher server.
   *
   * After closing, the client cannot be used until {@link Client.connect} is
   * called again. Closing a client that is not connected does nothing.
   *
   * @throws {OrcherError} If closing fails
   *
   * @example
   * ```typescript
   * client.close();
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
   * Close the connection and release resources permanently.
   *
   * After disposal the client cannot be used, even after `connect()`. Errors
   * while closing are ignored.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      if (this.connected && this.native) {
        try {
          const nativeModule = getNativeModule();
          nativeModule.clientClose(this.native);
        } catch {
          // Ignore errors during disposal
        }
        this.native = null;
        this.connected = false;
      }
    }
  }

  /**
   * Dispose the client at the end of a `using` block.
   *
   * @example
   * ```typescript
   * {
   *   using client = new Client({ ... });
   *   await client.connect();
   *   // Use client...
   * } // Automatically disposed here
   * ```
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Whether the client currently holds an open connection. */
  isConnected(): boolean {
    return this.connected && this.native !== null;
  }

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

  private ensureConnected(): void {
    this.ensureNotDisposed();

    if (!this.connected || !this.native) {
      throw new ClientError('Client is not connected. Call connect() first.');
    }
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new ClientError('Client has been disposed');
    }
  }
}
