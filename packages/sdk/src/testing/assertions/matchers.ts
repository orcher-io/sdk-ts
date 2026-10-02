/**
 * Custom Jest and Vitest matchers for workflow tests.
 *
 * @module @orcher/sdk/testing/assertions/matchers
 *
 * @example Jest setup
 * ```typescript
 * // jest.setup.ts
 * import { expect } from '@jest/globals';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 * ```
 *
 * @example Vitest setup
 * ```typescript
 * // vitest.setup.ts
 * import { expect } from 'vitest';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 * ```
 *
 * @example Usage in tests
 * ```typescript
 * const trace = testEnv.getExecutionTrace('wf-123');
 * expect(trace).toHaveCompletedSuccessfully();
 * expect(trace).toHaveExecutedTask('chargeCard');
 * expect(trace).toHaveState('counter', 5);
 * ```
 */

import type { ExecutionTrace } from '../trace';
import type { MockWorkflowHandle } from '../mocks/handle';
import type { MockTaskRegistry } from '../mocks/task-registry';
import type { ExecutionStatus } from '../types';

/**
 * Result shape that `expect.extend` requires of a matcher.
 */
export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/**
 * Custom matchers for execution traces.
 */
export interface WorkflowMatchers<R = unknown> {
  /**
   * Assert that workflow completed successfully.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveCompletedSuccessfully();
   * ```
   */
  toHaveCompletedSuccessfully(): R;

  /**
   * Assert that workflow failed with an error whose message contains the string or matches the
   * regex.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveFailedWith('Payment failed');
   * expect(trace).toHaveFailedWith(/timeout/i);
   * ```
   */
  toHaveFailedWith(error: string | RegExp): R;

  /**
   * Assert that workflow is running.
   *
   * @example
   * ```typescript
   * expect(trace).toBeRunning();
   * ```
   */
  toBeRunning(): R;

  /**
   * Assert that workflow was canceled.
   *
   * @example
   * ```typescript
   * expect(trace).toBeCancelled();
   * ```
   */
  toBeCancelled(): R;

  /**
   * Assert that workflow timed out.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveTimedOut();
   * ```
   */
  toHaveTimedOut(): R;

  /**
   * Assert that workflow has specific status.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveStatus('completed');
   * ```
   */
  toHaveStatus(status: ExecutionStatus): R;

  /**
   * Assert that workflow executed specific task.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveExecutedTask('chargeCard');
   * expect(trace).toHaveExecutedTask('chargeCard', 3);
   * ```
   */
  toHaveExecutedTask(taskName: string, count?: number): R;

  /**
   * Assert that workflow state has the key and, when `value` is given, that value.
   *
   * Values are compared by their JSON serialization.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveState('counter', 5);
   * expect(trace).toHaveState('status', 'processing');
   * ```
   */
  toHaveState(key: string, value?: any): R;

  /**
   * Assert that workflow received event.
   *
   * Not reachable through `extendExpect()`: the handle matcher of the same name replaces it, and
   * that matcher expects a mock handle. Call `workflowMatchers.toHaveReceivedEvent` directly, or
   * use `assertWorkflowEventCount`.
   *
   * @example
   * ```typescript
   * workflowMatchers.toHaveReceivedEvent(trace, 'orderApproved', 2).pass;
   * ```
   */
  toHaveReceivedEvent(eventName: string, count?: number): R;

  /**
   * Assert that workflow duration is within range.
   *
   * The duration is wall-clock time, not test-clock time.
   *
   * @example
   * ```typescript
   * expect(trace).toHaveDurationBetween(100, 500);
   * ```
   */
  toHaveDurationBetween(minMs: number, maxMs: number): R;
}

/**
 * Custom matchers for a `MockTaskRegistry`.
 */
export interface TaskMatchers<R = unknown> {
  /**
   * Assert that task was called.
   *
   * @example
   * ```typescript
   * expect(registry).toHaveCalledTask('chargeCard');
   * expect(registry).toHaveCalledTask('chargeCard', 3);
   * ```
   */
  toHaveCalledTask(taskName: string, count?: number): R;

  /**
   * Assert that task was called with specific input.
   *
   * @example
   * ```typescript
   * expect(registry).toHaveCalledTaskWith('chargeCard', { amount: 99.99 });
   * ```
   */
  toHaveCalledTaskWith(taskName: string, input: any): R;

  /**
   * Negated form of these matchers.
   *
   * @example
   * ```typescript
   * expect(registry).not.toHaveCalledTask('cancelOrder');
   * ```
   */
  not: TaskMatchers<R>;
}

/**
 * Custom matchers for a `MockWorkflowHandle`.
 */
export interface HandleMatchers<R = unknown> {
  /**
   * Assert that an event was sent through the handle, optionally with specific data.
   *
   * Data is compared by its JSON serialization.
   *
   * @example
   * ```typescript
   * expect(handle).toHaveReceivedEvent('orderApproved');
   * expect(handle).toHaveReceivedEvent('orderApproved', { by: 'manager' });
   * ```
   */
  toHaveReceivedEvent(eventName: string, data?: any): R;

  /**
   * Assert that a query was made through the handle.
   *
   * @example
   * ```typescript
   * expect(handle).toHaveReceivedQuery('getStatus');
   * ```
   */
  toHaveReceivedQuery(queryName: string): R;
}

/**
 * Matchers for execution traces, in the form `expect.extend` accepts.
 */
export const workflowMatchers = {
  toHaveCompletedSuccessfully(received: ExecutionTrace): MatcherResult {
    const pass = received && received.status === 'completed';
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to be completed`
          : `Expected workflow ${received?.workflowId ?? 'undefined'} to be completed, but status was ${
              received?.status ?? 'undefined'
            }`,
    };
  },

  toHaveFailedWith(received: ExecutionTrace, errorPattern: string | RegExp): MatcherResult {
    if (!received) {
      return {
        pass: false,
        message: () => 'Expected workflow trace to exist, but it was undefined',
      };
    }

    const isFailed = received.status === 'failed';
    if (!isFailed) {
      return {
        pass: false,
        message: () =>
          `Expected workflow ${received.workflowId} to be failed, but status was ${received.status}`,
      };
    }

    if (!received.error) {
      return {
        pass: false,
        message: () =>
          `Expected workflow ${received.workflowId} to have error, but it was undefined`,
      };
    }

    const actualMessage = received.error.message;
    const matches =
      typeof errorPattern === 'string'
        ? actualMessage.includes(errorPattern)
        : errorPattern.test(actualMessage);

    return {
      pass: matches,
      message: () =>
        matches
          ? `Expected workflow ${received.workflowId} not to fail with error matching "${errorPattern}"`
          : `Expected workflow ${received.workflowId} to fail with error matching "${errorPattern}", but got: "${actualMessage}"`,
    };
  },

  toBeRunning(received: ExecutionTrace): MatcherResult {
    const pass = received && received.status === 'running';
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to be running`
          : `Expected workflow ${received?.workflowId ?? 'undefined'} to be running, but status was ${
              received?.status ?? 'undefined'
            }`,
    };
  },

  toBeCancelled(received: ExecutionTrace): MatcherResult {
    const pass = received && received.status === 'cancelled';
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to be cancelled`
          : `Expected workflow ${received?.workflowId ?? 'undefined'} to be cancelled, but status was ${
              received?.status ?? 'undefined'
            }`,
    };
  },

  toHaveTimedOut(received: ExecutionTrace): MatcherResult {
    const pass = received && received.status === 'timed_out';
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to be timed out`
          : `Expected workflow ${received?.workflowId ?? 'undefined'} to be timed out, but status was ${
              received?.status ?? 'undefined'
            }`,
    };
  },

  toHaveStatus(received: ExecutionTrace, expectedStatus: ExecutionStatus): MatcherResult {
    const pass = received && received.status === expectedStatus;
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to have status ${expectedStatus}`
          : `Expected workflow ${received?.workflowId ?? 'undefined'} to have status ${expectedStatus}, but status was ${
              received?.status ?? 'undefined'
            }`,
    };
  },

  toHaveExecutedTask(received: ExecutionTrace, taskName: string, count?: number): MatcherResult {
    if (!received) {
      return {
        pass: false,
        message: () => 'Expected workflow trace to exist, but it was undefined',
      };
    }

    const actualCount = received.getTaskExecutionCount(taskName);

    if (count === undefined) {
      const pass = actualCount > 0;
      return {
        pass,
        message: () =>
          pass
            ? `Expected workflow ${received.workflowId} not to have executed task '${taskName}'`
            : `Expected workflow ${received.workflowId} to have executed task '${taskName}', but it was not executed`,
      };
    }

    const pass = actualCount === count;
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to have executed task '${taskName}' ${count} time${
              count === 1 ? '' : 's'
            }`
          : `Expected workflow ${received.workflowId} to have executed task '${taskName}' ${count} time${
              count === 1 ? '' : 's'
            }, but was executed ${actualCount} time${actualCount === 1 ? '' : 's'}`,
    };
  },

  toHaveState(received: ExecutionTrace, key: string, value?: any): MatcherResult {
    if (!received) {
      return {
        pass: false,
        message: () => 'Expected workflow trace to exist, but it was undefined',
      };
    }

    const hasKey = received.hasState(key);
    if (!hasKey) {
      return {
        pass: false,
        message: () =>
          `Expected workflow ${received.workflowId} to have state key '${key}', but it doesn't`,
      };
    }

    if (value === undefined) {
      return {
        pass: true,
        message: () => `Expected workflow ${received.workflowId} not to have state key '${key}'`,
      };
    }

    const actualValue = received.getState(key);
    const pass = JSON.stringify(actualValue) === JSON.stringify(value);

    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} state[${key}] not to be ${JSON.stringify(value)}`
          : `Expected workflow ${received.workflowId} state[${key}] to be ${JSON.stringify(
              value
            )}, but got ${JSON.stringify(actualValue)}`,
    };
  },

  toHaveReceivedEvent(received: ExecutionTrace, eventName: string, count?: number): MatcherResult {
    if (!received) {
      return {
        pass: false,
        message: () => 'Expected workflow trace to exist, but it was undefined',
      };
    }

    const actualCount = received.getEventCount(eventName);

    if (count === undefined) {
      const pass = actualCount > 0;
      return {
        pass,
        message: () =>
          pass
            ? `Expected workflow ${received.workflowId} not to have received event '${eventName}'`
            : `Expected workflow ${received.workflowId} to have received event '${eventName}', but it was not received`,
      };
    }

    const pass = actualCount === count;
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} not to have received event '${eventName}' ${count} time${
              count === 1 ? '' : 's'
            }`
          : `Expected workflow ${received.workflowId} to have received event '${eventName}' ${count} time${
              count === 1 ? '' : 's'
            }, but received ${actualCount} time${actualCount === 1 ? '' : 's'}`,
    };
  },

  toHaveDurationBetween(received: ExecutionTrace, minMs: number, maxMs: number): MatcherResult {
    if (!received) {
      return {
        pass: false,
        message: () => 'Expected workflow trace to exist, but it was undefined',
      };
    }

    const duration = received.duration;
    if (duration === undefined) {
      return {
        pass: false,
        message: () =>
          `Expected workflow ${received.workflowId} to have completed to measure duration, but status was ${received.status}`,
      };
    }

    const pass = duration >= minMs && duration <= maxMs;
    return {
      pass,
      message: () =>
        pass
          ? `Expected workflow ${received.workflowId} duration not to be between ${minMs}ms and ${maxMs}ms`
          : `Expected workflow ${received.workflowId} duration to be between ${minMs}ms and ${maxMs}ms, but was ${duration}ms`,
    };
  },
};

/**
 * Matchers for a mock task registry, in the form `expect.extend` accepts.
 */
export const taskMatchers = {
  toHaveCalledTask(received: MockTaskRegistry, taskName: string, count?: number): MatcherResult {
    const actualCount = received.getCallCount(taskName);

    if (count === undefined) {
      const pass = actualCount > 0;
      return {
        pass,
        message: () =>
          pass
            ? `Expected task '${taskName}' not to be called`
            : `Expected task '${taskName}' to be called, but it was not called`,
      };
    }

    const pass = actualCount === count;
    return {
      pass,
      message: () =>
        pass
          ? `Expected task '${taskName}' not to be called ${count} time${count === 1 ? '' : 's'}`
          : `Expected task '${taskName}' to be called ${count} time${
              count === 1 ? '' : 's'
            }, but was called ${actualCount} time${actualCount === 1 ? '' : 's'}`,
    };
  },

  toHaveCalledTaskWith(received: MockTaskRegistry, taskName: string, input: any): MatcherResult {
    const calls = received.getCalls(taskName);

    if (calls.length === 0) {
      return {
        pass: false,
        message: () => `Expected task '${taskName}' to be called, but it was not called`,
      };
    }

    const found = calls.some((call) => JSON.stringify(call.input) === JSON.stringify(input));

    return {
      pass: found,
      message: () =>
        found
          ? `Expected task '${taskName}' not to be called with ${JSON.stringify(input)}`
          : `Expected task '${taskName}' to be called with ${JSON.stringify(
              input
            )}, but it was not. Actual calls: ${calls.map((c) => JSON.stringify(c.input)).join(', ')}`,
    };
  },
};

/**
 * Matchers for a mock workflow handle, in the form `expect.extend` accepts.
 */
export const handleMatchers = {
  toHaveReceivedEvent(received: MockWorkflowHandle, eventName: string, data?: any): MatcherResult {
    const events = received.getEventsSent();
    const matchingEvents = events.filter((e) => e.name === eventName);

    if (matchingEvents.length === 0) {
      return {
        pass: false,
        message: () =>
          `Expected workflow handle ${received.workflowId} to have received event '${eventName}', but it was not received`,
      };
    }

    if (data === undefined) {
      return {
        pass: true,
        message: () =>
          `Expected workflow handle ${received.workflowId} not to have received event '${eventName}'`,
      };
    }

    const found = matchingEvents.some((e) => JSON.stringify(e.data) === JSON.stringify(data));

    return {
      pass: found,
      message: () =>
        found
          ? `Expected workflow handle ${received.workflowId} not to have received event '${eventName}' with data ${JSON.stringify(
              data
            )}`
          : `Expected workflow handle ${received.workflowId} to have received event '${eventName}' with data ${JSON.stringify(
              data
            )}, but it was not received`,
    };
  },

  toHaveReceivedQuery(received: MockWorkflowHandle, queryName: string): MatcherResult {
    const queries = received.getQueriesMade();
    const found = queries.some((q) => q.name === queryName);

    return {
      pass: found,
      message: () =>
        found
          ? `Expected workflow handle ${received.workflowId} not to have received query '${queryName}'`
          : `Expected workflow handle ${received.workflowId} to have received query '${queryName}', but it was not received`,
    };
  },
};

/**
 * Extend expect with the workflow, task, and handle matchers.
 *
 * Call this in your test setup file. The matcher sets are merged into one object, so where two
 * share a name the later wins: `toHaveReceivedEvent` is the handle matcher. If `expect.extend`
 * is missing, this logs a warning and does nothing.
 *
 * @param expectInstance - Jest or Vitest expect instance
 *
 * @example Jest
 * ```typescript
 * // jest.setup.ts
 * import { expect } from '@jest/globals';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 * ```
 *
 * @example Vitest
 * ```typescript
 * // vitest.setup.ts
 * import { expect } from 'vitest';
 * import { extendExpect } from '@orcher/sdk/testing';
 *
 * extendExpect(expect);
 * ```
 */
export function extendExpect(expectInstance: any): void {
  if (expectInstance.extend) {
    expectInstance.extend({
      ...workflowMatchers,
      ...taskMatchers,
      ...handleMatchers,
    });
  } else {
    console.warn(
      '[ORCHER] Unable to extend expect - expect.extend is not available. ' +
        'Make sure you are using Jest 27+ or Vitest 0.30+'
    );
  }
}

/**
 * Type declarations that add the custom matchers to Jest's `expect`.
 *
 * They take effect once any file in the compilation imports `@orcher/sdk/testing`.
 *
 * @example
 * ```typescript
 * // test-setup.d.ts
 * import '@orcher/sdk/testing';
 * ```
 */
declare global {
  namespace jest {
    // @ts-ignore - interface extension conflict is acceptable for test matchers
    interface Matchers<R> extends WorkflowMatchers<R>, TaskMatchers<R>, HandleMatchers<R> {}
  }
}

// The same declarations for Vitest; they apply only when vitest is installed.
// @ts-ignore - vitest may not be installed
declare module 'vitest' {
  // @ts-ignore - interface extension conflict is expected
  interface Assertion extends WorkflowMatchers, TaskMatchers, HandleMatchers {}
  // @ts-ignore - interface extension conflict is expected
  interface AsymmetricMatchersContaining extends WorkflowMatchers, TaskMatchers, HandleMatchers {}
}
