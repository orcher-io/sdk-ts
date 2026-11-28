/**
 * Common types for workflows: durations, retry policies and workflow options.
 *
 * @packageDocumentation
 */

/**
 * Signature of a workflow function.
 *
 * Receives a WorkflowContext first, then its arguments, and resolves to the
 * workflow result.
 */
export type WorkflowFunction<TArgs extends any[] = any[], TReturn = any> = (
  ctx: any, // WorkflowContext
  ...args: TArgs
) => Promise<TReturn>;

/**
 * Signature of a task function.
 *
 * Receives a TaskContext first, then its input, and resolves to the task
 * result.
 */
export type TaskFunction<I = any, O = any> = (
  ctx: any, // TaskContext
  input: I
) => Promise<O>;

/**
 * A duration on a user-facing option.
 *
 * Accepts the {@link Duration} helper, which states its unit at the call site,
 * or a bare `number` of **milliseconds**. Prefer the helper: a bare number lets
 * a seconds/milliseconds mix-up through silently, since both are just `number`
 * to the compiler.
 */
export type DurationInput = Duration | number;

/** Converts a {@link DurationInput} to milliseconds for the wire. */
export function durationToMillis(value: DurationInput): number {
  return typeof value === 'number' ? value : value.toMilliseconds();
}

/**
 * A length of time whose unit is stated where it is created.
 *
 * @example
 * ```typescript
 * const timeout = Duration.fromMinutes(5);
 * const delay = Duration.fromSeconds(30);
 * await ctx.sleep(delay);
 * ```
 */
export class Duration {
  private readonly ms: number;

  private constructor(ms: number) {
    this.ms = ms;
  }

  /**
   * Create duration from milliseconds
   */
  static fromMilliseconds(ms: number): Duration {
    return new Duration(ms);
  }

  /**
   * Create duration from seconds
   */
  static fromSeconds(seconds: number): Duration {
    return new Duration(seconds * 1000);
  }

  /**
   * Create duration from minutes
   */
  static fromMinutes(minutes: number): Duration {
    return new Duration(minutes * 60 * 1000);
  }

  /**
   * Create duration from hours
   */
  static fromHours(hours: number): Duration {
    return new Duration(hours * 60 * 60 * 1000);
  }

  /**
   * Create duration from days
   */
  static fromDays(days: number): Duration {
    return new Duration(days * 24 * 60 * 60 * 1000);
  }

  /**
   * Get duration in milliseconds
   */
  toMilliseconds(): number {
    return this.ms;
  }

  /**
   * Get duration in seconds
   */
  toSeconds(): number {
    return this.ms / 1000;
  }

  /**
   * Get duration in minutes
   */
  toMinutes(): number {
    return this.ms / (60 * 1000);
  }

  /**
   * Get duration in hours
   */
  toHours(): number {
    return this.ms / (60 * 60 * 1000);
  }

  /**
   * Get duration in days
   */
  toDays(): number {
    return this.ms / (24 * 60 * 60 * 1000);
  }

  /**
   * Coerces a `Duration` or a human-readable string into a `Duration`.
   *
   * Accepts a `Duration`, or a string like `"500ms"`, `"30s"`, `"5m"`, `"1h"`,
   * `"2d"` (fractions allowed: `"1.5h"`). Options typed `Duration | string` use
   * it so timeouts can come from config files or environment variables.
   *
   * A bare `number` is intentionally NOT accepted, because its unit would be
   * ambiguous (milliseconds or seconds). Use an explicit factory such as
   * `Duration.fromMilliseconds(500)` or `Duration.fromSeconds(30)`.
   *
   * @throws Error if the string is not a number followed by `ms`, `s`, `m`, `h`
   *   or `d`
   *
   * @example
   * ```typescript
   * Duration.from('1h');      // one hour
   * Duration.from('500ms');   // 500 milliseconds
   * ```
   */
  static from(value: Duration | string): Duration {
    if (value instanceof Duration) {
      return value;
    }
    const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/.exec(value);
    if (!match) {
      throw new Error(
        `Invalid duration string: ${JSON.stringify(value)} ` +
          `(expected e.g. "500ms", "30s", "5m", "1h", "2d")`
      );
    }
    const n = parseFloat(match[1]!);
    switch (match[2]!) {
      case 'ms':
        return Duration.fromMilliseconds(n);
      case 's':
        return Duration.fromSeconds(n);
      case 'm':
        return Duration.fromMinutes(n);
      case 'h':
        return Duration.fromHours(n);
      case 'd':
        return Duration.fromDays(n);
      /* istanbul ignore next — regex guarantees one of the above */
      default:
        throw new Error(`Invalid duration unit: ${match[2]}`);
    }
  }
}

/**
 * Attempts a retry policy allows when it leaves `maxAttempts` out, the first
 * one included.
 */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Retry policy for tasks and workflows.
 *
 * Intervals are in milliseconds. The engine works in whole seconds, so
 * sub-second intervals are rounded down.
 */
export interface RetryPolicy {
  /**
   * Maximum number of attempts, the first one included: 1 never retries and
   * 3 allows two retries. 0 retries without limit. A policy that leaves it
   * out gets {@link DEFAULT_MAX_ATTEMPTS} (3), never unlimited.
   */
  maxAttempts: number;

  /**
   * Initial retry interval in milliseconds
   */
  initialInterval: number;

  /**
   * Maximum retry interval in milliseconds
   */
  maxInterval: number;

  /**
   * Backoff coefficient (multiplier for each retry)
   */
  backoffCoefficient: number;

  /**
   * Error type names that should never be retried
   */
  nonRetryableErrorTypes?: string[];
}

/**
 * A retry policy with every field optional.
 *
 * Used where a caller overrides only some fields (task options, DI decorators,
 * interceptors, the native bridge) and the engine fills in the rest. It is
 * `Partial<RetryPolicy>` so the retry fields are defined in one place.
 */
export type TaskRetryPolicy = Partial<RetryPolicy>;

/**
 * Options for `ctx.executeChildWorkflow()` and `ctx.startChildWorkflow()`.
 *
 * The one definition: the package root, `@orcher/sdk/workflow` and the
 * context all export this type. It is also exported as
 * `ContextChildWorkflowOptions`, the same type under an older name.
 */
export interface ChildWorkflowOptions {
  /** Workflow ID for the child workflow (generated if not provided) */
  workflowId?: string;
  /** Task queue for the child workflow (inherits from parent if not provided) */
  taskQueue?: string;
  /** Execution timeout: a `Duration`, or a number of milliseconds */
  timeout?: DurationInput;
  /**
   * Execution timeout in milliseconds.
   *
   * @deprecated Use `timeout`, which also takes a `Duration`. This is the name
   * an older copy of this type used; it is still honoured when `timeout` is
   * not set.
   */
  executionTimeout?: number;
  /** What happens to the child when the parent closes */
  parentClosePolicy?: ParentClosePolicy;
  /**
   * How the child is retried when a run of it fails, with the same meaning as
   * a workflow start's `retryPolicy`: `maxAttempts` counts the first run, `0`
   * retries without limit, and leaving it out allows 3. Intervals are in
   * milliseconds. When unset, no policy is sent: a failed child is not
   * retried and its failure reaches the parent.
   */
  retryPolicy?: Partial<RetryPolicy>;
}

/**
 * What happens to a child workflow when its parent closes.
 *
 * The one enum for this, used by `ctx.executeChildWorkflow()` and
 * `ctx.startChildWorkflow()` and exported from the package root. It is also
 * exported as `ContextParentClosePolicy`, the same enum under an older name.
 */
export enum ParentClosePolicy {
  /**
   * Terminate the child workflow when the parent closes.
   */
  TERMINATE = 'TERMINATE',

  /**
   * Request cancellation of the child workflow when the parent closes. The
   * default.
   */
  REQUEST_CANCEL = 'REQUEST_CANCEL',

  /**
   * Request cancellation of the child workflow when the parent closes.
   *
   * @deprecated Use {@link ParentClosePolicy.REQUEST_CANCEL}; this is the same
   * policy under the name a second, now merged, enum used.
   */
  CANCEL = 'REQUEST_CANCEL',

  /**
   * Abandon the child workflow: it keeps running after the parent closes.
   */
  ABANDON = 'ABANDON',
}

/**
 * Options for restarting a workflow with a fresh execution history.
 *
 * Restart fresh is useful to:
 * - Prevent unbounded history growth in long-running workflows
 * - Periodically refresh code versions
 * - Implement entity workflows that run forever
 * - Checkpoint state and start fresh
 *
 * The one definition: the package root, `@orcher/sdk/workflow` and the
 * context all export this type. Pass the new input as the first argument of
 * `ctx.restartFresh(input, options)`.
 */
export interface RestartFreshOptions {
  /**
   * New workflow type (optional)
   *
   * If provided, the restarted workflow will execute with this type.
   * Useful for migrating to a new workflow version.
   */
  workflowType?: string;

  /**
   * New task queue (optional)
   *
   * If provided, the restarted workflow will be routed to this queue.
   * Useful for moving workflows to different worker pools.
   */
  taskQueue?: string;

  /**
   * New execution timeout (optional).
   *
   * If provided, the restarted workflow will use this timeout: a `Duration`,
   * or a number of milliseconds.
   */
  timeout?: DurationInput;

  /**
   * Retry policy for the new execution (optional), with the same meaning as a
   * workflow start's `retryPolicy`: `maxAttempts` counts the first run, `0`
   * retries without limit, and leaving it out allows 3. Intervals are in
   * milliseconds. When unset, no policy is sent and the new execution keeps
   * the current one.
   */
  retryPolicy?: Partial<RetryPolicy>;
}

/**
 * Options for sending an event.
 */
export interface EventOptions {
  /**
   * Timeout for sending the event
   */
  timeout?: number;
}

/**
 * Options for querying a workflow.
 */
export interface QueryOptions {
  /**
   * Timeout for the query
   */
  timeout?: number;

  /**
   * Reject condition
   */
  rejectCondition?: QueryRejectCondition;
}

/**
 * When a query is rejected instead of answered.
 */
export enum QueryRejectCondition {
  /**
   * Reject if workflow is not open
   */
  NOT_OPEN = 'NOT_OPEN',

  /**
   * Reject if workflow is not completed
   */
  NOT_COMPLETED = 'NOT_COMPLETED',
}
