/**
 * Execution-layer error types for the Orcher TypeScript SDK.
 *
 * This module provides:
 * - A base error class with error codes and severity
 * - Workflow, task, worker, serialization, and configuration errors
 * - Retryable vs permanent classification
 * - Type guards and conversion helpers
 *
 * @packageDocumentation
 */

import { OrcherError, ClientError } from '../core/errors';
import type { ErrorCode as TransportErrorCode } from '../core/types';

/**
 * Error codes for the execution layer (workflows, tasks, workers).
 */
export enum ErrorCode {
  // Generic errors (1000-1099)
  UNKNOWN = 'UNKNOWN',
  INTERNAL = 'INTERNAL',
  CONFIGURATION = 'CONFIGURATION',
  SERIALIZATION = 'SERIALIZATION',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',

  // Workflow errors (2000-2099)
  WORKFLOW_EXECUTION_FAILED = 'WORKFLOW_EXECUTION_FAILED',
  WORKFLOW_TIMEOUT = 'WORKFLOW_TIMEOUT',
  WORKFLOW_CANCELED = 'WORKFLOW_CANCELED',
  WORKFLOW_TERMINATED = 'WORKFLOW_TERMINATED',
  WORKFLOW_NOT_FOUND = 'WORKFLOW_NOT_FOUND',
  WORKFLOW_ALREADY_EXISTS = 'WORKFLOW_ALREADY_EXISTS',
  WORKFLOW_PANIC = 'WORKFLOW_PANIC',
  WORKFLOW_NON_DETERMINISTIC = 'WORKFLOW_NON_DETERMINISTIC',
  WORKFLOW_INVALID_STATE = 'WORKFLOW_INVALID_STATE',
  WORKFLOW_REPLAY_ERROR = 'WORKFLOW_REPLAY_ERROR',
  WORKFLOW_VERSION_MISMATCH = 'WORKFLOW_VERSION_MISMATCH',
  WORKFLOW_SUSPENDED = 'WORKFLOW_SUSPENDED',

  // Task errors (3000-3099)
  TASK_EXECUTION_FAILED = 'TASK_EXECUTION_FAILED',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  TASK_CANCELED = 'TASK_CANCELED',
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_COMPLETED = 'TASK_ALREADY_COMPLETED',
  TASK_PANIC = 'TASK_PANIC',
  TASK_RETRY_LIMIT_EXCEEDED = 'TASK_RETRY_LIMIT_EXCEEDED',
  TASK_INVALID_INPUT = 'TASK_INVALID_INPUT',
  TASK_HEARTBEAT_FAILED = 'TASK_HEARTBEAT_FAILED',
  TASK_HEARTBEAT_TIMEOUT = 'TASK_HEARTBEAT_TIMEOUT',

  // Client errors (4000-4099)
  CLIENT_CONNECTION_FAILED = 'CLIENT_CONNECTION_FAILED',
  CLIENT_INVALID_REQUEST = 'CLIENT_INVALID_REQUEST',
  CLIENT_UNAUTHORIZED = 'CLIENT_UNAUTHORIZED',
  CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',
  CLIENT_CONFLICT = 'CLIENT_CONFLICT',
  CLIENT_RATE_LIMITED = 'CLIENT_RATE_LIMITED',

  // Service errors (5000-5099)
  SERVICE_NOT_RUNNING = 'SERVICE_NOT_RUNNING',
  SERVICE_ALREADY_RUNNING = 'SERVICE_ALREADY_RUNNING',
  SERVICE_SHUTDOWN = 'SERVICE_SHUTDOWN',
  SERVICE_REGISTRATION_FAILED = 'SERVICE_REGISTRATION_FAILED',
  SERVICE_WORKER_FAILED = 'SERVICE_WORKER_FAILED',

  // Child workflow errors (6000-6099)
  CHILD_WORKFLOW_FAILED = 'CHILD_WORKFLOW_FAILED',
  CHILD_WORKFLOW_TIMEOUT = 'CHILD_WORKFLOW_TIMEOUT',
  CHILD_WORKFLOW_CANCELED = 'CHILD_WORKFLOW_CANCELED',

  // Event errors (7000-7099)
  EVENT_ERROR = 'EVENT_ERROR',
  EVENT_NOT_FOUND = 'EVENT_NOT_FOUND',
  EVENT_TIMEOUT = 'EVENT_TIMEOUT',

  // Query errors (8000-8099)
  QUERY_ERROR = 'QUERY_ERROR',
  QUERY_NOT_FOUND = 'QUERY_NOT_FOUND',
  QUERY_FAILED = 'QUERY_FAILED',
}

/**
 * Error severity levels.
 */
export enum ErrorSeverity {
  /** Informational: expected control flow rather than a failure. */
  INFO = 'INFO',
  /** A recoverable error. */
  WARNING = 'WARNING',
  /** A failure that may be retryable. */
  ERROR = 'ERROR',
  /** A fatal error; never retryable. */
  CRITICAL = 'CRITICAL',
}

/**
 * Base class for execution-layer errors (workflow, task, worker).
 *
 * Extends {@link OrcherError} with:
 * - An execution-layer error code
 * - A severity level
 * - Retryability classification
 * - Additional context data
 *
 * @example
 * ```typescript
 * throw new OrchestrationError(
 *   'Failed to connect to server',
 *   ErrorCode.CLIENT_CONNECTION_FAILED,
 *   { serverUrl: 'localhost:50051' }
 * );
 * ```
 */
export class OrchestrationError extends OrcherError {
  /**
   * Error code, narrowed to the execution vocabulary.
   *
   * `declare` is required: the base class assigns `code`, and at ES2022 a
   * re-declared field would be emitted as a class field and overwrite that
   * assignment with `undefined` after `super()`.
   */
  declare public readonly code: ErrorCode;

  /** Error severity level. */
  public readonly severity: ErrorSeverity;

  /** Additional context data. */
  public readonly details?: any;

  /** When the error was created. */
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    details?: any,
    severity: ErrorSeverity = ErrorSeverity.ERROR
  ) {
    // The two vocabularies are disjoint sets of strings over the same
    // primitive; the base stores whichever one its subtree uses.
    super(message, code as unknown as TransportErrorCode);
    this.name = 'OrchestrationError';
    this.severity = severity;
    this.details = details;
    this.timestamp = new Date();

    // Start the stack trace at the throw site (V8 only).
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the prototype explicitly so instanceof works on subclasses.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Whether the failed operation may be retried. The inverse of `isPermanent()`.
   *
   * @returns True if the operation should be retried
   */
  isRetryable(): boolean {
    return !this.isPermanent();
  }

  /**
   * Whether this error is permanent, meaning a retry cannot succeed.
   *
   * Configuration, invalid-input, not-found, and determinism errors are
   * permanent, as is any error with `CRITICAL` severity.
   *
   * @returns True if the error is fatal and should not be retried
   */
  isPermanent(): boolean {
    const permanentCodes = [
      ErrorCode.CONFIGURATION,
      ErrorCode.WORKFLOW_NON_DETERMINISTIC,
      ErrorCode.WORKFLOW_VERSION_MISMATCH,
      ErrorCode.WORKFLOW_INVALID_STATE,
      ErrorCode.TASK_INVALID_INPUT,
      ErrorCode.CLIENT_INVALID_REQUEST,
      ErrorCode.CLIENT_UNAUTHORIZED,
      ErrorCode.CLIENT_NOT_FOUND,
      ErrorCode.WORKFLOW_NOT_FOUND,
      ErrorCode.TASK_NOT_FOUND,
    ];

    return permanentCodes.includes(this.code) || this.severity === ErrorSeverity.CRITICAL;
  }

  /** Serialize the error, including severity, details, and stack, to a plain object. */
  override toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }

  /** A short message for display: the message followed by the code. */
  toUserMessage(): string {
    return `${this.message} (${this.code})`;
  }
}

/**
 * JSON marker key that encodes a terminal task failure as an injected replay result.
 *
 * When the engine replays a task that failed terminally (durable task-failure mode), the
 * worker injects a sentinel object under this key instead of a success value. `executeTask`
 * and `execute` decode it on replay and throw a catchable {@link WorkflowError.taskFailed}.
 * The key must stay byte-identical across SDKs (Rust and TypeScript use
 * `__orcher_task_failed__`; Python aliases its key).
 */
export const TASK_FAILED_SENTINEL_KEY = '__orcher_task_failed__';

/**
 * An error raised during workflow execution.
 *
 * Covers task failures, invalid state, determinism violations, and
 * client-side workflow conditions such as `WORKFLOW_NOT_FOUND`.
 */
export class WorkflowError extends OrchestrationError {
  constructor(message: string, code: ErrorCode, details?: any, severity?: ErrorSeverity) {
    super(message, code, details, severity);
    this.name = 'WorkflowError';
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }

  /** A task that failed after exhausting its attempts. */
  static taskFailed(taskType: string, attempts: number, reason: string): WorkflowError {
    return new WorkflowError(
      `Task '${taskType}' failed after ${attempts} attempts: ${reason}`,
      ErrorCode.TASK_EXECUTION_FAILED,
      { taskType, attempts, reason }
    );
  }

  /** A child workflow that failed. */
  static childWorkflowFailed(
    workflowType: string,
    workflowId: string,
    reason: string
  ): WorkflowError {
    return new WorkflowError(
      `Child workflow '${workflowType}' (${workflowId}) failed: ${reason}`,
      ErrorCode.CHILD_WORKFLOW_FAILED,
      { workflowType, workflowId, reason }
    );
  }

  /** Replay diverged from the recorded history. Critical severity. */
  static nonDeterministic(reason: string): WorkflowError {
    return new WorkflowError(
      `Non-deterministic workflow execution: ${reason}`,
      ErrorCode.WORKFLOW_NON_DETERMINISTIC,
      { reason },
      ErrorSeverity.CRITICAL
    );
  }

  /** The workflow exceeded its execution timeout. */
  static timeout(duration: number): WorkflowError {
    return new WorkflowError(
      `Workflow execution timed out after ${duration}ms`,
      ErrorCode.WORKFLOW_TIMEOUT,
      { duration }
    );
  }

  /** The workflow was canceled. */
  static canceled(): WorkflowError {
    return new WorkflowError('Workflow was canceled', ErrorCode.WORKFLOW_CANCELED);
  }

  /** No workflow with this id exists. Critical severity. */
  static notFound(workflowId: string): WorkflowError {
    return new WorkflowError(
      `Workflow '${workflowId}' not found`,
      ErrorCode.WORKFLOW_NOT_FOUND,
      { workflowId },
      ErrorSeverity.CRITICAL
    );
  }

  /** The workflow is in an invalid state. Critical severity. */
  static invalidState(reason: string): WorkflowError {
    return new WorkflowError(
      `Invalid workflow state: ${reason}`,
      ErrorCode.WORKFLOW_INVALID_STATE,
      { reason },
      ErrorSeverity.CRITICAL
    );
  }

  /** The workflow version does not match the expected one. Critical severity. */
  static versionMismatch(expected: string, actual: string): WorkflowError {
    return new WorkflowError(
      `Version mismatch: expected ${expected}, got ${actual}`,
      ErrorCode.WORKFLOW_VERSION_MISMATCH,
      { expected, actual },
      ErrorSeverity.CRITICAL
    );
  }

  /**
   * The workflow is suspended, waiting on pending operations.
   *
   * Suspension is expected control flow, not a failure, so the severity is `INFO`.
   * See {@link isWorkflowSuspension}.
   */
  static suspended(reason: string, pendingOperations: string[]): WorkflowError {
    return new WorkflowError(
      `Workflow suspended: ${reason}`,
      ErrorCode.WORKFLOW_SUSPENDED,
      { reason, pendingOperations },
      ErrorSeverity.INFO
    );
  }
}

/**
 * What a workflow outcome error carries besides its message.
 */
export interface WorkflowOutcomeDetails {
  /** The workflow whose result was awaited. */
  workflowId: string;
  /** The run, when the handle names one. */
  runId?: string;
}

/**
 * Base class of the errors `WorkflowHandle.result()` rejects with when the
 * workflow ended without a result.
 *
 * Catch this for "the workflow did not complete", or one of its subclasses for
 * how it ended: {@link WorkflowFailedError}, {@link WorkflowCanceledError},
 * {@link WorkflowTerminatedError} or {@link WorkflowTimedOutError}. Each is a
 * `WorkflowError`, and so an `OrcherError`, so existing `instanceof` checks
 * keep matching.
 *
 * @example
 * ```typescript
 * try {
 *   await handle.result();
 * } catch (err) {
 *   if (err instanceof WorkflowFailedError) {
 *     console.error(`Workflow failed: ${err.failure}`);
 *   } else if (err instanceof WorkflowCanceledError) {
 *     // canceled on purpose
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 */
export class WorkflowOutcomeError extends WorkflowError {
  /** The workflow whose result was awaited. */
  public readonly workflowId: string;
  /** The run, when the handle names one. */
  public readonly runId?: string;

  constructor(
    message: string,
    code: ErrorCode,
    outcome: WorkflowOutcomeDetails,
    details: Record<string, unknown> = {},
    cause?: Error
  ) {
    super(message, code, { ...outcome, ...details });
    this.name = 'WorkflowOutcomeError';
    this.workflowId = outcome.workflowId;
    this.runId = outcome.runId;
    if (cause !== undefined) {
      // `cause` is assigned by OrcherError's constructor, which this subtree
      // does not reach with one.
      (this as { cause?: Error }).cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The workflow failed: its code threw, or the engine failed the run.
 *
 * Code `WORKFLOW_EXECUTION_FAILED`.
 */
export class WorkflowFailedError extends WorkflowOutcomeError {
  /**
   * The failure the server recorded for the run, usually the message of the
   * error the workflow threw.
   */
  public readonly failure: string;

  constructor(outcome: WorkflowOutcomeDetails, failure: string, cause?: Error) {
    super(
      `Workflow ${outcome.workflowId} failed: ${failure}`,
      ErrorCode.WORKFLOW_EXECUTION_FAILED,
      outcome,
      { failure },
      cause
    );
    this.name = 'WorkflowFailedError';
    this.failure = failure;
  }
}

/**
 * The workflow was canceled, for example with `WorkflowHandle.cancel()`.
 *
 * Code `WORKFLOW_CANCELED`.
 */
export class WorkflowCanceledError extends WorkflowOutcomeError {
  constructor(outcome: WorkflowOutcomeDetails, cause?: Error) {
    super(
      `Workflow ${outcome.workflowId} was canceled`,
      ErrorCode.WORKFLOW_CANCELED,
      outcome,
      {},
      cause
    );
    this.name = 'WorkflowCanceledError';
  }
}

/**
 * The workflow was terminated, for example with `WorkflowHandle.terminate()`.
 *
 * Code `WORKFLOW_TERMINATED`.
 */
export class WorkflowTerminatedError extends WorkflowOutcomeError {
  constructor(outcome: WorkflowOutcomeDetails, cause?: Error) {
    super(
      `Workflow ${outcome.workflowId} was terminated`,
      ErrorCode.WORKFLOW_TERMINATED,
      outcome,
      {},
      cause
    );
    this.name = 'WorkflowTerminatedError';
  }
}

/**
 * The workflow ran past its execution timeout (`workflowExecutionTimeout`).
 *
 * Code `WORKFLOW_TIMEOUT`. Not to be confused with `TimeoutError`, which
 * `resultWithTimeout()` throws when the caller stops waiting while the
 * workflow keeps running.
 */
export class WorkflowTimedOutError extends WorkflowOutcomeError {
  constructor(outcome: WorkflowOutcomeDetails, cause?: Error) {
    super(
      `Workflow ${outcome.workflowId} timed out`,
      ErrorCode.WORKFLOW_TIMEOUT,
      outcome,
      {},
      cause
    );
    this.name = 'WorkflowTimedOutError';
  }
}

/**
 * Whether a thrown value is the workflow-suspension control signal.
 *
 * Inside a workflow, `ctx.executeTask()` / `ctx.waitForEvent()` / sessions
 * suspend by **throwing** {@link WorkflowError.suspended}. A `try/catch` around
 * those calls catches that signal like any other error, so if you catch errors
 * around them, you MUST re-throw the suspension:
 *
 * ```ts
 * try {
 *   await ctx.executeTask(chargeCard, input);
 * } catch (e) {
 *   if (isWorkflowSuspension(e)) throw e; // never swallow suspension
 *   // ...handle a real task failure...
 * }
 * ```
 *
 * (The runtime also re-asserts a swallowed suspension as a safety net, but code
 * that re-throws is correct by construction.) Detection is by error code, so it
 * holds even if the value crossed a boundary and lost its prototype.
 */
export function isWorkflowSuspension(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === ErrorCode.WORKFLOW_SUSPENDED
  );
}

/**
 * An error raised during task execution.
 *
 * Covers failures, timeouts, cancellation, missed heartbeats, and exhausted retries.
 */
export class TaskError extends OrchestrationError {
  constructor(message: string, code: ErrorCode, details?: any, severity?: ErrorSeverity) {
    super(message, code, details, severity);
    this.name = 'TaskError';
    Object.setPrototypeOf(this, TaskError.prototype);
  }

  /** The task failed. */
  static executionFailed(reason: string): TaskError {
    return new TaskError(`Task execution failed: ${reason}`, ErrorCode.TASK_EXECUTION_FAILED, {
      reason,
    });
  }

  /** The task exceeded its timeout. */
  static timeout(duration: number): TaskError {
    return new TaskError(`Task execution timed out after ${duration}ms`, ErrorCode.TASK_TIMEOUT, {
      duration,
    });
  }

  /** The task was canceled. */
  static canceled(): TaskError {
    return new TaskError('Task was canceled', ErrorCode.TASK_CANCELED);
  }

  /** No heartbeat arrived within the heartbeat timeout. */
  static heartbeatTimeout(duration: number): TaskError {
    return new TaskError(
      `No heartbeat received within ${duration}ms`,
      ErrorCode.TASK_HEARTBEAT_TIMEOUT,
      { duration }
    );
  }

  /** The task failed on every allowed attempt. */
  static retryLimitExceeded(attempts: number): TaskError {
    return new TaskError(
      `Task failed after ${attempts} retry attempts`,
      ErrorCode.TASK_RETRY_LIMIT_EXCEEDED,
      { attempts }
    );
  }

  /** The task input is invalid. Critical severity. */
  static invalidInput(reason: string): TaskError {
    return new TaskError(
      `Invalid task input: ${reason}`,
      ErrorCode.TASK_INVALID_INPUT,
      { reason },
      ErrorSeverity.CRITICAL
    );
  }

  /** No task with this id exists. Critical severity. */
  static notFound(taskId: string): TaskError {
    return new TaskError(
      `Task '${taskId}' not found`,
      ErrorCode.TASK_NOT_FOUND,
      { taskId },
      ErrorSeverity.CRITICAL
    );
  }
}

/**
 * Client operation errors.
 *
 * Re-exported from the transport layer rather than redefined here, so there is
 * a single `ClientError` class and catching it catches what the client throws.
 */
export { ClientError };

/**
 * An error raised by a worker, for example while polling, registering, or
 * shutting down.
 */
export class WorkerError extends OrchestrationError {
  constructor(message: string, code: ErrorCode, details?: any, severity?: ErrorSeverity) {
    super(message, code, details, severity);
    this.name = 'WorkerError';
    Object.setPrototypeOf(this, WorkerError.prototype);
  }

  /** The worker is not running. Critical severity. */
  static notRunning(): WorkerError {
    return new WorkerError(
      'Service is not running',
      ErrorCode.SERVICE_NOT_RUNNING,
      undefined,
      ErrorSeverity.CRITICAL
    );
  }

  /** The worker is already running. Critical severity. */
  static alreadyRunning(): WorkerError {
    return new WorkerError(
      'Service is already running',
      ErrorCode.SERVICE_ALREADY_RUNNING,
      undefined,
      ErrorSeverity.CRITICAL
    );
  }

  /** The worker is shutting down. */
  static shutdown(reason: string): WorkerError {
    return new WorkerError(`Service shutdown: ${reason}`, ErrorCode.SERVICE_SHUTDOWN, {
      reason,
    });
  }

  /** A workflow, task, or other component could not be registered. */
  static registrationFailed(type: string, name: string, reason: string): WorkerError {
    return new WorkerError(
      `Failed to register ${type} '${name}': ${reason}`,
      ErrorCode.SERVICE_REGISTRATION_FAILED,
      { type, name, reason }
    );
  }

  /** A worker failed. */
  static workerFailed(workerId: string, reason: string): WorkerError {
    return new WorkerError(
      `Worker '${workerId}' failed: ${reason}`,
      ErrorCode.SERVICE_WORKER_FAILED,
      { workerId, reason }
    );
  }
}

/**
 * A value could not be serialized or deserialized.
 */
export class SerializationError extends OrchestrationError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.SERIALIZATION, details);
    this.name = 'SerializationError';
    Object.setPrototypeOf(this, SerializationError.prototype);
  }

  /** A value could not be serialized. */
  static serializationFailed(type: string, reason: string): SerializationError {
    return new SerializationError(`Failed to serialize ${type}: ${reason}`, { type, reason });
  }

  /** A value could not be deserialized. */
  static deserializationFailed(type: string, reason: string): SerializationError {
    return new SerializationError(`Failed to deserialize ${type}: ${reason}`, {
      type,
      reason,
    });
  }
}


/**
 * Invalid or missing configuration. Always critical, so never retried.
 */
export class ConfigurationError extends OrchestrationError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.CONFIGURATION, details, ErrorSeverity.CRITICAL);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }

  /** A required configuration key is missing. */
  static missingConfiguration(key: string): ConfigurationError {
    return new ConfigurationError(`Missing required configuration: ${key}`, { key });
  }

  /** A configuration value is invalid. */
  static invalidConfiguration(key: string, reason: string): ConfigurationError {
    return new ConfigurationError(`Invalid configuration for '${key}': ${reason}`, {
      key,
      reason,
    });
  }
}

/** Type guard for any Orcher SDK error, transport or execution. */
export function isOrcherError(error: unknown): error is OrcherError {
  return error instanceof OrcherError;
}

/**
 * Type guard for an execution-layer error (workflow, task, worker).
 *
 * Narrower than {@link isOrcherError}, which also matches transport failures.
 */
export function isOrchestrationError(error: unknown): error is OrchestrationError {
  return error instanceof OrchestrationError;
}

/** Type guard for {@link WorkflowError}. */
export function isWorkflowError(error: unknown): error is WorkflowError {
  return error instanceof WorkflowError;
}

/** Type guard for {@link TaskError}. */
export function isTaskError(error: unknown): error is TaskError {
  return error instanceof TaskError;
}

/** Type guard for `ClientError`. */
export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError;
}

/** Type guard for {@link WorkerError}. */
export function isWorkerError(error: unknown): error is WorkerError {
  return error instanceof WorkerError;
}

/**
 * Convert any thrown value to an {@link OrcherError}.
 *
 * Orcher errors are returned unchanged; anything else becomes an
 * {@link OrchestrationError} with code `UNKNOWN`.
 *
 * @param error - The error to convert
 * @returns OrcherError instance
 */
export function toOrcherError(error: unknown): OrcherError {
  if (isOrcherError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new OrchestrationError(error.message, ErrorCode.UNKNOWN, {
      originalError: error.name,
      stack: error.stack,
    });
  }

  if (typeof error === 'string') {
    return new OrchestrationError(error, ErrorCode.UNKNOWN);
  }

  return new OrchestrationError('Unknown error occurred', ErrorCode.UNKNOWN, { error });
}

/**
 * Wrap a function so that anything it throws, or any promise it rejects,
 * surfaces as an {@link OrcherError}.
 *
 * @param fn - The function to wrap
 * @returns Wrapped function that converts errors
 */
export function wrapError<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => ReturnType<T> {
  return (...args: Parameters<T>) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.catch((error) => {
          throw toOrcherError(error);
        }) as ReturnType<T>;
      }
      return result;
    } catch (error) {
      throw toOrcherError(error);
    }
  };
}
