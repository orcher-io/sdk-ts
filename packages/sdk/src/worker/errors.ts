/**
 * Error classes raised by the worker.
 *
 * @module @orcher/sdk/worker/errors
 */

/**
 * Base class for errors raised by the worker.
 *
 * @example
 * ```typescript
 * throw new WorkerError('Failed to start worker');
 * ```
 */
export class WorkerError extends Error {
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'WorkerError';
    this.cause = cause;

    // Start the stack trace at the throw site rather than inside this constructor (V8 only).
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkerError);
    }
  }
}

/**
 * Error thrown when the worker configuration is invalid.
 *
 * @example
 * ```typescript
 * throw new ServiceConfigurationError('Invalid server address');
 * ```
 */
export class ServiceConfigurationError extends WorkerError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'ServiceConfigurationError';
  }
}

/**
 * Error thrown when the worker fails to start.
 *
 * @example
 * ```typescript
 * throw new ServiceStartupError('Failed to connect to server');
 * ```
 */
export class ServiceStartupError extends WorkerError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'ServiceStartupError';
  }
}

/**
 * Error thrown when the worker fails to shut down gracefully.
 *
 * @example
 * ```typescript
 * throw new ServiceShutdownError('Timeout waiting for in-flight executions');
 * ```
 */
export class ServiceShutdownError extends WorkerError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'ServiceShutdownError';
  }
}

/**
 * Error thrown when polling fails.
 *
 * @example
 * ```typescript
 * throw new PollingError('Failed to poll for workflow tasks');
 * ```
 */
export class PollingError extends WorkerError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'PollingError';
  }
}

/**
 * Error thrown when a workflow or task handler fails.
 *
 * The original error is kept as `cause`.
 *
 * @example
 * ```typescript
 * throw new ExecutionError(
 *   'Task handler threw an error',
 *   'task',
 *   'sendEmail',
 *   'task-123',
 *   originalError
 * );
 * ```
 */
export class ExecutionError extends WorkerError {
  /**
   * The type of handler that failed (workflow or task)
   */
  public readonly handlerType: 'workflow' | 'task';

  /**
   * The name of the handler that failed
   */
  public readonly handlerName: string;

  /**
   * The ID of the failed execution (the task ID, or the workflow ID for a workflow)
   */
  public readonly executionId?: string;

  constructor(
    message: string,
    handlerType: 'workflow' | 'task',
    handlerName: string,
    executionId?: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'ExecutionError';
    this.handlerType = handlerType;
    this.handlerName = handlerName;
    this.executionId = executionId;
  }

  /**
   * Get a multi-line message with the handler type, handler name, execution ID and cause
   */
  getDetailedMessage(): string {
    const parts = [
      this.message,
      `Handler Type: ${this.handlerType}`,
      `Handler Name: ${this.handlerName}`,
    ];

    if (this.executionId) {
      parts.push(`Execution ID: ${this.executionId}`);
    }

    if (this.cause) {
      parts.push(`Cause: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`);
    }

    return parts.join('\n');
  }
}

/**
 * Error thrown when no handler is registered for a workflow or task type.
 *
 * @example
 * ```typescript
 * throw new HandlerNotFoundError('workflow', 'orderWorkflow');
 * ```
 */
export class HandlerNotFoundError extends WorkerError {
  /**
   * The type of handler that was not found
   */
  public readonly handlerType: 'workflow' | 'task';

  /**
   * The name of the handler that was not found
   */
  public readonly handlerName: string;

  constructor(handlerType: 'workflow' | 'task', handlerName: string) {
    super(`${handlerType} handler not found: ${handlerName}`);
    this.name = 'HandlerNotFoundError';
    this.handlerType = handlerType;
    this.handlerName = handlerName;
  }
}

/**
 * Error thrown when a concurrency limit is exceeded.
 *
 * @example
 * ```typescript
 * throw new ConcurrencyLimitError('workflow', 100);
 * ```
 */
export class ConcurrencyLimitError extends WorkerError {
  /**
   * The type of execution that exceeded the limit
   */
  public readonly executionType: 'workflow' | 'task';

  /**
   * The maximum allowed concurrency
   */
  public readonly maxConcurrency: number;

  constructor(executionType: 'workflow' | 'task', maxConcurrency: number) {
    super(`${executionType} concurrency limit exceeded: ${maxConcurrency}`);
    this.name = 'ConcurrencyLimitError';
    this.executionType = executionType;
    this.maxConcurrency = maxConcurrency;
  }
}

/**
 * Error thrown when a workflow or task execution times out.
 *
 * @example
 * ```typescript
 * throw new ExecutionTimeoutError('workflow', 'orderWorkflow', 30000);
 * ```
 */
export class ExecutionTimeoutError extends WorkerError {
  /**
   * The type of execution that timed out
   */
  public readonly executionType: 'workflow' | 'task';

  /**
   * The name of the handler that timed out
   */
  public readonly handlerName: string;

  /**
   * The timeout duration in milliseconds
   */
  public readonly timeout: number;

  constructor(executionType: 'workflow' | 'task', handlerName: string, timeout: number) {
    super(`${executionType} '${handlerName}' timed out after ${timeout}ms`);
    this.name = 'ExecutionTimeoutError';
    this.executionType = executionType;
    this.handlerName = handlerName;
    this.timeout = timeout;
  }
}

/**
 * Check if an error is a WorkerError
 *
 * @param error - Error to check
 * @returns True if error is a WorkerError
 *
 * @example
 * ```typescript
 * try {
 *   await worker.run();
 * } catch (error) {
 *   if (isWorkerError(error)) {
 *     console.error('Worker error:', error.message);
 *   }
 * }
 * ```
 */
export function isWorkerError(error: unknown): error is WorkerError {
  return error instanceof WorkerError;
}

/**
 * Check if an error is an ExecutionError
 *
 * @param error - Error to check
 * @returns True if error is an ExecutionError
 */
export function isExecutionError(error: unknown): error is ExecutionError {
  return error instanceof ExecutionError;
}

/**
 * Check if an error is a HandlerNotFoundError
 *
 * @param error - Error to check
 * @returns True if error is a HandlerNotFoundError
 */
export function isHandlerNotFoundError(error: unknown): error is HandlerNotFoundError {
  return error instanceof HandlerNotFoundError;
}

/**
 * What a failed task reports to the engine about its error.
 *
 * The engine decides a retry from the failure type it is told, and a retry
 * policy's `nonRetryableErrors` lists types by name. The type is the error's
 * `name` when it was set, which survives minification, and otherwise its
 * class name, so `class InvoiceNotFound extends Error {}` reports
 * `InvoiceNotFound` without setting anything. A truthy `nonRetryable` property on the error
 * stops retries whatever the policy allows.
 *
 * @internal
 */
export function describeTaskFailure(error: unknown): {
  message: string;
  type: string;
  nonRetryable: boolean;
} {
  if (!(error instanceof Error)) {
    return { message: String(error), type: 'Error', nonRetryable: false };
  }
  // The executor wraps what a task threw in an ExecutionError. The retry policy
  // matches on the task's own error type and `nonRetryable` mark, so both come
  // from the cause.
  const raised =
    error instanceof ExecutionError && error.cause instanceof Error ? error.cause : error;
  const named = raised.name && raised.name !== 'Error' ? raised.name : undefined;
  return {
    message: error.message,
    type: named ?? raised.constructor?.name ?? 'Error',
    nonRetryable: Boolean((raised as { nonRetryable?: unknown }).nonRetryable),
  };
}
