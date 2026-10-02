/**
 * Registry of task mocks and the calls made to them.
 *
 * @module @orcher/sdk/testing/mocks/task-registry
 */

import type {
  TaskMock,
  TaskCall,
  MockStrategy,
  FixedMockStrategy,
  SequenceMockStrategy,
  FunctionMockStrategy,
  ErrorMockStrategy,
} from '../types';

/**
 * Registry for task mocks.
 *
 * Holds one mock strategy per task name, runs it when the workflow calls the task, and records
 * every call (input, output or error, duration) for assertions. Inputs are compared by their
 * JSON serialization.
 *
 * @example
 * ```typescript
 * const registry = new MockTaskRegistry();
 *
 * // Register a mock
 * registry.registerMock('chargeCard', {
 *   type: 'fixed',
 *   value: { chargeId: 'ch_123', success: true }
 * });
 *
 * // Execute mock
 * const result = await registry.execute('chargeCard', { amount: 99.99 });
 * console.log(result.chargeId); // 'ch_123'
 *
 * // Verify calls
 * console.log(registry.getCallCount('chargeCard')); // 1
 * ```
 */
export class MockTaskRegistry {
  private readonly mocks: Map<string, TaskMock> = new Map();
  private readonly calls: Map<string, TaskCall[]> = new Map();

  /**
   * Register a mock for a task.
   *
   * Replaces any existing mock for the task and clears its recorded calls.
   *
   * @param taskName - Task name to mock
   * @param strategy - Mock strategy
   *
   * @example
   * ```typescript
   * registry.registerMock('sendEmail', {
   *   type: 'fixed',
   *   value: undefined
   * });
   * ```
   */
  registerMock(taskName: string, strategy: MockStrategy): void {
    const mock: TaskMock = {
      taskName,
      strategy,
      callCount: 0,
      calls: [],
    };
    this.mocks.set(taskName, mock);
    this.calls.set(taskName, []);
  }

  /**
   * Check if a task has a mock registered.
   *
   * @param taskName - Task name
   * @returns True if mock exists
   */
  hasMock(taskName: string): boolean {
    return this.mocks.has(taskName);
  }

  /**
   * Get mock for a task.
   *
   * @param taskName - Task name
   * @returns Task mock or undefined
   */
  getMock(taskName: string): TaskMock | undefined {
    return this.mocks.get(taskName);
  }

  /**
   * Execute a mocked task.
   *
   * @param taskName - Task name
   * @param input - Task input
   * @returns Task output
   * @throws {Error} If the task is not mocked, or the mock throws. The call is recorded either
   *   way.
   *
   * @example
   * ```typescript
   * const result = await registry.execute('validateOrder', order);
   * ```
   */
  async execute<TInput, TOutput>(taskName: string, input: TInput): Promise<TOutput> {
    const mock = this.mocks.get(taskName);
    if (!mock) {
      throw new Error(
        `Task '${taskName}' is not mocked. ` +
          `Use testEnv.mockTask('${taskName}') to register a mock.`
      );
    }

    const startTime = Date.now();
    const call: TaskCall = {
      taskName,
      input,
      timestamp: new Date(),
    };

    try {
      const output = await this.executeMockStrategy<TInput, TOutput>(mock.strategy, input);

      call.output = output;
      call.duration = Date.now() - startTime;

      this.recordCall(taskName, call);
      mock.callCount++;

      return output;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      call.error = err;
      call.duration = Date.now() - startTime;

      this.recordCall(taskName, call);
      mock.callCount++;

      throw err;
    }
  }

  private async executeMockStrategy<TInput, TOutput>(
    strategy: MockStrategy,
    input: TInput
  ): Promise<TOutput> {
    switch (strategy.type) {
      case 'fixed':
        return this.executeFixedMock(strategy);

      case 'sequence':
        return this.executeSequenceMock(strategy);

      case 'function':
        return this.executeFunctionMock(strategy, input);

      case 'error':
        return this.executeErrorMock(strategy);

      default:
        throw new Error(`Unknown mock strategy type: ${(strategy as any).type}`);
    }
  }

  private executeFixedMock<TOutput>(strategy: FixedMockStrategy): TOutput {
    return strategy.value as TOutput;
  }

  /**
   * Return the next value in the sequence, throwing it if it is an Error.
   * Throws once the sequence is exhausted.
   */
  private executeSequenceMock<TOutput>(strategy: SequenceMockStrategy): TOutput {
    if (strategy.currentIndex >= strategy.values.length) {
      throw new Error(
        `Mock sequence exhausted. ` +
          `Called ${strategy.currentIndex + 1} times but only ${strategy.values.length} values provided.`
      );
    }

    const value = strategy.values[strategy.currentIndex];
    strategy.currentIndex++;

    if (value instanceof Error) {
      throw value;
    }

    return value as TOutput;
  }

  private async executeFunctionMock<TInput, TOutput>(
    strategy: FunctionMockStrategy,
    input: TInput
  ): Promise<TOutput> {
    const result = await strategy.fn(input);
    return result as TOutput;
  }

  private executeErrorMock(strategy: ErrorMockStrategy): never {
    throw strategy.error;
  }

  private recordCall(taskName: string, call: TaskCall): void {
    const calls = this.calls.get(taskName);
    if (calls) {
      calls.push(call);
    } else {
      this.calls.set(taskName, [call]);
    }

    const mock = this.mocks.get(taskName);
    if (mock) {
      mock.calls.push(call);
    }
  }

  /**
   * Get call count for a task.
   *
   * @param taskName - Task name
   * @returns Number of times task was called
   *
   * @example
   * ```typescript
   * console.log(registry.getCallCount('chargeCard')); // 3
   * ```
   */
  getCallCount(taskName: string): number {
    return this.calls.get(taskName)?.length ?? 0;
  }

  /**
   * Get all calls for a task.
   *
   * @param taskName - Task name
   * @returns Array of task calls
   *
   * @example
   * ```typescript
   * const calls = registry.getCalls('chargeCard');
   * calls.forEach(call => {
   *   console.log('Input:', call.input);
   *   console.log('Output:', call.output);
   * });
   * ```
   */
  getCalls(taskName: string): TaskCall[] {
    return this.calls.get(taskName) ?? [];
  }

  /**
   * Get all calls across all tasks.
   *
   * @returns Map of all task calls
   */
  getAllCalls(): Map<string, TaskCall[]> {
    return new Map(this.calls);
  }

  /**
   * Clear all mocks and calls.
   *
   * @example
   * ```typescript
   * afterEach(() => {
   *   registry.clear();
   * });
   * ```
   */
  clear(): void {
    this.mocks.clear();
    this.calls.clear();
  }

  /**
   * Clear calls but keep mocks registered.
   *
   * @example
   * ```typescript
   * // Keep mocks, but reset call history between tests
   * registry.clearCalls();
   * ```
   */
  clearCalls(): void {
    this.calls.clear();
    this.mocks.forEach((mock) => {
      mock.callCount = 0;
      mock.calls = [];
    });
  }

  /**
   * Clear the call history of one task, keeping its mock registered.
   *
   * @param taskName - Task name
   */
  clearCallsFor(taskName: string): void {
    this.calls.delete(taskName);
    const mock = this.mocks.get(taskName);
    if (mock) {
      mock.callCount = 0;
      mock.calls = [];
    }
  }

  /**
   * Check whether a task was called with specific input.
   *
   * @param taskName - Task name
   * @param expectedInput - Expected input
   * @returns True if any recorded call had that input
   */
  wasCalledWith<TInput>(taskName: string, expectedInput: TInput): boolean {
    return this.getCalls(taskName).some((call) => this.deepEqual(call.input, expectedInput));
  }

  /**
   * Remove a specific mock and its recorded calls.
   *
   * @param taskName - Task name
   *
   * @example
   * ```typescript
   * registry.removeMock('chargeCard');
   * ```
   */
  removeMock(taskName: string): void {
    this.mocks.delete(taskName);
    this.calls.delete(taskName);
  }

  /**
   * Get summary of all mocks.
   *
   * @returns Human-readable summary
   *
   * @example
   * ```typescript
   * console.log(registry.getSummary());
   * // Mocked Tasks: 3
   * // - chargeCard: 5 calls
   * // - reserveInventory: 2 calls
   * // - sendEmail: 1 call
   * ```
   */
  getSummary(): string {
    const lines: string[] = [`Mocked Tasks: ${this.mocks.size}`];

    this.mocks.forEach((_mock, taskName) => {
      const callCount = this.getCallCount(taskName);
      lines.push(`- ${taskName}: ${callCount} call${callCount === 1 ? '' : 's'}`);
    });

    return lines.join('\n');
  }

  /**
   * Verify that a task was called.
   *
   * @param taskName - Task name
   * @throws {Error} If task was not called
   *
   * @example
   * ```typescript
   * registry.verifyCalled('chargeCard');
   * ```
   */
  verifyCalled(taskName: string): void {
    const callCount = this.getCallCount(taskName);
    if (callCount === 0) {
      throw new Error(`Expected task '${taskName}' to be called, but it was not called.`);
    }
  }

  /**
   * Verify that a task was called specific number of times.
   *
   * @param taskName - Task name
   * @param expectedCount - Expected call count
   * @throws {Error} If call count doesn't match
   *
   * @example
   * ```typescript
   * registry.verifyCalledTimes('chargeCard', 3);
   * ```
   */
  verifyCalledTimes(taskName: string, expectedCount: number): void {
    const actualCount = this.getCallCount(taskName);
    if (actualCount !== expectedCount) {
      throw new Error(
        `Expected task '${taskName}' to be called ${expectedCount} time${
          expectedCount === 1 ? '' : 's'
        }, but was called ${actualCount} time${actualCount === 1 ? '' : 's'}.`
      );
    }
  }

  /**
   * Verify that a task was called with specific input.
   *
   * @param taskName - Task name
   * @param expectedInput - Expected input
   * @throws {Error} If task was not called with expected input
   *
   * @example
   * ```typescript
   * registry.verifyCalledWith('chargeCard', { amount: 99.99 });
   * ```
   */
  verifyCalledWith<TInput>(taskName: string, expectedInput: TInput): void {
    if (!this.wasCalledWith(taskName, expectedInput)) {
      throw new Error(
        `Expected task '${taskName}' to be called with ${JSON.stringify(
          expectedInput
        )}, but it was not.`
      );
    }
  }

  /**
   * Compare two values by their JSON serialization, so object key order matters.
   */
  private deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * A recorded call as seen through {@link MockTaskInspector}: the registry's
 * call record plus `result`, the name the testing guide uses for the value the
 * mock returned.
 */
export interface MockTaskCallRecord extends TaskCall {
  /** Value the mock returned (same as `output`); undefined if the call threw */
  result?: any;
}

/**
 * Read-only view of one mocked task's calls, returned by
 * `TestWorkflowEnvironment.getMockTask()`.
 *
 * Every property reads the registry when accessed rather than copying it, so a
 * handle obtained before a workflow runs still reports the calls that run made.
 *
 * @example
 * ```typescript
 * const mock = testEnv.getMockTask('chargeCard');
 * expect(mock.callCount).toBe(1);
 * expect(mock.calls[0].input).toEqual({ amount: 99.99 });
 * expect(mock.wasCalledWith({ amount: 99.99 })).toBe(true);
 * mock.reset();
 * ```
 */
export class MockTaskInspector {
  constructor(
    readonly taskName: string,
    private readonly registry: MockTaskRegistry
  ) {}

  /** Number of times the task was called */
  get callCount(): number {
    return this.registry.getCallCount(this.taskName);
  }

  /** Whether the task was called at least once */
  get wasCalled(): boolean {
    return this.callCount > 0;
  }

  /** Calls in the order they were made */
  get calls(): MockTaskCallRecord[] {
    return this.registry.getCalls(this.taskName).map((call) => ({ ...call, result: call.output }));
  }

  /** Whether any call was made with this input */
  wasCalledWith<TInput>(expectedInput: TInput): boolean {
    return this.registry.wasCalledWith(this.taskName, expectedInput);
  }

  /**
   * Forget the calls recorded so far. The mock's configured behavior is kept,
   * so later calls still return what it was set up to return.
   */
  reset(): void {
    this.registry.clearCallsFor(this.taskName);
  }
}

/**
 * Create a new mock task registry.
 *
 * @returns New registry instance
 *
 * @example
 * ```typescript
 * const registry = createMockTaskRegistry();
 * ```
 */
export function createMockTaskRegistry(): MockTaskRegistry {
  return new MockTaskRegistry();
}
