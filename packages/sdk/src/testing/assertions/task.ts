/**
 * Assertions on the task calls recorded by a `MockTaskRegistry`.
 *
 * @module @orcher/sdk/testing/assertions/task
 */

import type { MockTaskRegistry } from '../mocks/task-registry';
import type { TaskCall } from '../types';
import { AssertionError } from './workflow';

/**
 * Assert that a task was called.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param message - Optional custom error message
 * @throws {AssertionError} If task was not called
 *
 * @example
 * ```typescript
 * const registry = new MockTaskRegistry();
 * await registry.execute('chargeCard', { amount: 99.99 });
 * assertTaskCalled(registry, 'chargeCard');
 * ```
 */
export function assertTaskCalled(
  registry: MockTaskRegistry,
  taskName: string,
  message?: string
): void {
  const callCount = registry.getCallCount(taskName);

  if (callCount === 0) {
    throw new AssertionError(
      message ?? `Expected task '${taskName}' to be called, but it was not called`
    );
  }
}

/**
 * Assert that a task was called specific number of times.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param expectedCount - Expected call count
 * @param message - Optional custom error message
 * @throws {AssertionError} If call count doesn't match
 *
 * @example
 * ```typescript
 * assertTaskCalledTimes(registry, 'chargeCard', 3);
 * ```
 */
export function assertTaskCalledTimes(
  registry: MockTaskRegistry,
  taskName: string,
  expectedCount: number,
  message?: string
): void {
  const actualCount = registry.getCallCount(taskName);

  if (actualCount !== expectedCount) {
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' to be called ${expectedCount} time${
          expectedCount === 1 ? '' : 's'
        }, ` + `but was called ${actualCount} time${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that a task was called with specific input.
 *
 * Inputs are compared by their JSON serialization, so object key order matters.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param expectedInput - Expected input
 * @param message - Optional custom error message
 * @throws {AssertionError} If task was not called with expected input
 *
 * @example
 * ```typescript
 * assertTaskCalledWith(registry, 'chargeCard', { amount: 99.99 });
 * ```
 */
export function assertTaskCalledWith<T>(
  registry: MockTaskRegistry,
  taskName: string,
  expectedInput: T,
  message?: string
): void {
  const calls = registry.getCalls(taskName);

  if (calls.length === 0) {
    throw new AssertionError(
      message ?? `Expected task '${taskName}' to be called, but it was not called`
    );
  }

  const found = calls.some((call) => deepEqual(call.input, expectedInput));

  if (!found) {
    const actualInputs = calls.map((c) => JSON.stringify(c.input)).join(', ');
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' to be called with ${JSON.stringify(expectedInput)}, ` +
          `but was called with: ${actualInputs}`
    );
  }
}

/**
 * Assert that a task was not called.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param message - Optional custom error message
 * @throws {AssertionError} If task was called
 *
 * @example
 * ```typescript
 * assertTaskNotCalled(registry, 'cancelOrder');
 * ```
 */
export function assertTaskNotCalled(
  registry: MockTaskRegistry,
  taskName: string,
  message?: string
): void {
  const callCount = registry.getCallCount(taskName);

  if (callCount > 0) {
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' not to be called, but was called ${callCount} time${
          callCount === 1 ? '' : 's'
        }`
    );
  }
}

/**
 * Assert that a task call succeeded (no error).
 *
 * @param call - Task call record
 * @param message - Optional custom error message
 * @throws {AssertionError} If call has error
 *
 * @example
 * ```typescript
 * const calls = registry.getCalls('chargeCard');
 * assertTaskCallSucceeded(calls[0]);
 * ```
 */
export function assertTaskCallSucceeded(call: TaskCall, message?: string): void {
  if (call.error) {
    throw new AssertionError(
      message ??
        `Expected task '${call.taskName}' call to succeed, but failed with: ${call.error.message}`
    );
  }
}

/**
 * Assert that a task call failed (has error).
 *
 * @param call - Task call record
 * @param errorPattern - Optional error message pattern: a substring or a regex
 * @param message - Optional custom error message
 * @throws {AssertionError} If call didn't fail
 *
 * @example
 * ```typescript
 * const calls = registry.getCalls('chargeCard');
 * assertTaskCallFailed(calls[0]);
 * assertTaskCallFailed(calls[0], 'Payment failed');
 * assertTaskCallFailed(calls[0], /timeout/i);
 * ```
 */
export function assertTaskCallFailed(
  call: TaskCall,
  errorPattern?: string | RegExp,
  message?: string
): void {
  if (!call.error) {
    throw new AssertionError(
      message ??
        `Expected task '${call.taskName}' call to fail, but it succeeded with: ${JSON.stringify(
          call.output
        )}`
    );
  }

  if (errorPattern) {
    const actualMessage = call.error.message;
    const matches =
      typeof errorPattern === 'string'
        ? actualMessage.includes(errorPattern)
        : errorPattern.test(actualMessage);

    if (!matches) {
      throw new AssertionError(
        message ??
          `Expected task '${call.taskName}' to fail with error matching "${errorPattern}", ` +
            `but got: "${actualMessage}"`
      );
    }
  }
}

/**
 * Assert that the task was called and that every call succeeded.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param message - Optional custom error message
 * @throws {AssertionError} If the task was not called, or any call failed
 *
 * @example
 * ```typescript
 * assertAllTaskCallsSucceeded(registry, 'chargeCard');
 * ```
 */
export function assertAllTaskCallsSucceeded(
  registry: MockTaskRegistry,
  taskName: string,
  message?: string
): void {
  const calls = registry.getCalls(taskName);

  if (calls.length === 0) {
    throw new AssertionError(
      message ?? `Expected task '${taskName}' to be called, but it was not called`
    );
  }

  const failures = calls.filter((call) => call.error);

  if (failures.length > 0) {
    const errorMessages = failures.map((f) => f.error!.message).join(', ');
    throw new AssertionError(
      message ??
        `Expected all calls to task '${taskName}' to succeed, but ${failures.length} call${
          failures.length === 1 ? '' : 's'
        } failed: ${errorMessages}`
    );
  }
}

/**
 * Assert that task call count is within expected range.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param minCount - Minimum call count
 * @param maxCount - Maximum call count
 * @param message - Optional custom error message
 * @throws {AssertionError} If count is outside range
 *
 * @example
 * ```typescript
 * assertTaskCallCountInRange(registry, 'retryableTask', 2, 5);
 * ```
 */
export function assertTaskCallCountInRange(
  registry: MockTaskRegistry,
  taskName: string,
  minCount: number,
  maxCount: number,
  message?: string
): void {
  const actualCount = registry.getCallCount(taskName);

  if (actualCount < minCount || actualCount > maxCount) {
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' to be called between ${minCount} and ${maxCount} times, ` +
          `but was called ${actualCount} time${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that a task was called at least N times.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param minCount - Minimum call count
 * @param message - Optional custom error message
 * @throws {AssertionError} If count is less than minimum
 *
 * @example
 * ```typescript
 * assertTaskCalledAtLeast(registry, 'logEvent', 3);
 * ```
 */
export function assertTaskCalledAtLeast(
  registry: MockTaskRegistry,
  taskName: string,
  minCount: number,
  message?: string
): void {
  const actualCount = registry.getCallCount(taskName);

  if (actualCount < minCount) {
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' to be called at least ${minCount} time${
          minCount === 1 ? '' : 's'
        }, ` + `but was called ${actualCount} time${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that a task was called at most N times.
 *
 * @param registry - Mock task registry
 * @param taskName - Task name
 * @param maxCount - Maximum call count
 * @param message - Optional custom error message
 * @throws {AssertionError} If count exceeds maximum
 *
 * @example
 * ```typescript
 * assertTaskCalledAtMost(registry, 'expensiveOperation', 2);
 * ```
 */
export function assertTaskCalledAtMost(
  registry: MockTaskRegistry,
  taskName: string,
  maxCount: number,
  message?: string
): void {
  const actualCount = registry.getCallCount(taskName);

  if (actualCount > maxCount) {
    throw new AssertionError(
      message ??
        `Expected task '${taskName}' to be called at most ${maxCount} time${
          maxCount === 1 ? '' : 's'
        }, ` + `but was called ${actualCount} time${actualCount === 1 ? '' : 's'}`
    );
  }
}

/**
 * Assert that tasks were called in a specific order.
 *
 * Calls are ordered by their timestamp. Only calls to the listed tasks are considered, and each
 * listed task may be called at most once; a repeated call fails the assertion. Listed tasks
 * that were never called do not fail it.
 *
 * @param registry - Mock task registry
 * @param expectedOrder - Array of task names in expected order
 * @param message - Optional custom error message
 * @throws {AssertionError} If order doesn't match
 *
 * @example
 * ```typescript
 * assertTaskCallOrder(registry, ['validateOrder', 'chargeCard', 'reserveInventory']);
 * ```
 */
export function assertTaskCallOrder(
  registry: MockTaskRegistry,
  expectedOrder: string[],
  message?: string
): void {
  const allCalls = registry.getAllCalls();
  const allCallsFlat: TaskCall[] = [];

  // Timestamps have millisecond resolution. Calls in the same millisecond stay
  // grouped by task (the sort is stable), so their relative order is not
  // reliable.
  for (const calls of allCalls.values()) {
    allCallsFlat.push(...calls);
  }
  allCallsFlat.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const actualOrder = allCallsFlat
    .map((call) => call.taskName)
    .filter((name) => expectedOrder.includes(name));

  let orderMatches = true;
  let lastIndex = -1;

  for (const taskName of actualOrder) {
    const expectedIndex = expectedOrder.indexOf(taskName);
    if (expectedIndex <= lastIndex) {
      orderMatches = false;
      break;
    }
    lastIndex = expectedIndex;
  }

  if (!orderMatches) {
    throw new AssertionError(
      message ??
        `Expected tasks to be called in order: [${expectedOrder.join(', ')}], ` +
          `but actual order was: [${actualOrder.join(', ')}]`
    );
  }
}

/**
 * Assert that task call duration is within expected range.
 *
 * The duration is wall-clock time, not test-clock time.
 *
 * @param call - Task call record
 * @param minMs - Minimum duration in milliseconds
 * @param maxMs - Maximum duration in milliseconds
 * @param message - Optional custom error message
 * @throws {AssertionError} If duration is outside range
 *
 * @example
 * ```typescript
 * const calls = registry.getCalls('chargeCard');
 * assertTaskCallDuration(calls[0], 100, 500);
 * ```
 */
export function assertTaskCallDuration(
  call: TaskCall,
  minMs: number,
  maxMs: number,
  message?: string
): void {
  if (call.duration === undefined) {
    throw new AssertionError(
      message ?? `Expected task '${call.taskName}' call to have duration recorded`
    );
  }

  if (call.duration < minMs || call.duration > maxMs) {
    throw new AssertionError(
      message ??
        `Expected task '${call.taskName}' call duration to be between ${minMs}ms and ${maxMs}ms, ` +
          `but was ${call.duration}ms`
    );
  }
}

/**
 * Compare two values by their JSON serialization.
 */
function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
