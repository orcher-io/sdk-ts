/**
 * Option types for the `Client` and `WorkflowHandle`.
 *
 * @module @orcher/sdk
 */

import type { DurationInput } from '../workflow/types';
import type { RetryPolicy } from '../workflow/types';

/**
 * Options for starting a workflow.
 */
export interface WorkflowStartOptions {
  /**
   * Identifier for the workflow execution, unique within the namespace.
   * A random UUID is generated when omitted, as in the Rust and Python SDKs.
   */
  workflowId?: string;

  /**
   * The workflow type name (typically the function name).
   */
  workflowType: string;

  /**
   * The task queue to use for this workflow. Defaults to `default`.
   */
  taskQueue?: string;

  /**
   * Arguments to pass to the workflow function.
   */
  args?: unknown[];

  /**
   * Total time allowed for the whole workflow execution: a `Duration`, or
   * a bare number of **milliseconds**.
   *
   * When omitted the workflow runs without an execution deadline: the server
   * only considers a workflow for timeout when this is set.
   */
  workflowExecutionTimeout?: DurationInput;

  /**
   * Time allowed for a single workflow run: a `Duration`, or a bare
   * number of **milliseconds**.
   */
  workflowRunTimeout?: DurationInput;

  /**
   * Time allowed to process a single workflow task: a `Duration`, or a
   * bare number of **milliseconds**.
   */
  workflowTaskTimeout?: DurationInput;

  /**
   * What to do when `workflowId` is already in use in the namespace.
   *
   * A workflow id names at most one open run: starting one whose run is still
   * open rejects with a `WorkflowError` whose code is
   * `WORKFLOW_ALREADY_EXISTS` and whose `details.runId` names that run, under
   * every policy but `TerminateIfRunning`. Unset leaves the rest to the
   * server, which allows a new run once the previous one has closed.
   */
  workflowIdReusePolicy?: WorkflowIdReusePolicy;

  /**
   * Cron schedule for periodic workflow execution.
   */
  cronSchedule?: string;

  /**
   * Workflow-level retry policy (opt-in).
   *
   * When omitted, a failed workflow is **not** retried. When set with
   * `maxAttempts > 0`, a failed workflow is retried as a fresh run (new run,
   * separate event history). Intervals are in milliseconds.
   */
  retryPolicy?: Partial<RetryPolicy>;

  /**
   * **Not supported yet: passing it throws a `ClientError`.**
   *
   * Reserved for non-indexed metadata attached to the workflow. The wire
   * carries this as `annotations`, but the SDK does not send it yet, and
   * refusing it is better than accepting and silently discarding it.
   *
   * @deprecated Not supported yet; passing it throws.
   */
  memo?: Record<string, unknown>;

  /**
   * **Not supported yet: passing it throws a `ClientError`.**
   *
   * Reserved for indexed metadata to query the workflow by. The wire carries
   * this as `labels`, but the SDK does not send it yet, and refusing it is
   * better than accepting and silently discarding it.
   *
   * @deprecated Not supported yet; passing it throws.
   */
  searchAttributes?: Record<string, unknown>;
}

/**
 * Options for getting a workflow handle.
 */
export interface WorkflowHandleOptions {
  /** The workflow id. */
  workflowId: string;

  /**
   * Run id of a specific workflow run. When omitted, the handle addresses
   * the latest run.
   */
  runId?: string;
}

/**
 * Whether a start may use a workflow id an earlier run already carried.
 *
 * An open run refuses a start under every policy but `TerminateIfRunning`;
 * the policies differ in what they allow once it has closed.
 */
export enum WorkflowIdReusePolicy {
  /**
   * Start once the previous run has closed, however it closed.
   */
  AllowDuplicate = 'ALLOW_DUPLICATE',

  /**
   * Start once the previous run has closed without completing: failed,
   * canceled, terminated or timed out.
   */
  AllowDuplicateFailedOnly = 'ALLOW_DUPLICATE_FAILED_ONLY',

  /**
   * Never start an id a run has carried before.
   */
  RejectDuplicate = 'REJECT_DUPLICATE',

  /**
   * Terminate the open run, if there is one, and start.
   */
  TerminateIfRunning = 'TERMINATE_IF_RUNNING',
}

/**
 * Options for querying a workflow.
 */
export interface QueryOptions {
  /** Query timeout in milliseconds. */
  timeout?: number;

  /** Whether a cached result may be returned. */
  useCache?: boolean;
}

/**
 * Options for sending an event to a workflow.
 */
export interface EventOptions {
  /** Event name. */
  name: string;

  /** Event payload. */
  payload?: unknown;

  /** Whether to wait for the workflow to process the event. */
  waitForProcessing?: boolean;
}
