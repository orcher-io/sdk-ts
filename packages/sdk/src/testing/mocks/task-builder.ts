/**
 * Builder for configuring task mocks.
 *
 * @module @orcher/sdk/testing/mocks/task-builder
 */

import type { MockTaskRegistry } from './task-registry';
import type { TimeController } from '../time/controller';
import type {
  FixedMockStrategy,
  SequenceMockStrategy,
  FunctionMockStrategy,
  ErrorMockStrategy,
} from '../types';

/**
 * Builder for configuring one task's mock.
 *
 * Returned by `TestWorkflowEnvironment.mockTask()`. Each method registers a mock for the task,
 * replacing any mock set before, and returns nothing, so call one method per mock.
 *
 * @example
 * ```typescript
 * // Fixed value mock
 * testEnv.mockTask('chargeCard')
 *   .returns({ chargeId: 'ch_123', success: true });
 *
 * // Sequence mock
 * testEnv.mockTask('fetchPage')
 *   .returnsSequence([
 *     { page: 1, data: [...] },
 *     { page: 2, data: [...] },
 *     new Error('No more pages')
 *   ]);
 *
 * // Function mock
 * testEnv.mockTask('calculateTax')
 *   .withFn(async (amount: number) => amount * 0.08);
 *
 * // Error mock
 * testEnv.mockTask('failingService')
 *   .throws(new Error('Service unavailable'));
 * ```
 */
export class MockTaskBuilder<TInput = any, TOutput = any> {
  private readonly taskName: string;
  private readonly registry: MockTaskRegistry;
  private readonly timeController?: TimeController;

  /**
   * @param taskName - Task name to mock
   * @param registry - Registry the mock is registered in
   * @param timeController - Test clock that delayed mocks wait on. Without one
   *   they wait in real time.
   */
  constructor(taskName: string, registry: MockTaskRegistry, timeController?: TimeController) {
    this.taskName = taskName;
    this.registry = registry;
    this.timeController = timeController;
  }

  /**
   * Wait out a mock's delay. Inside a test environment this is a timer on the
   * test clock, so `advanceTime` is what releases it, the same way it releases
   * a workflow's `sleep`. A delay on the test clock keeps the mock consistent
   * with the rest of the test: advancing the clock is what lets the call
   * finish, and afterwards the clock shows the time the call took. Without a
   * time controller the delay is real time.
   */
  private delay(ms: number): Promise<void> {
    if (this.timeController) {
      return this.timeController.sleep(ms);
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mock the task to return a fixed value.
   *
   * Every call returns the same value.
   *
   * @param value - Value to return
   *
   * @example
   * ```typescript
   * testEnv.mockTask('validateOrder')
   *   .returns({ valid: true });
   * ```
   */
  returns(value: TOutput): void {
    const strategy: FixedMockStrategy = {
      type: 'fixed',
      value,
    };
    this.registry.registerMock(this.taskName, strategy);
  }

  /**
   * Mock the task to return a sequence of values.
   *
   * Each call returns the next value in the sequence. An Error in the sequence is thrown instead
   * of returned. A call after the last value throws a "Mock sequence exhausted" error.
   *
   * @param values - Array of values or errors to return
   *
   * @example
   * ```typescript
   * // For a workflow that retries the call itself: fail twice, then succeed
   * testEnv.mockTask('chargeCard')
   *   .returnsSequence([
   *     new Error('Gateway timeout'),
   *     new Error('Gateway timeout'),
   *     { chargeId: 'ch_123', success: true }
   *   ]);
   * ```
   *
   * @example
   * ```typescript
   * // Paginated data
   * testEnv.mockTask('fetchPage')
   *   .returnsSequence([
   *     { page: 1, hasMore: true, items: [...] },
   *     { page: 2, hasMore: true, items: [...] },
   *     { page: 3, hasMore: false, items: [...] }
   *   ]);
   * ```
   */
  returnsSequence(values: (TOutput | Error)[]): void {
    const strategy: SequenceMockStrategy = {
      type: 'sequence',
      values: [...values],
      currentIndex: 0,
    };
    this.registry.registerMock(this.taskName, strategy);
  }

  /**
   * Mock the task with a custom function.
   *
   * The function receives the task input and returns the output. It may be async, and whatever
   * it throws becomes the task's error.
   *
   * @param fn - Function to execute for mock
   *
   * @example
   * ```typescript
   * // Calculate based on input
   * testEnv.mockTask('calculateTotal')
   *   .withFn(async (items: Item[]) => {
   *     return items.reduce((sum, item) => sum + item.price, 0);
   *   });
   * ```
   *
   * @example
   * ```typescript
   * // Conditional behavior
   * testEnv.mockTask('validateCard')
   *   .withFn(async (card: Card) => {
   *     if (card.number.startsWith('4')) {
   *       return { valid: true, type: 'Visa' };
   *     }
   *     return { valid: false, error: 'Invalid card' };
   *   });
   * ```
   *
   * @example
   * ```typescript
   * // A real-time delay; use resolvesAfter() for a delay on the test clock
   * testEnv.mockTask('externalAPI')
   *   .withFn(async (request: Request) => {
   *     await new Promise(resolve => setTimeout(resolve, 100));
   *     return { data: 'response' };
   *   });
   * ```
   */
  withFn(fn: (input: TInput) => TOutput | Promise<TOutput>): void {
    const strategy: FunctionMockStrategy = {
      type: 'function',
      fn,
    };
    this.registry.registerMock(this.taskName, strategy);
  }

  /**
   * Mock the task to always throw an error.
   *
   * @param error - Error to throw (can be Error instance or string)
   *
   * @example
   * ```typescript
   * // Throw error instance
   * testEnv.mockTask('failingService')
   *   .throws(new Error('Service unavailable'));
   * ```
   *
   * @example
   * ```typescript
   * // Throw error string
   * testEnv.mockTask('invalidTask')
   *   .throws('Task not implemented');
   * ```
   *
   * @example
   * ```typescript
   * // Custom error class
   * class PaymentError extends Error {
   *   constructor(public code: string) {
   *     super(`Payment failed: ${code}`);
   *   }
   * }
   *
   * testEnv.mockTask('chargeCard')
   *   .throws(new PaymentError('INSUFFICIENT_FUNDS'));
   * ```
   */
  throws(error: Error | string): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    const strategy: ErrorMockStrategy = {
      type: 'error',
      error: err,
    };
    this.registry.registerMock(this.taskName, strategy);
  }

  /**
   * Mock the task to resolve after a delay.
   *
   * In a test environment the delay runs on the test clock, so the call stays pending until the
   * test advances time past it.
   *
   * @param value - Value to return
   * @param delayMs - Delay in milliseconds
   *
   * @example
   * ```typescript
   * testEnv.mockTask('slowAPI')
   *   .resolvesAfter({ data: 'result' }, 5000);
   *
   * const promise = testEnv.startWorkflow(workflow, input);
   * await testEnv.advanceTime(5000);
   * const result = await promise;
   * ```
   */
  resolvesAfter(value: TOutput, delayMs: number): void {
    this.withFn(async () => {
      await this.delay(delayMs);
      return value;
    });
  }

  /**
   * Mock the task to reject after a delay.
   *
   * The delay runs on the test clock in a test environment, as for `resolvesAfter()`.
   *
   * @param error - Error to throw
   * @param delayMs - Delay in milliseconds
   *
   * @example
   * ```typescript
   * testEnv.mockTask('slowFailure')
   *   .rejectsAfter(new Error('Timeout'), 5000);
   * ```
   */
  rejectsAfter(error: Error | string, delayMs: number): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.withFn(async () => {
      await this.delay(delayMs);
      throw err;
    });
  }

  /**
   * Alias for `returns()`, for tests that read better in promise terms.
   *
   * @param value - Value to resolve with
   *
   * @example
   * ```typescript
   * testEnv.mockTask('asyncTask')
   *   .resolves({ success: true });
   * ```
   */
  resolves(value: TOutput): void {
    this.returns(value);
  }

  /**
   * Alias for `throws()`, for tests that read better in promise terms.
   *
   * @param error - Error to reject with
   *
   * @example
   * ```typescript
   * testEnv.mockTask('asyncTask')
   *   .rejects(new Error('Failed'));
   * ```
   */
  rejects(error: Error | string): void {
    this.throws(error);
  }

  /**
   * Mock the task to return a value once, then throw.
   *
   * @param value - Value for the first call
   * @param error - Error for the second call. A third call throws "Mock sequence exhausted".
   *
   * @example
   * ```typescript
   * testEnv.mockTask('unreliableAPI')
   *   .returnsOnceThen({ data: 'success' }, new Error('Service down'));
   * ```
   */
  returnsOnceThen(value: TOutput, error: Error | string): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.returnsSequence([value, err]);
  }

  /**
   * Mock the task to throw once, then return a value.
   *
   * Useful for a workflow that handles a failed call and later calls the same
   * task again, for example after running a compensating task. Retries of a
   * single call come from the task's retry policy and are not simulated here.
   *
   * @param error - Error for the first call
   * @param value - Value for the second call. A third call throws "Mock sequence exhausted".
   *
   * @example
   * ```typescript
   * testEnv.mockTask('flakyAPI')
   *   .throwsOnceThen(new Error('Timeout'), { data: 'success' });
   * ```
   */
  throwsOnceThen(error: Error | string, value: TOutput): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.returnsSequence([err, value]);
  }

  /**
   * Mock the task to alternate between success and failure, starting with success.
   *
   * @param successValue - Value for success calls
   * @param errorValue - Error for failure calls
   * @param count - Total number of calls the sequence covers (default: 10). Later calls throw
   *   "Mock sequence exhausted".
   *
   * @example
   * ```typescript
   * testEnv.mockTask('alternatingAPI')
   *   .alternates(
   *     { data: 'success' },
   *     new Error('Failed'),
   *     4 // success, fail, success, fail
   *   );
   * ```
   */
  alternates(successValue: TOutput, errorValue: Error | string, count: number = 10): void {
    const err = typeof errorValue === 'string' ? new Error(errorValue) : errorValue;
    const values: (TOutput | Error)[] = [];

    for (let i = 0; i < count; i++) {
      values.push(i % 2 === 0 ? successValue : err);
    }

    this.returnsSequence(values);
  }

  /**
   * Record calls to the task, optionally running a function for each.
   *
   * The test environment never runs real task code, so a spy is a mock: with `fn` it behaves
   * like `withFn(fn)`, and without it every call returns `undefined`.
   *
   * @param fn - Optional function to run for each call
   *
   * @example
   * ```typescript
   * testEnv.mockTask('logEvent')
   *   .spy(async (event) => {
   *     console.log('Event:', event);
   *     return undefined;
   *   });
   *
   * // Later verify
   * testEnv.assertTaskCalled('logEvent', 3);
   * ```
   */
  spy(fn?: (input: TInput) => TOutput | Promise<TOutput>): void {
    if (fn) {
      this.withFn(fn);
    } else {
      this.returns(undefined as TOutput);
    }
  }
}

/**
 * Create a new mock task builder.
 *
 * The builder has no time controller, so `resolvesAfter()` and `rejectsAfter()` wait in real
 * time.
 *
 * @param taskName - Task name to mock
 * @param registry - Mock task registry
 * @returns New builder instance
 *
 * @example
 * ```typescript
 * const builder = createMockTaskBuilder('chargeCard', registry);
 * builder.returns({ chargeId: 'ch_123' });
 * ```
 */
export function createMockTaskBuilder(
  taskName: string,
  registry: MockTaskRegistry
): MockTaskBuilder {
  return new MockTaskBuilder(taskName, registry);
}
