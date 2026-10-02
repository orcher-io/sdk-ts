/**
 * Assertions on workflow execution traces and mock workflow handles.
 *
 * Each trace assertion also accepts `undefined`, which fails, so the result of
 * `getExecutionTrace()` can be passed in directly; afterwards TypeScript narrows it to a trace.
 *
 * @module @orcher/sdk/testing/assertions/workflow
 */

import type { ExecutionTrace } from '../trace';
import type { ExecutionStatus } from '../types';
import type { MockWorkflowHandle } from '../mocks/handle';

/**
 * Assert that a workflow completed successfully.
 *
 * @param trace - Execution trace
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow did not complete
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowCompleted(trace);
 * ```
 */
export function assertWorkflowCompleted(
  trace: ExecutionTrace | undefined,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== 'completed') {
    const actualStatus = trace.status;
    const errorMsg = trace.error ? ` Error: ${trace.error.message}` : '';
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to be completed, but status was ${actualStatus}.${errorMsg}`
    );
  }
}

/**
 * Assert that a workflow failed.
 *
 * @param trace - Execution trace
 * @param errorPattern - Optional error message pattern: a substring or a regex
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow did not fail, or its error does not match `errorPattern`
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowFailed(trace);
 * assertWorkflowFailed(trace, 'Payment failed');
 * assertWorkflowFailed(trace, /timeout/i);
 * ```
 */
export function assertWorkflowFailed(
  trace: ExecutionTrace | undefined,
  errorPattern?: string | RegExp,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== 'failed') {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to be failed, but status was ${trace.status}`
    );
  }

  if (errorPattern && trace.error) {
    const actualMessage = trace.error.message;
    const matches =
      typeof errorPattern === 'string'
        ? actualMessage.includes(errorPattern)
        : errorPattern.test(actualMessage);

    if (!matches) {
      throw new AssertionError(
        message ??
          `Expected workflow ${trace.workflowId} to fail with error matching "${errorPattern}", ` +
            `but got: "${actualMessage}"`
      );
    }
  }
}

/**
 * Assert that a workflow is running.
 *
 * @param trace - Execution trace
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow is not running
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowRunning(trace);
 * ```
 */
export function assertWorkflowRunning(
  trace: ExecutionTrace | undefined,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== 'running') {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to be running, but status was ${trace.status}`
    );
  }
}

/**
 * Assert that a workflow was canceled (status `'cancelled'`).
 *
 * @param trace - Execution trace
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow was not canceled
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowCancelled(trace);
 * ```
 */
export function assertWorkflowCancelled(
  trace: ExecutionTrace | undefined,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== 'cancelled') {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to be cancelled, but status was ${trace.status}`
    );
  }
}

/**
 * Assert that a workflow timed out.
 *
 * @param trace - Execution trace
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow did not time out
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowTimedOut(trace);
 * ```
 */
export function assertWorkflowTimedOut(
  trace: ExecutionTrace | undefined,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== 'timed_out') {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to be timed out, but status was ${trace.status}`
    );
  }
}

/**
 * Assert that a workflow has specific status.
 *
 * @param trace - Execution trace
 * @param expectedStatus - Expected status
 * @param message - Optional custom error message
 * @throws {AssertionError} If workflow status doesn't match
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowStatus(trace, 'completed');
 * ```
 */
export function assertWorkflowStatus(
  trace: ExecutionTrace | undefined,
  expectedStatus: ExecutionStatus,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (trace.status !== expectedStatus) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to have status ${expectedStatus}, ` +
          `but status was ${trace.status}`
    );
  }
}

/**
 * Assert that workflow state has a specific value.
 *
 * Values are compared by their JSON serialization.
 *
 * @param trace - Execution trace
 * @param key - State key
 * @param expectedValue - Expected value
 * @param message - Optional custom error message
 * @throws {AssertionError} If state doesn't match
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowState(trace, 'counter', 5);
 * assertWorkflowState(trace, 'status', 'processing');
 * ```
 */
export function assertWorkflowState<T>(
  trace: ExecutionTrace | undefined,
  key: string,
  expectedValue: T,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  const actualValue = trace.getState(key);

  if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} state[${key}] to be ${JSON.stringify(
          expectedValue
        )}, ` + `but got ${JSON.stringify(actualValue)}`
    );
  }
}

/**
 * Assert that workflow state has a key.
 *
 * @param trace - Execution trace
 * @param key - State key
 * @param message - Optional custom error message
 * @throws {AssertionError} If key doesn't exist
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowHasState(trace, 'counter');
 * ```
 */
export function assertWorkflowHasState(
  trace: ExecutionTrace | undefined,
  key: string,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  if (!trace.hasState(key)) {
    throw new AssertionError(
      message ?? `Expected workflow ${trace.workflowId} to have state key "${key}", but it doesn't`
    );
  }
}

/**
 * Assert that workflow executed specific number of tasks.
 *
 * @param trace - Execution trace
 * @param expectedCount - Expected task count
 * @param message - Optional custom error message
 * @throws {AssertionError} If task count doesn't match
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowTaskCount(trace, 5);
 * ```
 */
export function assertWorkflowTaskCount(
  trace: ExecutionTrace | undefined,
  expectedCount: number,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  const actualCount = trace.tasksExecuted.length;

  if (actualCount !== expectedCount) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to execute ${expectedCount} task${
          expectedCount === 1 ? '' : 's'
        }, ` + `but executed ${actualCount} task${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that workflow received specific number of events.
 *
 * @param trace - Execution trace
 * @param expectedCount - Expected event count
 * @param eventName - Optional event name to filter
 * @param message - Optional custom error message
 * @throws {AssertionError} If event count doesn't match
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowEventCount(trace, 3);
 * assertWorkflowEventCount(trace, 2, 'orderApproved');
 * ```
 */
export function assertWorkflowEventCount(
  trace: ExecutionTrace | undefined,
  expectedCount: number,
  eventName?: string,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  const actualCount = eventName
    ? trace.getEventCount(eventName)
    : trace.eventsReceived.length;

  const nameStr = eventName ? ` '${eventName}'` : '';

  if (actualCount !== expectedCount) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to receive ${expectedCount}${nameStr} event${
          expectedCount === 1 ? '' : 's'
        }, ` + `but received ${actualCount} event${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that workflow duration is within expected range.
 *
 * The duration is wall-clock time, not test-clock time. The workflow must have finished.
 *
 * @param trace - Execution trace
 * @param minMs - Minimum duration in milliseconds
 * @param maxMs - Maximum duration in milliseconds
 * @param message - Optional custom error message
 * @throws {AssertionError} If duration is outside range
 *
 * @example
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowDuration(trace, 100, 500); // Between 100ms and 500ms
 * ```
 */
export function assertWorkflowDuration(
  trace: ExecutionTrace | undefined,
  minMs: number,
  maxMs: number,
  message?: string
): asserts trace is ExecutionTrace {
  if (!trace) {
    throw new AssertionError(
      message ?? 'Expected workflow trace to exist, but it was undefined'
    );
  }

  const duration = trace.duration;

  if (duration === undefined) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} to have completed to measure duration, ` +
          `but status was ${trace.status}`
    );
  }

  if (duration < minMs || duration > maxMs) {
    throw new AssertionError(
      message ??
        `Expected workflow ${trace.workflowId} duration to be between ${minMs}ms and ${maxMs}ms, ` +
          `but was ${duration}ms`
    );
  }
}

/**
 * Assert that mock workflow handle completed successfully.
 *
 * @param handle - Mock workflow handle
 * @param message - Optional custom error message
 * @throws {AssertionError} If handle did not complete
 *
 * @example
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 * handle.completeWith({ status: 'success' });
 * assertHandleCompleted(handle);
 * ```
 */
export function assertHandleCompleted(
  handle: MockWorkflowHandle | undefined,
  message?: string
): asserts handle is MockWorkflowHandle {
  if (!handle) {
    throw new AssertionError(
      message ?? 'Expected workflow handle to exist, but it was undefined'
    );
  }

  if (!handle.isCompleted) {
    throw new AssertionError(
      message ??
        `Expected workflow handle ${handle.workflowId} to be completed, but status was ${handle.status}`
    );
  }
}

/**
 * Assert that mock workflow handle failed.
 *
 * @param handle - Mock workflow handle
 * @param message - Optional custom error message
 * @throws {AssertionError} If handle did not fail
 *
 * @example
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 * handle.failWith(new Error('Payment failed'));
 * assertHandleFailed(handle);
 * ```
 */
export function assertHandleFailed(
  handle: MockWorkflowHandle | undefined,
  message?: string
): asserts handle is MockWorkflowHandle {
  if (!handle) {
    throw new AssertionError(
      message ?? 'Expected workflow handle to exist, but it was undefined'
    );
  }

  if (!handle.isFailed) {
    throw new AssertionError(
      message ??
        `Expected workflow handle ${handle.workflowId} to be failed, but status was ${handle.status}`
    );
  }
}

/**
 * Assert that mock workflow handle was canceled.
 *
 * @param handle - Mock workflow handle
 * @param message - Optional custom error message
 * @throws {AssertionError} If handle was not canceled
 *
 * @example
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 * await handle.cancel();
 * assertHandleCancelled(handle);
 * ```
 */
export function assertHandleCancelled(
  handle: MockWorkflowHandle | undefined,
  message?: string
): asserts handle is MockWorkflowHandle {
  if (!handle) {
    throw new AssertionError(
      message ?? 'Expected workflow handle to exist, but it was undefined'
    );
  }

  if (!handle.isCancelled) {
    throw new AssertionError(
      message ??
        `Expected workflow handle ${handle.workflowId} to be cancelled, but status was ${handle.status}`
    );
  }
}

/**
 * Error thrown by the testing assertions when a check fails.
 */
export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
    Object.setPrototypeOf(this, AssertionError.prototype);
  }
}
