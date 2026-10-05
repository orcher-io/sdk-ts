/**
 * Types and interfaces for the worker that executes workflows and tasks.
 *
 * @module @orcher/sdk/worker/types
 */

import type { DurationInput } from '../workflow/types';

/**
 * A workflow registration accepted by `WorkerOptions.workflows`.
 *
 * Typed loosely because the worker accepts more than one shape: the value returned
 * by `workflow()`, or a function whose `name` is the workflow type. Classes
 * decorated with `@Workflow()` are registered automatically when the option is
 * omitted.
 */
export type WorkflowDefinition = any;

/**
 * A task registration accepted by `WorkerOptions.tasks`.
 *
 * Typed loosely because the worker accepts more than one shape: the value returned
 * by `task()`, or a function whose `name` is the task type. `@Task()` methods on
 * `@Tasks()` classes are registered automatically when the option is omitted.
 */
export type TaskDefinition = any;

/**
 * Configuration for a `Worker`.
 */
export interface WorkerOptions {
  /**
   * URL of the Orcher engine to connect to.
   *
   * @example 'http://localhost:50051'
   * @example 'https://orcher.example.com'
   */
  serverUrl: string;

  /**
   * Namespace to operate in.
   */
  namespace: string;

  /**
   * Task queue the worker polls for work.
   */
  taskQueue: string;

  /**
   * Workflows this worker can execute.
   *
   * If not provided, every workflow in the GlobalRegistry is registered.
   *
   * @default GlobalRegistry.getAllWorkflows()
   */
  workflows?: WorkflowDefinition[];

  /**
   * Tasks this worker can execute.
   *
   * If not provided, every task in the GlobalRegistry is registered.
   *
   * @default GlobalRegistry.getAllTasks()
   */
  tasks?: TaskDefinition[];

  /**
   * Maximum concurrent workflow executions
   *
   * @default 100
   */
  maxConcurrentWorkflows?: number;

  /**
   * Maximum concurrent task executions
   *
   * @default 100
   */
  maxConcurrentTasks?: number;

  /**
   * Number of concurrent workflow pollers.
   *
   * Higher values increase polling throughput and let the worker handle more
   * concurrent workflow executions. Each poller has its own slot in the native
   * layer, keyed by run ID, so pollers do not contend with each other.
   *
   * @default 4
   */
  workflowPollerCount?: number;

  /**
   * Number of concurrent task pollers.
   *
   * Higher values increase polling throughput and let the worker handle more
   * concurrent task executions. Each poller has its own slot in the native
   * layer, keyed by task ID, so pollers do not contend with each other.
   *
   * @default 4
   */
  taskPollerCount?: number;

  /**
   * Workflow polling interval in milliseconds
   *
   * @default 100
   */
  workflowPollInterval?: number;

  /**
   * Task polling interval in milliseconds
   *
   * @default 100
   */
  taskPollInterval?: number;

  /**
   * Graceful shutdown timeout.
   *
   * How long shutdown waits for in-flight executions to complete before it
   * stops the worker anyway. Accepts the `Duration` helper or a bare number of
   * milliseconds.
   *
   * @default 30000 (30 seconds)
   */
  shutdownGraceTime?: DurationInput;

  /**
   * Force shutdown timeout in milliseconds.
   *
   * Not used yet: the worker stores this value but shutdown is bounded only by
   * `shutdownGraceTime`.
   *
   * @default 60000 (60 seconds)
   */
  forceShutdownTimeout?: number;

  /**
   * Unique identifier for this worker.
   *
   * If not provided, one is generated from the hostname, process ID and start time.
   */
  identity?: string;

  /**
   * The code release this worker is running.
   *
   * Opaque — a git sha, an image digest, a release tag. Sent on every poll;
   * the server records it on an execution the first time this worker claims
   * one, so that execution keeps replaying against the code it started on.
   * Never parsed or ordered.
   *
   * Defaults from `ORCHER_VERSION_ID`, since the value normally comes from the
   * build rather than being written by hand.
   */
  versionId?: string;

  /**
   * Checksum of the worker binary, for determinism verification.
   */
  binaryChecksum?: string;

  /**
   * Logger for worker output.
   *
   * If not provided, the worker logs to the console.
   */
  logger?: Logger;

  /**
   * Organization ID for multi-tenancy.
   *
   * When set, the worker sends it to the server in the `X-Organization-Id`
   * header, which enables organization-level quotas and billing attribution.
   *
   * @example 'org_abc123'
   */
  organizationId?: string;

  /**
   * API key for server authentication.
   *
   * When set, the worker sends it as a Bearer token on every request to the
   * server, including polls.
   */
  apiKey?: string;

  /**
   * TLS settings for the connection.
   *
   * Defaults to on, with the system trust store, whenever `serverUrl` is
   * `https://`. Set explicitly to supply a private CA (`caPath`) or a client
   * certificate (`certPath` + `keyPath`). Without this the driver dials in
   * plaintext, which against a TLS endpoint fails silently: the worker
   * reports itself connected and never completes a poll.
   */
  tls?: import('../core/types').TlsConfig;

  /**
   * Heartbeat interval in milliseconds.
   *
   * Not used yet: the native layer heartbeats every running task on its own
   * schedule, from the moment the task is handed over until its outcome
   * reaches the engine.
   *
   * @default 30000
   */
  heartbeatInterval?: number;

  /**
   * Maximum concurrent actor operation executions.
   *
   * @default 100
   */
  maxConcurrentActorOperations?: number;

  /**
   * Number of concurrent actor operation pollers.
   *
   * @default 2
   */
  actorPollerCount?: number;
}

/**
 * Lifecycle state of a worker.
 */
export enum WorkerState {
  /**
   * The worker is stopped and not polling for work.
   */
  STOPPED = 'stopped',

  /**
   * The worker is starting up: initializing pollers and connecting to the server.
   */
  STARTING = 'starting',

  /**
   * The worker is running and polling for work.
   */
  RUNNING = 'running',

  /**
   * The worker is shutting down gracefully, draining in-flight work.
   */
  SHUTTING_DOWN = 'shutting_down',

  /**
   * The worker is shutting down without waiting for in-flight work.
   */
  FORCE_SHUTDOWN = 'force_shutdown',
}

/**
 * Execution statistics for a worker, returned by `Worker.getStats()`.
 */
export interface WorkerStats {
  /**
   * Total number of workflows executed
   */
  workflowsExecuted: number;

  /**
   * Total number of tasks executed
   */
  tasksExecuted: number;

  /**
   * Current number of workflows in progress
   */
  workflowsInProgress: number;

  /**
   * Current number of tasks in progress
   */
  tasksInProgress: number;

  /**
   * Total number of errors encountered
   */
  errors: number;

  /**
   * Worker uptime in milliseconds
   */
  uptime: number;

  /**
   * Current worker state
   */
  state: WorkerState;

  /**
   * Worker identity
   */
  workerId: string;

  /**
   * Timestamp when the worker was started
   */
  startedAt?: Date;

  /**
   * Timestamp when the worker was stopped
   */
  stoppedAt?: Date;

  /**
   * Total number of actor operations executed
   */
  actorOperationsExecuted?: number;

  /**
   * Current number of actor operations in progress
   */
  actorOperationsInProgress?: number;
}

/**
 * Options for `Worker.shutdown()`.
 */
export interface ShutdownOptions {
  /**
   * Custom timeout in milliseconds.
   *
   * Overrides `shutdownGraceTime` for this shutdown.
   */
  timeout?: number;

  /**
   * Force immediate shutdown.
   *
   * If true, shutdown does not wait for in-flight executions to complete.
   *
   * @default false
   */
  force?: boolean;
}

/**
 * Worker identity information
 */
export interface WorkerIdentity {
  /**
   * Unique worker identifier
   */
  workerId: string;

  /**
   * The code release this worker is running (git sha, image digest, tag).
   */
  versionId?: string;

  /**
   * Binary checksum for determinism verification
   */
  binaryChecksum?: string;
}

/**
 * Worker capabilities
 */
export interface WorkerCapabilities {
  /**
   * Registered workflow types this worker can execute
   */
  workflows: string[];

  /**
   * Registered task types this worker can execute
   */
  tasks: string[];

  /**
   * Maximum concurrent workflow executions
   */
  maxConcurrentWorkflows: number;

  /**
   * Maximum concurrent task executions
   */
  maxConcurrentTasks: number;
}

/**
 * Worker health status
 */
export interface WorkerHealth {
  /**
   * Overall health status
   */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /**
   * Last heartbeat timestamp
   */
  lastHeartbeat: Date;

  /**
   * Worker uptime in milliseconds
   */
  uptime: number;

  /**
   * Memory usage in bytes
   */
  memoryUsage: number;

  /**
   * CPU usage percentage (0-100)
   */
  cpuUsage: number;
}

/**
 * Worker metadata
 */
export interface WorkerMetadata {
  /**
   * Worker identity
   */
  identity: WorkerIdentity;

  /**
   * Worker capabilities
   */
  capabilities: WorkerCapabilities;

  /**
   * Worker health information
   */
  health: WorkerHealth;
}

/**
 * Poller options
 */
export interface PollerOptions {
  /**
   * Polling interval in milliseconds
   */
  pollInterval: number;

  /**
   * Maximum concurrent executions
   */
  maxConcurrent: number;

  /**
   * Error backoff configuration
   */
  errorBackoff: {
    /**
     * Initial backoff delay in milliseconds
     */
    initial: number;

    /**
     * Maximum backoff delay in milliseconds
     */
    max: number;

    /**
     * Backoff multiplier on consecutive errors
     */
    multiplier: number;
  };
}

/**
 * Events a worker emits. Subscribe with `Worker.on()`.
 */
export type ServiceEvent =
  | 'started'
  | 'stopped'
  | 'error'
  | 'workflow-started'
  | 'workflow-completed'
  | 'workflow-failed'
  | 'task-started'
  | 'task-completed'
  | 'task-failed';

/**
 * Handler for a worker event. Its arguments depend on the event.
 */
export type ServiceEventHandler = (...args: any[]) => void;

/**
 * Logger the worker writes to. See `WorkerOptions.logger`.
 */
export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Cached step result for replay.
 *
 * Holds the result of a previously executed step (task, closure, and so on)
 * loaded from the journal. The worker injects these results into the workflow
 * context during replay.
 */
export interface CachedStepResult {
  /**
   * Step identifier (task_id or step_name)
   */
  stepId: string;

  /**
   * Step type (1 = Task, 2 = Closure, 3 = ChildWorkflow, 4 = SideEffect)
   */
  stepType: number;

  /**
   * Cached result value
   */
  result: any;

  /**
   * Whether the step failed (in which case result contains error info)
   */
  failed?: boolean;

  /**
   * Execution attempt number
   */
  executionAttempt?: number;
}

/**
 * A workflow or task execution request from the engine.
 */
export interface ExecutionRequest {
  /**
   * Unique execution ID
   */
  executionId: string;

  /**
   * Workflow or task type
   */
  type: string;

  /**
   * Input payload
   */
  input: any;

  /**
   * Execution metadata
   */
  metadata: ExecutionMetadata;

  /**
   * Cached step results for replay.
   *
   * Results of previously executed steps (tasks, closures, and so on) loaded
   * from the journal. The workflow executor injects these into the
   * WorkflowContext before running the workflow.
   */
  cachedStepResults?: CachedStepResult[];

  /**
   * Whether this is a replay execution.
   *
   * True if the workflow has executed before and is resuming from saved state.
   * When replaying, cached step results are used instead of re-executing steps.
   */
  isReplaying?: boolean;

  /**
   * Buffered events to inject before running the workflow.
   *
   * Populated from HandleEvent journal jobs when the workflow replays after an
   * EventReceived entry is appended. The executor calls
   * context.bufferEvent() for each entry before running the handler.
   *
   * `position` is the entry's place in the journal relative to the other
   * jobs of the same activation. A wait with a timeout compares it with the
   * position of its fired deadline timer, so an event that arrived after the
   * wait timed out is left for the next wait instead of rewriting history.
   *
   * `atMs` is when the engine journaled the event; taking the event moves the
   * workflow's clock to it.
   */
  bufferedEvents?: Array<{ eventName: string; payload: any; position?: number; atMs?: number }>;

  /**
   * When the engine journaled what this activation can hand the workflow, read
   * from the journal by the native layer. The workflow's clock is built from
   * these and nothing else. Absent when the request did not come from the
   * engine (a test driving the executor directly); the clock then starts at
   * the moment the context is created.
   */
  journalTimes?: JournalTimes;
}

/**
 * Times read from a workflow's journal, in milliseconds since the Unix epoch.
 */
export interface JournalTimes {
  /** When the workflow's start was journaled. */
  startedAtMs?: number;
  /** When each result was journaled, keyed as the workflow context holds it:
   * a step's id, `timer:{id}`, `child:{workflow id}`. */
  resolvedAt: Record<string, number>;
}

/**
 * Metadata that accompanies an execution request.
 */
export interface ExecutionMetadata {
  /**
   * Workflow ID
   */
  workflowId?: string;

  /**
   * Run ID
   */
  runId?: string;

  /**
   * Attempt number
   */
  attempt: number;

  /**
   * Heartbeat interval the engine judges this task by, in milliseconds.
   *
   * Undefined when the engine set no heartbeat limit. Carried so a handler can
   * pace itself: heartbeating less often than this is what gets a healthy task
   * killed.
   */
  heartbeatTimeoutMs?: number;

  /**
   * Task queue
   */
  taskQueue: string;

  /**
   * Namespace
   */
  namespace: string;

  /**
   * Scheduled time
   */
  scheduledTime?: Date;

  /**
   * Timeout in milliseconds
   */
  timeout?: number;

  /**
   * Retry policy
   */
  retryPolicy?: any;

  /**
   * Journal length (number of entries).
   *
   * Tells a fresh execution from a replay: if greater than 0, the workflow has
   * executed before.
   */
  journalLength?: number;
}

/**
 * The result of a workflow or task execution.
 */
export interface ExecutionResult {
  /**
   * Execution ID
   */
  executionId: string;

  /**
   * Success flag
   */
  success: boolean;

  /**
   * Result payload (if successful)
   */
  result?: any;

  /**
   * Error information (if failed)
   */
  error?: ExecutionError;

  /**
   * Execution duration in milliseconds
   */
  duration: number;

  /**
   * Commands generated during workflow execution.
   *
   * Includes step-level commands such as RecordStepResult for `ctx.execute()`
   * and ScheduleTask for `ctx.executeTask()`, which the worker sends to the
   * engine for journaling.
   */
  commands?: any[];

  /**
   * The id of every step (task, timer, child workflow) the code reached in
   * this activation, whether the journal already held its outcome or its
   * command is in `commands`. sdk-core checks them against the steps the
   * journal recorded to catch code that no longer replays the run.
   */
  reachedSteps?: string[];

  /**
   * Workflow context from the execution.
   *
   * Exposed so the worker can dispatch query and update requests to handlers
   * registered on the context.
   */
  context?: any;
}

/**
 * Error information for a failed execution.
 */
export interface ExecutionError {
  /**
   * Error message
   */
  message: string;

  /**
   * Error type/code: the error's `name` if it set one, else its class name.
   * The engine matches it against a retry policy's non-retryable list.
   */
  type: string;

  /**
   * True when the error carried a truthy `nonRetryable`. The engine then does
   * not retry the task, whatever its policy allows.
   */
  nonRetryable?: boolean;

  /**
   * Stack trace
   */
  stack?: string;

  /**
   * Original error cause
   */
  cause?: any;
}
