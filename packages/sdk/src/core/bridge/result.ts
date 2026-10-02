/**
 * Builders and helpers for ExecutionResult objects.
 *
 * An ExecutionResult is what the TypeScript SDK sends back to the Rust core
 * after running a workflow activation: success or failure plus the commands
 * the workflow issued.
 *
 * @module @orcher/sdk/core/bridge/result
 */

import type { Payload } from './payload';
import type {
  Command,
  ExecutionError,
  ExecutionResult,
  ParentClosePolicy,
  StepFailure,
  TaskRetryPolicy,
} from './types';

/**
 * Create a successful ExecutionResult
 *
 * @param runId - Run ID from the ExecutionRequest
 * @param commands - Commands to send to the server
 * @returns ExecutionResult
 */
export function createSuccessResult(runId: string, commands: Command[]): ExecutionResult {
  return {
    runId,
    successful: true,
    commands,
  };
}

/**
 * Create a failed ExecutionResult
 *
 * @param runId - Run ID from the ExecutionRequest
 * @param error - Error information
 * @returns ExecutionResult
 */
export function createErrorResult(runId: string, error: ExecutionError): ExecutionResult {
  return {
    runId,
    successful: false,
    commands: [],
    error,
  };
}

/**
 * Create an ExecutionError from a JavaScript Error
 *
 * @param error - JavaScript Error object
 * @param retryable - Whether this error is retryable
 * @returns ExecutionError
 */
export function createExecutionErrorFromException(error: Error, retryable = false): ExecutionError {
  return {
    message: error.message,
    source: error.name,
    stackTrace: error.stack,
    retryable,
    cause: error.cause ? String(error.cause) : undefined,
  };
}

// ============================================================================
// Command Builders
// ============================================================================

/**
 * Create a ScheduleTask command
 */
export function scheduleTask(options: {
  taskId: string;
  taskQueue: string;
  taskType: string;
  input: Payload[];
  scheduleToCloseTimeout?: number;
  scheduleToStartTimeout?: number;
  startToCloseTimeout?: number;
  retryPolicy?: TaskRetryPolicy;
  headers?: Record<string, Payload>;
}): Command {
  return {
    type: 'ScheduleTask',
    command: {
      taskId: options.taskId,
      taskQueue: options.taskQueue,
      taskType: options.taskType,
      input: options.input,
      scheduleToCloseTimeout: options.scheduleToCloseTimeout,
      scheduleToStartTimeout: options.scheduleToStartTimeout,
      startToCloseTimeout: options.startToCloseTimeout,
      retryPolicy: options.retryPolicy,
      headers: options.headers,
    },
  };
}

/**
 * Create a StartTimer command
 */
export function startTimer(timerId: string, duration: number): Command {
  return {
    type: 'StartTimer',
    command: {
      timerId,
      duration,
    },
  };
}

/**
 * Create a CancelTimer command
 */
export function cancelTimer(timerId: string): Command {
  return {
    type: 'CancelTimer',
    command: {
      timerId,
    },
  };
}

/**
 * Create a SendEvent command
 */
export function sendEvent(options: {
  workflowId: string;
  runId?: string;
  eventName: string;
  payload?: Payload;
  namespace?: string;
}): Command {
  return {
    type: 'SendEvent',
    command: {
      workflowId: options.workflowId,
      runId: options.runId,
      eventName: options.eventName,
      payload: options.payload,
      namespace: options.namespace,
    },
  };
}

/**
 * Create a CompleteWorkflow command
 */
export function completeWorkflow(result?: Payload): Command {
  return {
    type: 'CompleteWorkflow',
    command: {
      result,
    },
  };
}

/**
 * Create a FailWorkflow command
 */
export function failWorkflow(message: string, source?: string, stackTrace?: string): Command {
  return {
    type: 'FailWorkflow',
    command: {
      message,
      source,
      stackTrace,
    },
  };
}

/**
 * Create a FailWorkflow command from a JavaScript Error
 */
export function failWorkflowFromError(error: Error): Command {
  return failWorkflow(error.message, error.name, error.stack);
}

/**
 * Create a CancelWorkflow command
 */
export function cancelWorkflow(details?: Payload): Command {
  return {
    type: 'CancelWorkflow',
    command: {
      details,
    },
  };
}

/**
 * Create a StartChildWorkflow command
 */
export function startChildWorkflow(options: {
  childWorkflowId: string;
  workflowType: string;
  taskQueue: string;
  input: Payload[];
  workflowExecutionTimeout?: number;
  workflowRunTimeout?: number;
  workflowTaskTimeout?: number;
  namespace?: string;
  parentClosePolicy?: ParentClosePolicy;
  retryPolicy?: TaskRetryPolicy;
  headers?: Record<string, Payload>;
}): Command {
  return {
    type: 'StartChildWorkflow',
    command: {
      childWorkflowId: options.childWorkflowId,
      workflowType: options.workflowType,
      taskQueue: options.taskQueue,
      input: options.input,
      workflowExecutionTimeout: options.workflowExecutionTimeout,
      workflowRunTimeout: options.workflowRunTimeout,
      workflowTaskTimeout: options.workflowTaskTimeout,
      namespace: options.namespace,
      parentClosePolicy: options.parentClosePolicy,
      retryPolicy: options.retryPolicy,
      headers: options.headers,
    },
  };
}

/**
 * Create a CancelChildWorkflow command
 */
export function cancelChildWorkflow(childWorkflowId: string): Command {
  return {
    type: 'CancelChildWorkflow',
    command: {
      childWorkflowId,
    },
  };
}

/**
 * Create a RequestCancellation command
 */
export function requestCancellation(workflowId: string, runId?: string): Command {
  return {
    type: 'RequestCancellation',
    command: {
      workflowId,
      runId,
    },
  };
}

/**
 * Create a RestartFresh command
 */
export function restartFresh(newWorkflowId?: string, args?: Payload[]): Command {
  return {
    type: 'RestartFresh',
    command: {
      newWorkflowId,
      args,
    },
  };
}

/**
 * Create a QueryChildWorkflow command
 */
export function queryChildWorkflow(options: {
  childWorkflowId: string;
  queryType: string;
  args: Payload[];
  timeout?: number;
}): Command {
  return {
    type: 'QueryChildWorkflow',
    command: {
      childWorkflowId: options.childWorkflowId,
      queryType: options.queryType,
      args: options.args,
      timeout: options.timeout,
    },
  };
}

/**
 * Create a RecordStepResult command (successful)
 */
export function recordStepResult(stepId: string, result: Payload): Command {
  return {
    type: 'RecordStepResult',
    command: {
      stepId,
      result,
    },
  };
}

/**
 * Create a RecordStepResult command (failed)
 */
export function recordStepFailure(stepId: string, failure: StepFailure): Command {
  return {
    type: 'RecordStepResult',
    command: {
      stepId,
      failure,
    },
  };
}

/**
 * Create a RespondToQuery command (successful)
 */
export function respondToQuery(queryId: string, result: Payload): Command {
  return {
    type: 'RespondToQuery',
    command: {
      queryId,
      successful: true,
      result,
    },
  };
}

/**
 * Create a RespondToQuery command (failed)
 */
export function respondToQueryError(
  queryId: string,
  message: string,
  source?: string,
  stackTrace?: string
): Command {
  return {
    type: 'RespondToQuery',
    command: {
      queryId,
      successful: false,
      error: {
        message,
        source,
        stackTrace,
      },
    },
  };
}

/**
 * Create a RespondToQuery command from a JavaScript Error
 */
export function respondToQueryFromError(queryId: string, error: Error): Command {
  return respondToQueryError(queryId, error.message, error.name, error.stack);
}

// ============================================================================
// Retry Policy Helpers
// ============================================================================

/**
 * Create a default retry policy
 */
export function defaultRetryPolicy(): TaskRetryPolicy {
  return {
    maxAttempts: 3,
    initialInterval: 1000, // 1 second
    maxInterval: 60000, // 1 minute
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: [],
  };
}

/**
 * Create a retry policy with custom max attempts
 */
export function retryPolicy(maxAttempts: number): TaskRetryPolicy {
  return {
    ...defaultRetryPolicy(),
    maxAttempts,
  };
}

/**
 * Create a retry policy with no retries (a single attempt).
 */
export function noRetryPolicy(): TaskRetryPolicy {
  return {
    maxAttempts: 1,
  };
}

/**
 * Create a retry policy with exponential backoff
 */
export function exponentialRetryPolicy(
  maxAttempts: number,
  initialInterval: number,
  maxInterval: number,
  backoffCoefficient = 2.0
): TaskRetryPolicy {
  return {
    maxAttempts,
    initialInterval,
    maxInterval,
    backoffCoefficient,
    nonRetryableErrorTypes: [],
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that an ExecutionResult has its required fields.
 *
 * @throws {Error} If `runId` is missing, `successful` is not a boolean, `commands` is not
 *   an array, or a failed result has no `error`
 */
export function validateExecutionResult(result: ExecutionResult): void {
  if (!result.runId) {
    throw new Error('ExecutionResult.runId is required');
  }

  if (typeof result.successful !== 'boolean') {
    throw new Error('ExecutionResult.successful must be a boolean');
  }

  if (!Array.isArray(result.commands)) {
    throw new Error('ExecutionResult.commands must be an array');
  }

  if (!result.successful && !result.error) {
    throw new Error('ExecutionResult.error is required when successful is false');
  }
}

/**
 * Check if an ExecutionResult represents a successful execution
 */
export function isSuccessResult(result: ExecutionResult): boolean {
  return result.successful;
}

/**
 * Check if an ExecutionResult represents a failed execution
 */
export function isErrorResult(result: ExecutionResult): boolean {
  return !result.successful;
}

/**
 * Get commands from ExecutionResult
 */
export function getCommands(result: ExecutionResult): Command[] {
  return result.commands;
}

/**
 * Get error from ExecutionResult (if failed)
 */
export function getError(result: ExecutionResult): ExecutionError | undefined {
  return result.error;
}

/**
 * Count commands of a specific type in ExecutionResult
 */
export function countCommands(result: ExecutionResult, type: Command['type']): number {
  return result.commands.filter((cmd) => cmd.type === type).length;
}

/**
 * Check if ExecutionResult contains any commands
 */
export function hasCommands(result: ExecutionResult): boolean {
  return result.commands.length > 0;
}

/**
 * Check if ExecutionResult contains a specific command type
 */
export function hasCommandType(result: ExecutionResult, type: Command['type']): boolean {
  return result.commands.some((cmd) => cmd.type === type);
}

/**
 * Filter commands by type
 */
export function filterCommands<T extends Command['type']>(
  result: ExecutionResult,
  type: T
): Extract<Command, { type: T }>[] {
  return result.commands.filter((cmd) => cmd.type === type) as Extract<Command, { type: T }>[];
}
