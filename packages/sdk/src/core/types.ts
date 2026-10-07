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
 * Native service handle (opaque pointer to Rust ServiceHandle)
 */
export interface NativeServiceHandle {
  readonly __brand: 'NativeServiceHandle';
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
   * When omitted, a failed workflow is **not** retried. When set with
   * `maxAttempts > 0`, a failed workflow is retried as a fresh run (new run,
   * separate event history). Intervals are in milliseconds.
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

  // Service operations
  /**
   * Create a service (worker)
   */
  serviceCreate(config: ServiceConfig): NativeServiceHandle;

  /**
   * Start service with sdk-core drivers (creates WorkflowDriver, TaskDriver,
   * and optionally ActorDriver)
   *
   * @param service - Service handle
   * @param workflowPollerCount - Number of workflow pollers
   * @param taskPollerCount - Number of task pollers
   * @param actorPollerCount - Number of actor pollers (optional, 0 = no actor driver)
   * @param actorRegistrationId - Registration ID from registerActorHandlers (optional)
   */
  serviceStart(
    service: NativeServiceHandle,
    workflowPollerCount: number,
    taskPollerCount: number,
    actorPollerCount?: number,
    actorRegistrationId?: string
  ): Promise<void>;

  /**
   * Tell the workflow and task drivers to stop, without waiting for them.
   * They start no new polls but still hand over, for their shutdown grace,
   * what the polls they already had out bring back; keep polling workflow and
   * task slots until `serviceShutdown` has returned.
   */
  serviceRequestShutdown(service: NativeServiceHandle): void;

  /**
   * Shutdown service gracefully
   */
  serviceShutdown(service: NativeServiceHandle): Promise<void>;

  // Pull-model polling: TypeScript loops pull work from sdk-core.

  /**
   * Poll for a workflow task from sdk-core (multi-channel fan-out)
   *
   * Each TypeScript polling loop should use a different slotIndex (0 to N-1)
   * to achieve parallel polling without mutex contention.
   *
   * Returns JSON string with workflow work or null if no work available (timeout).
   * Throws once the slot's channel has closed, which happens only after the
   * workflow driver has stopped: shutdown alone does not end a workflow poll.
   *
   * @param service - Service handle
   * @param slotIndex - Slot index for this polling loop (0 to workflowPollerCount-1)
   */
  pollWorkflowTask(service: NativeServiceHandle, slotIndex: number): Promise<string | null>;

  /**
   * Poll for a task from sdk-core (multi-channel fan-out)
   *
   * Each TypeScript polling loop should use a different slotIndex (0 to N-1)
   * to achieve parallel polling without mutex contention.
   *
   * Returns JSON string with task work or null if no work available (timeout).
   * Throws if service is shutdown.
   *
   * @param service - Service handle
   * @param slotIndex - Slot index for this polling loop (0 to taskPollerCount-1)
   */
  pollTask(service: NativeServiceHandle, slotIndex: number): Promise<string | null>;

  /**
   * Get the number of workflow polling slots
   *
   * @param service - Service handle
   * @returns Number of workflow polling slots
   */
  getWorkflowSlotCount(service: NativeServiceHandle): number;

  /**
   * Get the number of task polling slots
   *
   * @param service - Service handle
   * @returns Number of task polling slots
   */
  getTaskSlotCount(service: NativeServiceHandle): number;

  /**
   * Add a session queue — TaskDriver will start polling it immediately.
   */
  addSessionQueue(service: NativeServiceHandle, queueName: string): void;

  /**
   * Remove a session queue — TaskDriver will stop polling it.
   */
  removeSessionQueue(service: NativeServiceHandle, queueName: string): void;

  /**
   * Complete a workflow task by sending result back to sdk-core
   *
   * @param service - Service handle
   * @param workflowId - Workflow ID
   * @param executionId - Execution/run ID
   * @param resultJson - JSON string of ExecutionResult
   * @param taskToken - Base64-encoded task token
   * @param streamEntryId - Optional stream entry ID
   */
  completeWorkflowTask(
    service: NativeServiceHandle,
    workflowId: string,
    executionId: string,
    resultJson: string,
    taskToken: string,
    streamEntryId: string | null
  ): Promise<void>;

  /**
   * Complete a task by sending result back to sdk-core
   *
   * @param service - Service handle
   * @param taskToken - Base64-encoded task token
   * @param resultJson - JSON string of result
   */
  completeTask(service: NativeServiceHandle, taskToken: string, resultJson: string): Promise<void>;

  /**
   * Fail a workflow task by sending error to sdk-core
   *
   * @param service - Service handle
   * @param workflowId - Workflow ID
   * @param executionId - Execution/run ID
   * @param taskToken - Base64-encoded task token
   * @param errorMessage - Error message
   * @param streamEntryId - Optional stream entry ID
   */
  failWorkflowTask(
    service: NativeServiceHandle,
    workflowId: string,
    executionId: string,
    taskToken: string,
    errorMessage: string,
    streamEntryId: string | null
  ): Promise<void>;

  /**
   * Fail a task by sending error to sdk-core
   *
   * @param service - Service handle
   * @param taskToken - Base64-encoded task token
   * @param errorMessage - Error message
   * @param errorType - The type a retry policy's non-retryable list is matched
   *   against; `TaskExecutionError` when omitted
   * @param nonRetryable - Never retry, whatever the policy allows
   */
  failTask(
    service: NativeServiceHandle,
    taskToken: string,
    errorMessage: string,
    errorType?: string,
    nonRetryable?: boolean
  ): Promise<void>;

  /**
   * Record a heartbeat from a running task's code. The native worker heartbeats
   * every task on its own; this is sent with the next heartbeat due, never
   * waiting. Resolves JSON `{ "cancelRequested": boolean }`.
   *
   * @param service - Service handle
   * @param taskToken - Base64-encoded task token
   * @param details - Optional JSON progress details
   */
  heartbeatTask?(
    service: NativeServiceHandle,
    taskToken: string,
    details?: string
  ): Promise<string>;

  /**
   * Resolves `true` once the engine asks a running task to stop, and `false`
   * once its outcome is reported (or at once for a task not running here).
   *
   * @param service - Service handle
   * @param taskToken - Base64-encoded task token
   */
  waitTaskCancelled?(service: NativeServiceHandle, taskToken: string): Promise<boolean>;

  // Push-model entry points. The native side exports them, but they throw if
  // called; use the pull model (serviceStart + pollWorkflowTask/pollTask).

  /**
   * Run service with TypeScript executor handlers
   *
   * @deprecated Use serviceStart + pollWorkflowTask/pollTask instead (pull model)
   */
  serviceRunWithHandlers?(
    service: NativeServiceHandle,
    workflowExecutor: (request: ExecutionRequest) => Promise<ExecutionResult>,
    taskExecutor: (request: ExecutionRequest) => Promise<ExecutionResult>,
    workflowPollerCount: number,
    taskPollerCount: number
  ): Promise<void>;

  /**
   * Register error callback for fatal errors
   *
   * @deprecated Errors are returned directly from the poll and complete methods
   */
  serviceRegisterErrorCallback?(
    service: NativeServiceHandle,
    callback: (error: string) => void
  ): void;

  // =========================================================================
  // Actor operations (optional: a native module built without actor support omits them)
  // =========================================================================

  /**
   * Register actor handlers with the server
   *
   * @param service - Service handle
   * @param handlersJson - JSON array of { actor_name, operation, mode }
   * @param metadataJson - JSON object of key-value metadata
   * @returns JSON string with { success, registration_id, handlers_registered, error_message }
   */
  registerActorHandlers?(
    service: NativeServiceHandle,
    handlersJson: string,
    metadataJson: string
  ): Promise<string>;

  /**
   * Poll for an actor operation
   */
  pollActorOperation?(service: NativeServiceHandle, slotIndex: number): Promise<string | null>;

  /**
   * Complete an actor operation
   */
  completeActorOperation?(
    service: NativeServiceHandle,
    operationId: string,
    executionId: string,
    result: Uint8Array,
    success: boolean,
    errorMessage?: string
  ): Promise<void>;

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

  /**
   * Get actor state
   */
  actorGetState?(
    service: NativeServiceHandle,
    actorName: string,
    key: string,
    stateKey: string,
    executionId: string
  ): Promise<{ value: Uint8Array; exists: boolean }>;

  /**
   * Set actor state
   */
  actorSetState?(
    service: NativeServiceHandle,
    actorName: string,
    key: string,
    stateKey: string,
    value: Uint8Array,
    executionId: string
  ): Promise<{ success: boolean }>;

  /**
   * Delete actor state
   */
  actorDeleteState?(
    service: NativeServiceHandle,
    actorName: string,
    key: string,
    stateKey: string,
    executionId: string
  ): Promise<{ existed: boolean }>;

  /**
   * List actor state keys
   */
  actorListStateKeys?(
    service: NativeServiceHandle,
    actorName: string,
    key: string,
    executionId: string,
    prefix?: string
  ): Promise<{ keys: string[] }>;

  // Workflow handle operations
  /**
   * Get workflow result (blocks until complete)
   */
  workflowHandleGetResult(handle: NativeWorkflowHandle): Promise<unknown>;

  /**
   * Cancel workflow
   */
  workflowHandleCancel(handle: NativeWorkflowHandle): Promise<void>;

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
