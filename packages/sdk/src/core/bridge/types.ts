/**
 * Types shared between the Orcher core and the TypeScript SDK.
 *
 * These mirror the Rust bridge layer in sdk-core, so the Neon bindings can pass
 * values to and from sdk-core directly, without a separate FFI layer.
 *
 * ## Terms
 *
 * - **ExecutionRequest**: request from the core to run workflow code
 * - **RequestJob**: one work item in a request (e.g., start workflow, fire timer,
 *   complete task)
 * - **ExecutionResult**: the SDK's response to the core after processing a request
 * - **Command**: an instruction for the server issued by the workflow (e.g., schedule
 *   task, start timer, complete workflow)
 *
 * ## Flow
 *
 * ```
 * Server → WorkflowExecutionTask → ExecutionRequest → TypeScript SDK
 *                                                            ↓
 *                                                    ExecutionResult
 *                                                            ↓
 *                                                      Commands → Server
 * ```
 *
 * @module @orcher/sdk/core/bridge/types
 */

import { Payload, WorkflowExecution } from './payload';
import type { TaskRetryPolicy } from '../../workflow/types';

// The task retry policy is the single canonical `Partial<RetryPolicy>` from
// workflow/types; re-exported here so bridge consumers keep the same import path.
export type { TaskRetryPolicy };

// ============================================================================
// Execution Request Types
// ============================================================================

/**
 * Request to execute workflow code in the TypeScript SDK.
 *
 * This is the primary interface between the Orcher core and the TypeScript SDK.
 * The core creates an ExecutionRequest and sends it to the SDK, which processes
 * the jobs and returns an ExecutionResult.
 *
 * Corresponds to: `orcher_sdk_core::bridge::ExecutionRequest`
 */
export interface ExecutionRequest {
  /** Unique identifier for this execution run */
  runId: string;

  /** Workflow execution identifiers */
  execution: WorkflowExecution;

  /** Timestamp when this request was created (ISO 8601) */
  timestamp: string;

  /** Jobs to be processed by the SDK */
  jobs: RequestJob[];

  /** Current length of the execution journal (event history) */
  journalLength: number;

  /** Whether this is a replay of historical events */
  isReplaying: boolean;

  /** Whether the workflow should restart fresh */
  restartFresh: boolean;
}

/**
 * Individual work item in an ExecutionRequest.
 *
 * Jobs represent different types of work that the SDK needs to process,
 * such as starting a workflow, handling events, or processing queries.
 *
 * Corresponds to: `orcher_sdk_core::bridge::RequestJob`
 */
export type RequestJob =
  | { type: 'StartWorkflow'; job: StartWorkflowJob }
  | { type: 'FireTimer'; job: FireTimerJob }
  | { type: 'CompleteTask'; job: CompleteTaskJob }
  | { type: 'HandleEvent'; job: HandleEventJob }
  | { type: 'ProcessQuery'; job: ProcessQueryJob }
  | { type: 'CancelWorkflow'; job: CancelWorkflowJob }
  | { type: 'UpdateState'; job: UpdateStateJob }
  | { type: 'EvictFromCache'; job: EvictFromCacheJob }
  | { type: 'ChildWorkflowStarted'; job: ChildWorkflowStartedJob }
  | { type: 'ChildWorkflowCompleted'; job: ChildWorkflowCompletedJob }
  | { type: 'ChildWorkflowFailed'; job: ChildWorkflowFailedJob }
  | { type: 'ChildWorkflowTimedOut'; job: ChildWorkflowTimedOutJob }
  | { type: 'ChildWorkflowCanceled'; job: ChildWorkflowCanceledJob }
  | { type: 'ChildWorkflowTerminated'; job: ChildWorkflowTerminatedJob }
  | { type: 'CompleteStep'; job: CompleteStepJob }
  | { type: 'FailStep'; job: FailStepJob };

/** Job to start a new workflow execution */
export interface StartWorkflowJob {
  /** Workflow type name */
  workflowType: string;

  /** Input arguments to the workflow */
  input: Payload[];

  /** Time when workflow was initiated */
  startedAt: string;
}

/** Job to fire a timer that has elapsed */
export interface FireTimerJob {
  /** Unique identifier for this timer */
  timerId: string;

  /** Sequence number in the event history */
  seq: number;
}

/** Job to complete a task with its result */
export interface CompleteTaskJob {
  /** Unique identifier for this task */
  taskId: string;

  /** Sequence number in the event history */
  seq: number;

  /** Whether the task completed successfully */
  successful: boolean;

  /** Task result payload (if successful) */
  result?: Payload;

  /** Task failure information (if failed) */
  failure?: TaskFailure;
}

/** Information about a task failure */
export interface TaskFailure {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;

  /** Whether this is a retryable error */
  retryable: boolean;
}

/** Job to handle an external event */
export interface HandleEventJob {
  /** Event name/type */
  eventName: string;

  /** Event payload */
  payload?: Payload;

  /** Sequence number in the event history */
  seq: number;
}

/** Job to process a query request */
export interface ProcessQueryJob {
  /** Query identifier */
  queryId: string;

  /** Query type/name */
  queryType: string;

  /** Query arguments */
  args: Payload[];
}

/** Job to cancel the workflow execution */
export interface CancelWorkflowJob {
  /** Reason for cancellation */
  reason?: string;

  /** Details about the cancellation */
  details?: Payload;
}

/** Job to update workflow state */
export interface UpdateStateJob {
  /** State key */
  key: string;

  /** State value */
  value: Payload;

  /** Sequence number in the event history */
  seq: number;
}

/** Job to evict workflow from cache */
export interface EvictFromCacheJob {
  /** Reason for eviction */
  reason: string;

  /** Additional details */
  details?: string;
}

/** Job when a child workflow has started */
export interface ChildWorkflowStartedJob {
  /** Parent-assigned child workflow ID */
  childWorkflowId: string;

  /** Server-assigned run ID */
  runId: string;

  /** Sequence number in the event history */
  seq: number;
}

/** Job when a child workflow has completed */
export interface ChildWorkflowCompletedJob {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Result from the child workflow */
  result: Payload;

  /** Sequence number in the event history */
  seq: number;
}

/** Job when a child workflow has failed */
export interface ChildWorkflowFailedJob {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Failure information */
  failure: ChildWorkflowFailure;

  /** Sequence number in the event history */
  seq: number;
}

/** Information about a child workflow failure */
export interface ChildWorkflowFailure {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;

  /** Whether this is a retryable error */
  retryable: boolean;
}

/** Job when a child workflow has timed out */
export interface ChildWorkflowTimedOutJob {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Last recorded status before timeout */
  lastStatus?: string;

  /** Sequence number in the event history */
  seq: number;
}

/** Job when a child workflow has been canceled */
export interface ChildWorkflowCanceledJob {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Cancellation details */
  details?: Payload;

  /** Sequence number in the event history */
  seq: number;
}

/** Job when a child workflow has been terminated */
export interface ChildWorkflowTerminatedJob {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Termination reason */
  reason?: string;

  /** Sequence number in the event history */
  seq: number;
}

/** Job to complete a workflow step */
export interface CompleteStepJob {
  /** Step identifier */
  stepId: string;

  /** Step result */
  result: Payload;

  /** Sequence number in the event history */
  seq: number;
}

/** Job when a workflow step has failed */
export interface FailStepJob {
  /** Step identifier */
  stepId: string;

  /** Failure information */
  failure: StepFailure;

  /** Sequence number in the event history */
  seq: number;
}

/** Information about a step failure */
export interface StepFailure {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;

  /** Whether this is a retryable error */
  retryable: boolean;
}

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * Response from the TypeScript SDK after processing an ExecutionRequest.
 *
 * The SDK processes the jobs in an ExecutionRequest and returns an
 * ExecutionResult containing commands to be executed by the server.
 *
 * Corresponds to: `orcher_sdk_core::bridge::ExecutionResult`
 */
export interface ExecutionResult {
  /** Run ID from the original request */
  runId: string;

  /** Whether execution was successful */
  successful: boolean;

  /** Commands to be sent to the server */
  commands: Command[];

  /** Error information if execution failed */
  error?: ExecutionError;
}

/**
 * Commands to be executed by the Orcher server.
 *
 * Commands represent the SDK's instructions to the server, such as
 * scheduling tasks, starting timers, or completing workflows.
 *
 * Corresponds to: `orcher_sdk_core::bridge::Command`
 */
export type Command =
  | { type: 'ScheduleTask'; command: ScheduleTaskCommand }
  | { type: 'StartTimer'; command: StartTimerCommand }
  | { type: 'CancelTimer'; command: CancelTimerCommand }
  | { type: 'SendEvent'; command: SendEventCommand }
  | { type: 'CompleteWorkflow'; command: CompleteWorkflowCommand }
  | { type: 'FailWorkflow'; command: FailWorkflowCommand }
  | { type: 'CancelWorkflow'; command: CancelWorkflowCommand }
  | { type: 'StartChildWorkflow'; command: StartChildWorkflowCommand }
  | { type: 'CancelChildWorkflow'; command: CancelChildWorkflowCommand }
  | { type: 'RequestCancellation'; command: RequestCancellationCommand }
  | { type: 'RestartFresh'; command: RestartFreshCommand }
  | { type: 'QueryChildWorkflow'; command: QueryChildWorkflowCommand }
  | { type: 'RecordStepResult'; command: RecordStepResultCommand }
  | { type: 'RespondToQuery'; command: QueryResponse };

/** Command to schedule a task for execution */
export interface ScheduleTaskCommand {
  /** Unique identifier for this task */
  taskId: string;

  /** Task queue to schedule on */
  taskQueue: string;

  /** Task type name */
  taskType: string;

  /** Input arguments to the task */
  input: Payload[];

  /** Timeout for task execution (milliseconds) */
  scheduleToCloseTimeout?: number;

  /** Timeout for task to start (milliseconds) */
  scheduleToStartTimeout?: number;

  /** Timeout for task to complete after starting (milliseconds) */
  startToCloseTimeout?: number;

  /** Retry policy for the task */
  retryPolicy?: TaskRetryPolicy;

  /** Additional headers */
  headers?: Record<string, Payload>;
}

/** Command to start a timer */
export interface StartTimerCommand {
  /** Unique identifier for this timer */
  timerId: string;

  /** Timer duration (milliseconds) */
  duration: number;
}

/** Command to cancel a timer */
export interface CancelTimerCommand {
  /** Timer ID to cancel */
  timerId: string;
}

/** Command to send an event to an external workflow */
export interface SendEventCommand {
  /** Target workflow ID */
  workflowId: string;

  /** Target run ID (optional, uses current run if not specified) */
  runId?: string;

  /** Event name */
  eventName: string;

  /** Event payload */
  payload?: Payload;

  /** Namespace for the target workflow */
  namespace?: string;
}

/** Command to complete a workflow successfully */
export interface CompleteWorkflowCommand {
  /** Workflow result */
  result?: Payload;
}

/** Command to fail a workflow */
export interface FailWorkflowCommand {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;
}

/** Command to cancel a workflow */
export interface CancelWorkflowCommand {
  /** Cancellation details */
  details?: Payload;
}

/** Command to start a child workflow */
export interface StartChildWorkflowCommand {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Workflow type */
  workflowType: string;

  /** Task queue */
  taskQueue: string;

  /** Input arguments */
  input: Payload[];

  /** Workflow execution timeout (milliseconds) */
  workflowExecutionTimeout?: number;

  /** Workflow run timeout (milliseconds) */
  workflowRunTimeout?: number;

  /** Workflow task timeout (milliseconds) */
  workflowTaskTimeout?: number;

  /** Namespace for the child workflow */
  namespace?: string;

  /** Parent close policy */
  parentClosePolicy?: ParentClosePolicy;

  /** Retry policy */
  retryPolicy?: TaskRetryPolicy;

  /** Additional headers */
  headers?: Record<string, Payload>;
}

/** Policy for child workflow when parent closes */
export enum ParentClosePolicy {
  /** Child workflow is not affected when parent closes */
  Unspecified = 'UNSPECIFIED',

  /** Terminate child workflow when parent closes */
  Terminate = 'TERMINATE',

  /** Abandon child workflow when parent closes */
  Abandon = 'ABANDON',

  /** Request cancellation of child workflow when parent closes */
  RequestCancel = 'REQUEST_CANCEL',
}

/** Command to cancel a child workflow */
export interface CancelChildWorkflowCommand {
  /** Child workflow ID to cancel */
  childWorkflowId: string;
}

/** Command to request cancellation of an external workflow */
export interface RequestCancellationCommand {
  /** Target workflow ID */
  workflowId: string;

  /** Target run ID (optional) */
  runId?: string;
}

/** Command to restart workflow execution from scratch */
export interface RestartFreshCommand {
  /** New workflow ID for the restarted execution */
  newWorkflowId?: string;

  /** Additional arguments for the restart */
  args?: Payload[];
}

/** Command to query a child workflow */
export interface QueryChildWorkflowCommand {
  /** Child workflow ID */
  childWorkflowId: string;

  /** Query type/name */
  queryType: string;

  /** Query arguments */
  args: Payload[];

  /** Query timeout (milliseconds) */
  timeout?: number;
}

/** Command to record a step result */
export interface RecordStepResultCommand {
  /** Step identifier */
  stepId: string;

  /** Step result (if successful) */
  result?: Payload;

  /** Step failure (if failed) */
  failure?: StepFailure;
}

/** Response to a query */
export interface QueryResponse {
  /** Query ID from the request */
  queryId: string;

  /** Whether query was successful */
  successful: boolean;

  /** Query result (if successful) */
  result?: Payload;

  /** Error information (if failed) */
  error?: QueryError;
}

/** Error information for a failed query */
export interface QueryError {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;
}

/** Error information for a failed execution */
export interface ExecutionError {
  /** Error message */
  message: string;

  /** Error source/type */
  source?: string;

  /** Stack trace */
  stackTrace?: string;

  /** Whether this is a retryable error */
  retryable: boolean;

  /** Original error cause (if available) */
  cause?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a job is a StartWorkflow job
 */
export function isStartWorkflowJob(
  job: RequestJob
): job is { type: 'StartWorkflow'; job: StartWorkflowJob } {
  return job.type === 'StartWorkflow';
}

/**
 * Type guard to check if a job is a FireTimer job
 */
export function isFireTimerJob(job: RequestJob): job is { type: 'FireTimer'; job: FireTimerJob } {
  return job.type === 'FireTimer';
}

/**
 * Type guard to check if a job is a CompleteTask job
 */
export function isCompleteTaskJob(
  job: RequestJob
): job is { type: 'CompleteTask'; job: CompleteTaskJob } {
  return job.type === 'CompleteTask';
}

/**
 * Type guard to check if a command is a ScheduleTask command
 */
export function isScheduleTaskCommand(
  command: Command
): command is { type: 'ScheduleTask'; command: ScheduleTaskCommand } {
  return command.type === 'ScheduleTask';
}

/**
 * Type guard to check if a command is a CompleteWorkflow command
 */
export function isCompleteWorkflowCommand(
  command: Command
): command is { type: 'CompleteWorkflow'; command: CompleteWorkflowCommand } {
  return command.type === 'CompleteWorkflow';
}
