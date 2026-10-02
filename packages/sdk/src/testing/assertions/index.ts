/**
 * Assertion helpers and custom matchers for workflow tests.
 *
 * Assertions cover execution traces, mock task registries, and mock workflow handles, and throw
 * `AssertionError` with a message that names the workflow or task.
 *
 * @module @orcher/sdk/testing/assertions
 *
 * @example Basic assertions
 * ```typescript
 * import { assertWorkflowCompleted, assertTaskCalledTimes } from '@orcher/sdk/testing';
 *
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertWorkflowCompleted(trace);
 * assertTaskCalledTimes(registry, 'chargeCard', 3);
 * ```
 *
 * @example Custom matchers with Jest
 * ```typescript
 * // jest.setup.ts
 * import { expect } from '@jest/globals';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 *
 * // In tests
 * expect(trace).toHaveCompletedSuccessfully();
 * expect(trace).toHaveExecutedTask('chargeCard', 3);
 * expect(registry).toHaveCalledTask('chargeCard');
 * ```
 *
 * @example Custom matchers with Vitest
 * ```typescript
 * // vitest.setup.ts
 * import { expect } from 'vitest';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 *
 * // In tests
 * expect(trace).toHaveCompletedSuccessfully();
 * expect(handle).toHaveReceivedEvent('orderApproved');
 * ```
 */

// ============================================================================
// Workflow Assertions
// ============================================================================

export {
  assertWorkflowCompleted,
  assertWorkflowFailed,
  assertWorkflowRunning,
  assertWorkflowCancelled,
  assertWorkflowTimedOut,
  assertWorkflowStatus,
  assertWorkflowState,
  assertWorkflowHasState,
  assertWorkflowTaskCount,
  assertWorkflowEventCount,
  assertWorkflowDuration,
  assertHandleCompleted,
  assertHandleFailed,
  assertHandleCancelled,
  AssertionError,
} from './workflow';

// ============================================================================
// Task Assertions
// ============================================================================

export {
  assertTaskCalled,
  assertTaskCalledTimes,
  assertTaskCalledWith,
  assertTaskNotCalled,
  assertTaskCallSucceeded,
  assertTaskCallFailed,
  assertAllTaskCallsSucceeded,
  assertTaskCallCountInRange,
  assertTaskCalledAtLeast,
  assertTaskCalledAtMost,
  assertTaskCallOrder,
  assertTaskCallDuration,
} from './task';

// ============================================================================
// Custom Matchers
// ============================================================================

export {
  extendExpect,
  workflowMatchers,
  taskMatchers,
  handleMatchers,
  type MatcherResult,
  type WorkflowMatchers,
  type TaskMatchers,
  type HandleMatchers,
} from './matchers';

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Assert that execution completed without errors.
 *
 * Accepts either an execution trace or a mock workflow handle, told apart by shape.
 *
 * @param traceOrHandle - Execution trace or mock handle
 * @param message - Optional custom error message
 * @throws {AssertionError} If not completed successfully
 *
 * @example With trace
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * assertCompleted(trace);
 * ```
 *
 * @example With handle
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 * handle.completeWith({ status: 'success' });
 * assertCompleted(handle);
 * ```
 */
export function assertCompleted(traceOrHandle: any, message?: string): void {
  if (traceOrHandle && typeof traceOrHandle.getState === 'function') {
    // It's a trace
    const { assertWorkflowCompleted } = require('./workflow');
    assertWorkflowCompleted(traceOrHandle, message);
  } else if (traceOrHandle && typeof traceOrHandle.completeWith === 'function') {
    // It's a handle
    const { assertHandleCompleted } = require('./workflow');
    assertHandleCompleted(traceOrHandle, message);
  } else {
    const { AssertionError } = require('./workflow');
    throw new AssertionError(
      message ?? 'Expected execution trace or handle, but got: ' + typeof traceOrHandle
    );
  }
}

/**
 * Assert that execution failed.
 *
 * Accepts either an execution trace or a mock workflow handle, told apart by shape.
 *
 * @param traceOrHandle - Execution trace or mock handle
 * @param errorPattern - Optional error message pattern. Checked for traces only; a handle does
 *   not keep its error.
 * @param message - Optional custom error message
 * @throws {AssertionError} If not failed
 *
 * @example
 * ```typescript
 * assertFailed(trace, 'Payment failed');
 * assertFailed(handle, /timeout/i);
 * ```
 */
export function assertFailed(
  traceOrHandle: any,
  errorPattern?: string | RegExp,
  message?: string
): void {
  if (traceOrHandle && typeof traceOrHandle.getState === 'function') {
    // It's a trace
    const { assertWorkflowFailed } = require('./workflow');
    assertWorkflowFailed(traceOrHandle, errorPattern, message);
  } else if (traceOrHandle && typeof traceOrHandle.completeWith === 'function') {
    // It's a handle
    const { assertHandleFailed } = require('./workflow');
    assertHandleFailed(traceOrHandle, message);
  } else {
    const { AssertionError } = require('./workflow');
    throw new AssertionError(
      message ?? 'Expected execution trace or handle, but got: ' + typeof traceOrHandle
    );
  }
}

/**
 * Create a custom assertion helper that throws `AssertionError` when the predicate is false.
 *
 * @param name - Assertion name (not used in the error message)
 * @param predicate - Predicate function
 * @param messageFactory - Function to create error message
 * @returns Assertion function
 *
 * @example
 * ```typescript
 * const assertTaskExecutedBefore = createAssertion(
 *   'taskExecutedBefore',
 *   (trace, taskA, taskB) => {
 *     const executions = trace.tasksExecuted;
 *     const indexA = executions.findIndex(t => t.taskName === taskA);
 *     const indexB = executions.findIndex(t => t.taskName === taskB);
 *     return indexA >= 0 && indexB >= 0 && indexA < indexB;
 *   },
 *   (trace, taskA, taskB) =>
 *     `Expected task ${taskA} to be executed before ${taskB} in workflow ${trace.workflowId}`
 * );
 *
 * // Usage
 * assertTaskExecutedBefore(trace, 'validateOrder', 'chargeCard');
 * ```
 */
export function createAssertion<T extends any[]>(
  _name: string,
  predicate: (...args: T) => boolean,
  messageFactory: (...args: T) => string
): (...args: T) => void {
  return (...args: T) => {
    const { AssertionError } = require('./workflow');
    if (!predicate(...args)) {
      throw new AssertionError(messageFactory(...args));
    }
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is an execution trace.
 *
 * @param value - Value to check
 * @returns True if execution trace
 *
 * @example
 * ```typescript
 * if (isExecutionTrace(value)) {
 *   assertWorkflowCompleted(value);
 * }
 * ```
 */
export function isExecutionTrace(value: any): boolean {
  return value && typeof value.getState === 'function' && typeof value.workflowId === 'string';
}

/**
 * Check if value is a mock workflow handle.
 *
 * @param value - Value to check
 * @returns True if mock handle
 *
 * @example
 * ```typescript
 * if (isMockHandle(value)) {
 *   assertHandleCompleted(value);
 * }
 * ```
 */
export function isMockHandle(value: any): boolean {
  return value && typeof value.completeWith === 'function' && typeof value.workflowId === 'string';
}

/**
 * Check if value is a mock task registry.
 *
 * @param value - Value to check
 * @returns True if mock registry
 *
 * @example
 * ```typescript
 * if (isMockRegistry(value)) {
 *   assertTaskCalled(value, 'chargeCard');
 * }
 * ```
 */
export function isMockRegistry(value: any): boolean {
  return value && typeof value.getCallCount === 'function' && typeof value.getCalls === 'function';
}
