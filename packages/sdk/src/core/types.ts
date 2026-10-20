/**
 * Type definitions for the Orcher core native module.
 *
 * TypeScript types for the native Rust/Neon module, so values crossing the FFI
 * boundary are type-checked on the TypeScript side.
 *
 * @module @orcher/sdk/core/types
 */

import type { RetryPolicy } from '../workflow/types';

/**
 * Native client handle (opaque pointer to Rust ClientHandle)
 */
export interface NativeClientHandle {
  readonly __brand: 'NativeClientHandle';
}

/**
 * A running worker host (opaque handle to the native `orcher-sdk-host` worker)
 */
export interface NativeHostHandle {
  readonly __brand: 'NativeHostHandle';
}

/**
 * @deprecated The worker runs on the worker host; use {@link NativeHostHandle}.
 */
export type NativeServiceHandle = NativeHostHandle;

/**
 * A worker's configuration as `hostStart` reads it. Every option left out
 * keeps the worker host's default.
 */
export interface HostConfig {
  serverUrl: string;
  taskQueue: string;
  namespace: string;
  identity?: string;
  apiKey?: string;
  organizationId?: string;
  /** The release the worker runs; blank means none. */
  versionId?: string;
  /** TLS for every connection; present (even empty) means TLS. */
  tls?: TlsConfig;
  maxConcurrentWorkflows?: number;
  maxConcurrentTasks?: number;
  maxConcurrentActorOperations?: number;
  workflowPollers?: number;
  taskPollers?: number;
  actorPollers?: number;
  /** How often the worker tells the engine it is alive. */
  heartbeatIntervalMs?: number;
  maxSessions?: number;
  /** How long a stopping worker gives its running work to finish. */
  shutdownGraceMs?: number;
  sdkName?: string;
  sdkVersion?: string;
}

/** What a worker runs, as `hostStart` reads it. */
export interface HostRegistrations {
  workflowTypes: string[];
  taskTypes: string[];
  actorHandlers: Array<{ actorName: string; operation: string; shared: boolean }>;
}

/**
 * Native workflow handle (opaque pointer to Rust WorkflowHandle)
 */
export interface NativeWorkflowHandle {
  readonly __brand: 'NativeWorkflowHandle';
}

/**
 * TLS configuration for secure connections
 */
export interface TlsConfig {
  /** Path to a client certificate PEM file (mTLS). Requires `keyPath`. */
  certPath?: string;
  /** Path to the client private key PEM file (mTLS). Requires `certPath`. */
  keyPath?: string;
  /**
   * Path to a CA certificate PEM file, for a private or self-signed authority.
   *
   * Omit to verify the server against the system trust store. That is the
   * normal case for a publicly-trusted certificate, including mTLS where only
   * the client identity is custom. Providing a `tls` object at all enables TLS;
   * omit `tls` entirely to connect without it.
   */
  caPath?: string;
  /**
   * Not supported: certificate verification cannot be disabled, and passing
   * `false` is rejected rather than silently ignored. To trust a self-signed
   * development certificate, point `caPath` at its CA instead.
   */
  rejectUnauthorized?: boolean;
}

/**
 * Client configuration
 */
export interface ClientConfig {
  /**
   * Orcher server URL (e.g., "http://localhost:50051")
   */
  serverUrl: string;

  /**
   * Namespace for isolation (e.g., "default")
   */
  namespace: string;

  /**
   * Optional identity for this client
   */
  identity?: string;

  /** TLS configuration for secure connections */
  tls?: TlsConfig;

  /** API key for authentication */
  apiKey?: string;
}

/**
 * Service (worker) configuration
 */
export interface ServiceConfig {
  /**
   * Orcher server URL (e.g., "http://localhost:50051")
   */
  serverUrl: string;

  /**
   * Namespace for isolation (e.g., "default")
   */
  namespace: string;

  /**
   * Task queue to poll from
   */
  taskQueue: string;

  /**
   * Optional identity for this service
   */
  identity?: string;

  /**
   * Maximum concurrent workflow executions (default: 100)
   */
  maxConcurrentWorkflows?: number;

  /**
   * Maximum concurrent task executions (default: 100)
   */
  maxConcurrentTasks?: number;

  /**
   * Organization ID for multi-tenancy (optional)
   *
   * When set, the service will include this in requests to the server
   * via the `X-Organization-Id` header, enabling organization-level
   * quotas and billing attribution.
   */
  organizationId?: string;

  /**
   * API key for authentication (optional)
   *
   * Sent as `authorization: Bearer <key>` on every poll, matching the client.
   */
  apiKey?: string;

  /**
   * The code release this worker is running (optional).
   *
   * Sent on every poll and at registration so the server can bind an execution
   * to it on first claim. Opaque: never parsed or ordered.
   */
  versionId?: string;

  /**
   * TLS for the connection. Defaults to on, with the system trust store,
   * whenever `serverUrl` is `https://`; set explicitly for a private CA or
   * a client certificate.
   */
  tls?: TlsConfig;
}

/**
 * The start options object the native binding reads.
 *
 * Internal to the binding. Callers start workflows with `Client.startWorkflow`,
 * whose options are the `WorkflowStartOptions` the package exports; this type
 * was once exported under that same name, which made the two easy to confuse.
 */
export interface NativeWorkflowStartOptions {
  /**
   * Unique workflow ID
   */
  workflowId: string;

  /**
   * Workflow type name (registered function name)
   */
  workflowType: string;

  /**
   * Task queue to execute on
   */
  taskQueue: string;

  /**
   * Optional workflow arguments (will be serialized to Payloads)
   */
  args?: unknown[];

  /**
   * Optional workflow input (deprecated, use args instead)
   * @deprecated Use args instead
   */
  input?: unknown;

  /**
   * Total time allowed for the whole workflow execution, in **milliseconds**.
   *
   * When omitted the workflow runs without an execution deadline: the server
   * only considers a workflow for timeout when this is set.
   */
  workflowExecutionTimeout?: number;

  /**
   * Time allowed for a single workflow run, in **milliseconds**.
   */
  workflowRunTimeout?: number;

  /**
   * Time allowed to process a single workflow task, in **milliseconds**.
   */
  workflowTaskTimeout?: number;

  /**
   * Optional workflow timeout (milliseconds)
   *
   * @deprecated Use {@link workflowExecutionTimeout}. Both names are read, and
   * `workflowExecutionTimeout` wins when both are set.
   */
  workflowTimeout?: number;

  /**
   * Optional run timeout (milliseconds)
   *
   * @deprecated Use {@link workflowRunTimeout}.
   */
  runTimeout?: number;

  /**
   * Optional task timeout (milliseconds)
   *
   * @deprecated Use {@link workflowTaskTimeout}.
   */
  taskTimeout?: number;

  /**
   * Optional workflow-level retry policy (opt-in).
   *
   * When omitted, a failed workflow is **not** retried. When set, a failed
   * workflow is retried as a fresh run (new run, separate event history) for
   * up to `maxAttempts` runs, the first one included; `maxAttempts: 0` retries
   * without limit, and leaving `maxAttempts` out allows 3. Intervals are in
   * milliseconds.
   */
  retryPolicy?: Partial<RetryPolicy>;
}

/**
 * Workflow handle options
 */
export interface WorkflowHandleOptions {
  /**
   * Workflow ID
   */
  workflowId: string;

  /**
   * Optional run ID
   */
  runId?: string;
}

/**
 * Execution request from native module
 */
export interface ExecutionRequest {
  /**
   * Unique execution ID
   */
  executionId: string;

  /**
   * Execution type (workflow or task name)
   */
  executionType: string;

  /**
   * Execution input (deserialized from JSON)
   */
  input: unknown;
}

/**
 * Task execution request from native module
 *
 * Represents a scheduled task that needs to be executed by a task worker.
 * This is separate from workflow execution requests.
 */
export interface TaskExecutionRequest {
  /**
   * Unique task ID (e.g., "charge_card_distributed_0")
   */
  task_id: string;

  /**
   * Task type name (e.g., "charge_card_distributed")
   */
  task_type: string;

  /**
   * Workflow ID that scheduled this task
   */
  workflow_id: string;

  /**
   * Execution ID of the workflow
   */
  execution_id: string;

  /**
   * Task input (deserialized from JSON)
   */
  input: unknown;

  /**
   * Attempt number (1-based)
   */
  attempt: number;

  /**
   * When the task was scheduled (ISO 8601 string)
   */
  scheduled_time?: string;
}

/**
 * Execution result to send back to native module
 */
export interface ExecutionResult {
  /**
   * Execution ID (from ExecutionRequest)
   */
  executionId: string;

  /**
   * Whether execution succeeded
   */
  success: boolean;

  /**
   * Result value (if success = true)
   */
  result?: unknown;

  /**
   * Error message (if success = false)
   */
  error?: string;
}

/**
 * Workflow status
 */
export enum WorkflowStatus {
  Running = 'RUNNING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
  Terminated = 'TERMINATED',
  TimedOut = 'TIMED_OUT',
  Unknown = 'UNKNOWN',
}

/**
 * Parent workflow execution info
 */
export interface ParentExecutionInfo {
  namespace: string;
  workflowId: string;
  executionId: string;
}

/**
 * Workflow execution configuration
 */
export interface WorkflowExecutionConfig {
  taskQueue: string;
  executionTimeoutSeconds?: number;
  runTimeoutSeconds?: number;
  defaultTaskTimeoutSeconds?: number;
  retryPolicy?: {
    initialIntervalSeconds: number;
    backoffCoefficient: number;
    maxIntervalSeconds: number;
    maxAttempts: number;
    nonRetryableErrorTypes: string[];
  };
  cronSchedule: string;
}

/**
 * Detailed description of a workflow execution
 *
 * Returned by `WorkflowHandle.describe()`. Contains comprehensive metadata
 * about the workflow execution including status, timing, configuration,
 * and pending work counts.
 */
export interface WorkflowExecutionDescription {
  /** Workflow execution identifiers */
  execution: { workflowId: string; runId: string };
  /** Workflow type name */
  workflowType: string;
  /** Task queue */
  taskQueue: string;
  /** Current status */
  status: string;
  /** Start time */
  startTime?: { secs_since_epoch: number; nanos_since_epoch: number };
  /** Close time (if finished) */
  closeTime?: { secs_since_epoch: number; nanos_since_epoch: number };
  /** Number of journal entries */
  journalLength: number;
  /** Current attempt */
  attempt: number;
  /** Search attributes (indexed custom fields) */
  searchAttributes: Record<string, string>;
  /** Memo (non-indexed metadata) */
  memo: Record<string, unknown>;
  /** Tags */
  tags: string[];
  /** Who started the workflow */
  startedBy: string;
  /** Cron schedule (if periodic) */
  cronSchedule: string;
  /** State transition count */
  stateTransitionCount: number;
  /** Parent workflow info (if child workflow) */
  parentExecution?: ParentExecutionInfo;
  /** Pending tasks count */
  pendingTasks: number;
  /** Pending timers count */
  pendingTimers: number;
  /** Pending events count */
  pendingEvents: number;
  /** Execution configuration */
  executionConfig?: WorkflowExecutionConfig;
}

/**
 * Summary information about a workflow execution
 *
 * Returned in list/search results via `client.listWorkflows()` and `client.searchWorkflows()`.
 */
export interface WorkflowExecutionInfo {
  /** User-facing workflow ID */
  workflowId: string;
  /** Internal execution ID (UUID) */
  executionId: string;
  /** Workflow type name */
  workflowType: string;
  /** Task queue */
  taskQueue: string;
  /** Namespace */
  namespace: string;
  /** Current status */
  status: string;
  /** Start time */
  startTime?: { secs_since_epoch: number; nanos_since_epoch: number };
  /** Close time (if finished) */
  closeTime?: { secs_since_epoch: number; nanos_since_epoch: number };
  /** Execution duration in seconds (if finished) */
  executionDurationSeconds?: number;
  /** Number of journal entries */
  journalLength: number;
  /** Parent workflow info (if child workflow) */
  parentExecution?: ParentExecutionInfo;
  /** Search attributes (indexed custom fields) */
  searchAttributes: Record<string, string>;
  /** Memo (non-indexed metadata) */
  memo: Record<string, unknown>;
  /** Tags */
  tags: string[];
  /** Who started the workflow */
  startedBy: string;
  /** Retry attempt number */
  attempt: number;
  /** Cron schedule (if periodic) */
  cronSchedule: string;
  /** State transition count */
  stateTransitionCount: number;
}

/**
 * A page of workflow execution results
 *
 * Returned by `client.listWorkflows()` and `client.searchWorkflows()`.
 */
export interface WorkflowListPage {
  /** Workflow execution summaries */
  executions: WorkflowExecutionInfo[];
  /** Token for next page (empty array if no more results) */
  nextPageToken: number[];
}

/**
 * Options for listing workflows
 */
export interface ListWorkflowsOptions {
  /** Maximum results per page (default: 100) */
  pageSize?: number;
  /** Pagination token from a previous response */
  nextPageToken?: number[];
  /** Filter by workflow type */
  workflowType?: string;
  /** Filter by task queue */
  taskQueue?: string;
  /** Filter by one or more statuses */
  statusFilter?: string[];
  /** Sort order */
  sortOrder?: 'START_TIME_ASC' | 'START_TIME_DESC' | 'CLOSE_TIME_ASC' | 'CLOSE_TIME_DESC';
}

/**
 * Options for searching workflows
 */
export interface SearchWorkflowsOptions {
  /** Maximum results per page (default: 100) */
  pageSize?: number;
  /** Pagination token from a previous response */
  nextPageToken?: number[];
}

/**
 * Native module interface (loaded from Rust/Neon)
 */
export interface NativeModule {
  /**
   * Get native module version
   */
  version(): string;

  /**
   * Get the Orcher FFI version
   */
  ffiVersion(): string;

  /**
   * Health check - verify FFI is accessible
   */
  healthCheck(): boolean;

  /**
   * Get runtime mode (ffi or direct-bindings)
   */
  getRuntimeMode?(): string;

  // Client operations
  /**
   * Connect to the Orcher server
   */
  clientConnect(config: ClientConfig): NativeClientHandle;

  /**
   * Start a workflow
   */
  clientStartWorkflow(
    client: NativeClientHandle,
    options: NativeWorkflowStartOptions
  ): NativeWorkflowHandle;

  /**
   * Get workflow handle by ID
   */
  clientGetWorkflowHandle(
    client: NativeClientHandle,
    workflowId: string,
    runId?: string
  ): NativeWorkflowHandle;

  /**
   * List workflow executions
   */
  clientListWorkflows(
    client: NativeClientHandle,
    options: ListWorkflowsOptions
  ): Promise<WorkflowListPage>;

  /**
   * Search workflow executions
   */
  clientSearchWorkflows(
    client: NativeClientHandle,
    query: string,
    options: SearchWorkflowsOptions
  ): Promise<WorkflowListPage>;

  /**
   * Close client connection
   */
  clientClose(client: NativeClientHandle): void;

  // The worker: a binding over the worker host (orcher-sdk-host). Work
  // crosses as its protobuf encoding (orcher.kernel.v1 / orcher.host.v1).
  // A pull resolves null once the host has stopped and handed over
  // everything it took; it never resolves empty-handed before then.

  /**
   * Start a worker: its drivers, its registration with the engine, and its
   * actor handlers' registration. Rejects when nothing is registered, the
   * engine cannot be reached, a TLS file cannot be read, or the actor service
   * refuses the handlers.
   *
   * @param configJson - JSON {@link HostConfig}
   * @param registrationsJson - JSON {@link HostRegistrations}
   */
  hostStart(configJson: string, registrationsJson: string): Promise<NativeHostHandle>;

  /** The next workflow activation, an encoded `RunActivation`. */
  hostNextActivation(host: NativeHostHandle): Promise<Uint8Array | null>;

  /** Answer an activation with an encoded `RunActivationResult`. */
  hostCompleteActivation(host: NativeHostHandle, result: Uint8Array): Promise<void>;

  /** The next task, an encoded `TaskAssignment`. */
  hostNextTask(host: NativeHostHandle): Promise<Uint8Array | null>;

  /**
   * Record a heartbeat from a running task's code, with the JSON encoding of
   * its details, sent with the next heartbeat due; says whether the task has
   * been asked to cancel.
   */
  hostHeartbeat(
    host: NativeHostHandle,
    token: Uint8Array,
    details?: Uint8Array
  ): { cancelRequested: boolean };

  /**
   * Resolves `true` once a running task is asked to cancel, and `false` once
   * its outcome is reported (at once for a task the host does not hold).
   */
  hostTaskCancelled(host: NativeHostHandle, token: Uint8Array): Promise<boolean>;

  /** Report a task's outcome, an encoded `TaskOutcome`. */
  hostCompleteTask(host: NativeHostHandle, outcome: Uint8Array): Promise<void>;

  /** The next actor operation, an encoded `ActorOperation`. */
  hostNextActorOperation(host: NativeHostHandle): Promise<Uint8Array | null>;

  /** Report an actor operation's result, an encoded `ActorResult`. */
  hostCompleteActorOperation(host: NativeHostHandle, result: Uint8Array): Promise<void>;

  /** One key of an actor's state; `null` when it is not set. */
  hostGetActorState(
    host: NativeHostHandle,
    actorName: string,
    key: string,
    executionId: string,
    stateKey: string
  ): Promise<{ value: Uint8Array; version: string } | null>;

  /**
   * Write one key of an actor's state; resolves its new version. With
   * `expectedVersion`, the write is refused unless the stored version is that one.
   */
  hostSetActorState(
    host: NativeHostHandle,
    actorName: string,
    key: string,
    executionId: string,
    stateKey: string,
    value: Uint8Array,
    expectedVersion?: string
  ): Promise<string>;

  /** Delete one key of an actor's state; resolves whether it was set. */
  hostDeleteActorState(
    host: NativeHostHandle,
    actorName: string,
    key: string,
    executionId: string,
    stateKey: string
  ): Promise<boolean>;

  /** The keys of an actor's state that start with `prefix`. */
  hostActorStateKeys(
    host: NativeHostHandle,
    actorName: string,
    key: string,
    executionId: string,
    prefix: string
  ): Promise<string[]>;

  /**
   * Stop the worker: it stops claiming work, gives the work running its
   * shutdown grace to finish, hands back the activations still unanswered,
   * closes its sessions and deregisters. Pulls then resolve null.
   */
  hostShutdown(host: NativeHostHandle): Promise<void>;

  /**
   * The worker's measurements so far, as JSON: per gRPC method its calls,
   * status errors by code, transport errors, retries and latency, and the
   * activations and tasks it ran.
   */
  hostWireMetrics(host: NativeHostHandle): string;

  /**
   * Invoke an actor operation from the client side
   */
  clientInvokeActorOperation?(
    client: NativeClientHandle,
    actorName: string,
    key: string,
    operation: string,
    payload: Uint8Array
  ): Promise<Uint8Array>;

  // Workflow handle operations
  /**
   * Get workflow result (blocks until complete)
   */
  workflowHandleGetResult(handle: NativeWorkflowHandle): Promise<unknown>;

  /**
   * Cancel workflow. `cleanupTimeout` is in milliseconds.
   */
  workflowHandleCancel(
    handle: NativeWorkflowHandle,
    options?: { cleanupTimeout?: number }
  ): Promise<void>;

  /**
   * Terminate workflow with reason
   */
  workflowHandleTerminate(handle: NativeWorkflowHandle, reason?: string): Promise<void>;

  /**
   * Reset workflow to a journal point, returning the new execution id
   */
  workflowHandleReset(
    handle: NativeWorkflowHandle,
    targetEventId: number,
    reason?: string
  ): Promise<string>;

  /**
   * Query workflow state
   */
  workflowHandleQuery(
    handle: NativeWorkflowHandle,
    queryName: string,
    args?: unknown
  ): Promise<unknown>;

  /**
   * Update workflow state
   */
  workflowHandleUpdate(
    handle: NativeWorkflowHandle,
    updateName: string,
    args?: unknown
  ): Promise<unknown>;

  /**
   * Send event to workflow
   */
  workflowHandleSendEvent(
    handle: NativeWorkflowHandle,
    eventName: string,
    payload?: unknown
  ): Promise<void>;

  /**
   * Get workflow status
   */
  workflowHandleGetStatus(handle: NativeWorkflowHandle): Promise<string>;

  /**
   * Describe workflow execution (detailed metadata)
   */
  workflowHandleDescribe(handle: NativeWorkflowHandle): Promise<WorkflowExecutionDescription>;

  /**
   * The run id a handle names; empty for one that names only a workflow.
   */
  workflowHandleRunId(handle: NativeWorkflowHandle): string;

  // The kernel protocol, for replaying recorded activations without an
  // engine (contract/replay-check.ts). The worker does not use these.

  /**
   * A recorded activation (an encoded `orcher.v1.PollWorkflowExecutionResponse`)
   * resolved by the kernel, as an encoded `orcher.kernel.v1.RunActivation`.
   */
  kernelResolve?(pollResponse: Buffer, namespace: string): Buffer;

  /**
   * An encoded `orcher.kernel.v1.RunActivationResult`, as the JSON of the
   * result the workflow driver checks and sends. Throws on a protocol error.
   */
  kernelExecutionResult?(runId: string, result: Buffer): string;
}

/**
 * Disposable resource interface
 */
export interface Disposable {
  /**
   * Dispose of the resource
   */
  dispose(): void;

  /**
   * Symbol.dispose for explicit resource management
   */
  [Symbol.dispose](): void;
}

/**
 * Async disposable resource interface
 */
export interface AsyncDisposable {
  /**
   * Dispose of the resource asynchronously
   */
  dispose(): Promise<void>;

  /**
   * Symbol.asyncDispose for explicit resource management
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Error codes from native module
 */
export enum ErrorCode {
  Success = 'SUCCESS',
  InvalidArgument = 'INVALID_ARGUMENT',
  ConnectionFailed = 'CONNECTION_FAILED',
  Timeout = 'TIMEOUT',
  NotFound = 'NOT_FOUND',
  AlreadyExists = 'ALREADY_EXISTS',
  PermissionDenied = 'PERMISSION_DENIED',
  ResourceExhausted = 'RESOURCE_EXHAUSTED',
  FailedPrecondition = 'FAILED_PRECONDITION',
  Aborted = 'ABORTED',
  OutOfRange = 'OUT_OF_RANGE',
  Unimplemented = 'UNIMPLEMENTED',
  Internal = 'INTERNAL',
  Unavailable = 'UNAVAILABLE',
  DataLoss = 'DATA_LOSS',
  Unauthenticated = 'UNAUTHENTICATED',
  Unknown = 'UNKNOWN',
}

/**
 * Parse error code from error message
 */
export function parseErrorCode(message: string): ErrorCode {
  // The tag may name things beside the code: `[CODE key=value …]`.
  const match = message.match(/\[([A-Z_]+)(?: [a-z_]+=[^\s\]]*)*\]/);
  if (!match) {
    return ErrorCode.Unknown;
  }

  const code = match[1]!;

  // Match on the enum's VALUES, not its keys.
  //
  // The regex extracts `NOT_FOUND`, which is an ErrorCode *value*; the keys are
  // PascalCase (`NotFound`). TypeScript string enums have no reverse mapping, so
  // a `code in ErrorCode` test is false for every real code and would leave
  // `NotFoundError`, `TimeoutError` and the other subclasses unreachable.
  const values = Object.values(ErrorCode) as string[];
  if (values.includes(code)) {
    return code as ErrorCode;
  }

  return ErrorCode.Unknown;
}

/**
 * Extract error message (without error code prefix)
 */
export function extractErrorMessage(message: string): string {
  const match = message.match(/\[([A-Z_]+)(?: [a-z_]+=[^\s\]]*)*\] (.+)/);
  return match ? match[2]! : message;
}
