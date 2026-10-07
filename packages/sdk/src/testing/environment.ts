/**
 * In-memory test environment for Orcher workflows.
 *
 * `TestWorkflowEnvironment` is the entry point for testing workflows without a
 * running server.
 *
 * @module @orcher/sdk/testing/environment
 */

import type { WorkflowFunction } from '../workflow/types';
import type { WorkflowReference } from '../di/types';
import { ExecutionTrace } from './trace';
import { TestExecutor } from './executor';
import { MockTaskRegistry, MockTaskInspector } from './mocks/task-registry';
import { MockTaskBuilder } from './mocks/task-builder';
import { TimeController } from './time/controller';
import type { TestEnvOptions, TestWorkflowOptions, TestEnvStats } from './types';

/**
 * A workflow the test environment can run: a run function, or the reference
 * `workflow({...})` returns.
 */
export type TestableWorkflow<TInput, TResult> =
  | WorkflowFunction<[TInput], TResult>
  | WorkflowReference<TInput, TResult>;

/**
 * The run function behind a workflow given as either form.
 *
 * A reference runs through the class `workflow()` generated for it, the same
 * path a worker takes, so the test exercises what the worker would run.
 */
function runFunctionOf<TInput, TResult>(
  workflow: TestableWorkflow<TInput, TResult>
): WorkflowFunction<[TInput], TResult> {
  if (typeof workflow === 'function') {
    return workflow;
  }
  if (
    typeof workflow === 'object' &&
    workflow !== null &&
    typeof workflow.workflowClass === 'function'
  ) {
    const WorkflowClass = workflow.workflowClass;
    return (ctx, input) => new WorkflowClass().run(ctx, input);
  }
  throw new TypeError(
    'executeWorkflow takes a workflow run function or the reference workflow({...}) returns'
  );
}

/**
 * Test environment that runs workflows in memory.
 *
 * It provides:
 * - Workflow execution without a server
 * - Task mocking through a fluent builder
 * - A controllable clock for deterministic timers
 * - Execution traces and workflow state inspection
 * - Assertions on task calls and workflow outcomes
 *
 * @example Basic usage
 * ```typescript
 * import { TestWorkflowEnvironment } from '@orcher/sdk/testing';
 * import { orderWorkflow } from './workflows/orderWorkflow';
 *
 * describe('Order Workflow', () => {
 *   let testEnv: TestWorkflowEnvironment;
 *
 *   beforeEach(async () => {
 *     testEnv = await TestWorkflowEnvironment.create();
 *   });
 *
 *   afterEach(async () => {
 *     await testEnv.cleanup();
 *   });
 *
 *   it('should process order successfully', async () => {
 *     // Mock task responses
 *     testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123' });
 *     testEnv.mockTask('reserveInventory').returns({ reserved: true });
 *
 *     // Execute workflow
 *     const result = await testEnv.executeWorkflow(orderWorkflow, {
 *       orderId: 'order-123',
 *       amount: 99.99
 *     });
 *
 *     // Assertions
 *     expect(result.status).toBe('completed');
 *     testEnv.assertTaskCalled('chargeCard', 1);
 *   });
 * });
 * ```
 *
 * @example With time control
 * ```typescript
 * it('should finish once the slow task resolves', async () => {
 *   const testEnv = await TestWorkflowEnvironment.create();
 *
 *   // Resolves after 10 seconds of test time, not real time.
 *   testEnv.mockTask('slowTask').resolvesAfter({ done: true }, 10000);
 *
 *   const promise = testEnv.executeWorkflow(workflow, input);
 *   await testEnv.advanceTime(10000);
 *
 *   await expect(promise).resolves.toBeDefined();
 * });
 * ```
 */
export class TestWorkflowEnvironment {
  private readonly mockRegistry: MockTaskRegistry;
  private readonly timeController: TimeController;
  private readonly executor: TestExecutor;
  private readonly options: Required<TestEnvOptions>;
  private readonly stats: TestEnvStats = {
    workflowsExecuted: 0,
    tasksExecuted: 0,
    eventsSent: 0,
    queriesHandled: 0,
    childWorkflowsSpawned: 0,
    timersCreated: 0,
    totalExecutionTime: 0,
  };

  private constructor(options: Required<TestEnvOptions>) {
    this.options = options;
    this.mockRegistry = new MockTaskRegistry();
    this.timeController = new TimeController(options.initialTime);
    this.executor = new TestExecutor(this.mockRegistry, this.timeController);
  }

  /**
   * Create a new test workflow environment.
   *
   * @param options - Environment options
   * @returns Test environment instance
   *
   * @example
   * ```typescript
   * const testEnv = await TestWorkflowEnvironment.create({
   *   namespace: 'test',
   *   taskQueue: 'test-queue',
   *   enableTracing: true,
   *   initialTime: new Date('2025-01-01T00:00:00Z')
   * });
   * ```
   */
  static async create(options: TestEnvOptions = {}): Promise<TestWorkflowEnvironment> {
    const defaultOptions: Required<TestEnvOptions> = {
      namespace: options.namespace ?? 'test',
      taskQueue: options.taskQueue ?? 'test-queue',
      captureSnapshots: options.captureSnapshots ?? false,
      enableTracing: options.enableTracing ?? true,
      initialTime: options.initialTime ?? new Date(),
      timeout: options.timeout ?? 30000,
      strictMode: options.strictMode ?? false,
    };

    return new TestWorkflowEnvironment(defaultOptions);
  }

  // ----------------------------------------------------------------------------
  // Workflow execution
  // ----------------------------------------------------------------------------

  /**
   * Execute a workflow with the given input and wait for its result.
   *
   * The execution is recorded as a trace under `options.workflowId`, or under a
   * generated ID if none is given.
   *
   * @param workflow - Workflow to execute: a run function, or the reference
   *   `workflow({...})` returns
   * @param input - Workflow input
   * @param options - Execution options
   * @returns Workflow result
   * @throws {Error} If the workflow throws or exceeds its timeout
   *
   * @example
   * ```typescript
   * const result = await testEnv.executeWorkflow(
   *   orderWorkflow,
   *   { orderId: '123', amount: 99.99 },
   *   { workflowId: 'test-wf-1', timeout: 5000 }
   * );
   * ```
   */
  async executeWorkflow<TInput, TResult>(
    workflow: TestableWorkflow<TInput, TResult>,
    input: TInput,
    options: TestWorkflowOptions = {}
  ): Promise<TResult> {
    const run = runFunctionOf(workflow);
    const startTime = Date.now();

    try {
      const result = await this.executor.execute(run, input, {
        ...options,
        taskQueue: options.taskQueue ?? this.options.taskQueue,
        timeout: options.timeout ?? this.options.timeout,
      });

      this.stats.workflowsExecuted++;
      this.stats.totalExecutionTime += Date.now() - startTime;

      return result;
    } catch (error) {
      this.stats.workflowsExecuted++;
      this.stats.totalExecutionTime += Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Start a workflow without awaiting it.
   *
   * Same as `executeWorkflow`; the name reads better when the test advances time
   * or does other work before awaiting the returned promise.
   *
   * @param workflow - Workflow: a run function, or the reference `workflow({...})` returns
   * @param input - Workflow input
   * @param options - Execution options
   * @returns Promise that resolves with workflow result
   *
   * @example
   * ```typescript
   * const promise = testEnv.startWorkflow(longWorkflow, input);
   *
   * await testEnv.advanceTime(5000);
   * const result = await promise;
   * ```
   */
  startWorkflow<TInput, TResult>(
    workflow: TestableWorkflow<TInput, TResult>,
    input: TInput,
    options: TestWorkflowOptions = {}
  ): Promise<TResult> {
    return this.executeWorkflow(workflow, input, options);
  }

  // ----------------------------------------------------------------------------
  // Task mocking
  // ----------------------------------------------------------------------------

  /**
   * Create a mock for a task.
   *
   * Returns a builder for configuring the mock's behavior. A workflow that calls
   * a task with no mock fails with an error naming the task.
   *
   * @param taskName - Task name to mock
   * @returns Mock builder
   *
   * @example Fixed value
   * ```typescript
   * testEnv.mockTask('chargeCard').returns({ chargeId: 'ch_123' });
   * ```
   *
   * @example Sequence
   * ```typescript
   * testEnv.mockTask('fetchPage').returnsSequence([
   *   { page: 1, data: [...] },
   *   { page: 2, data: [...] },
   *   new Error('No more pages')
   * ]);
   * ```
   *
   * @example Function
   * ```typescript
   * testEnv.mockTask('calculateTax').withFn(async (amount: number) => {
   *   return amount * 0.08;
   * });
   * ```
   *
   * @example Error
   * ```typescript
   * testEnv.mockTask('failingService').throws(new Error('Service down'));
   * ```
   */
  mockTask<TInput = any, TOutput = any>(taskName: string): MockTaskBuilder<TInput, TOutput> {
    return new MockTaskBuilder<TInput, TOutput>(taskName, this.mockRegistry, this.timeController);
  }

  /**
   * Get a handle for inspecting a task's calls.
   *
   * The handle reads the recorded calls when accessed, so it can be taken before
   * or after the workflow runs. It works for any task name, mocked or not; a task
   * that was never called reports no calls.
   *
   * @param taskName - Task name
   * @returns Inspector for the task's calls
   *
   * @example
   * ```typescript
   * const mock = testEnv.getMockTask('chargeCard');
   * expect(mock.callCount).toBe(2);
   * expect(mock.calls[0].input).toEqual({ amount: 99.99 });
   * expect(mock.wasCalledWith({ amount: 99.99 })).toBe(true);
   * ```
   */
  getMockTask(taskName: string): MockTaskInspector {
    return new MockTaskInspector(taskName, this.mockRegistry);
  }

  /**
   * Check if a task is mocked.
   *
   * @param taskName - Task name
   * @returns True if task has a mock
   *
   * @example
   * ```typescript
   * if (testEnv.isTaskMocked('chargeCard')) {
   *   console.log('Task is mocked');
   * }
   * ```
   */
  isTaskMocked(taskName: string): boolean {
    return this.mockRegistry.hasMock(taskName);
  }

  /**
   * Get task call count.
   *
   * @param taskName - Task name
   * @returns Number of times task was called
   *
   * @example
   * ```typescript
   * const count = testEnv.getTaskCallCount('chargeCard');
   * expect(count).toBe(3);
   * ```
   */
  getTaskCallCount(taskName: string): number {
    return this.mockRegistry.getCallCount(taskName);
  }

  // ----------------------------------------------------------------------------
  // Time control
  // ----------------------------------------------------------------------------

  /**
   * Advance the test clock by the given number of milliseconds.
   *
   * Timers that fall due during the advance fire in due order, and the code each
   * timer wakes runs before the next one fires. A workflow that sleeps in a loop
   * therefore sees every wake-up inside the advanced window.
   *
   * @param ms - Milliseconds to advance
   *
   * @example
   * ```typescript
   * await testEnv.advanceTime(5000); // 5 seconds
   * ```
   */
  async advanceTime(ms: number): Promise<void> {
    await this.timeController.advance(ms);
  }

  /**
   * Advance the test clock to the given time, firing timers as `advanceTime` does.
   *
   * @param targetTime - Target time
   * @throws {Error} If `targetTime` is earlier than the current test time
   *
   * @example
   * ```typescript
   * await testEnv.advanceTimeTo(new Date('2025-01-01T12:00:00Z'));
   * ```
   */
  async advanceTimeTo(targetTime: Date): Promise<void> {
    await this.timeController.advanceTo(targetTime);
  }

  /**
   * Get the current test time.
   *
   * @returns Current time
   *
   * @example
   * ```typescript
   * const now = testEnv.getCurrentTime();
   * console.log(now.toISOString());
   * ```
   */
  getCurrentTime(): Date {
    return this.timeController.now();
  }

  /**
   * Set the test clock to a specific time.
   *
   * @param time - New current time
   *
   * @example
   * ```typescript
   * testEnv.setCurrentTime(new Date('2025-01-01T00:00:00Z'));
   * ```
   */
  setCurrentTime(time: Date): void {
    this.timeController.setTime(time);
  }

  // ----------------------------------------------------------------------------
  // Execution inspection
  // ----------------------------------------------------------------------------

  /**
   * Get execution trace for a workflow.
   *
   * @param workflowId - Workflow ID
   * @returns Execution trace or undefined
   *
   * @example
   * ```typescript
   * const trace = testEnv.getExecutionTrace('test-wf-1');
   * console.log(`Status: ${trace.status}`);
   * console.log(`Tasks executed: ${trace.tasksExecuted.length}`);
   * ```
   */
  getExecutionTrace(workflowId: string): ExecutionTrace | undefined {
    return this.executor.getTrace(workflowId);
  }

  /**
   * Get all execution traces.
   *
   * @returns Map of all traces
   *
   * @example
   * ```typescript
   * const traces = testEnv.getAllExecutionTraces();
   * console.log(`Total workflows: ${traces.size}`);
   * ```
   */
  getAllExecutionTraces(): Map<string, ExecutionTrace> {
    return this.executor.getAllTraces();
  }

  /**
   * Get a workflow's state, or one key of it.
   *
   * @param workflowId - Workflow ID
   * @param key - State key; if omitted, the whole state map is returned
   * @returns State value or state map, or undefined if the workflow is unknown
   *
   * @example
   * ```typescript
   * const counter = testEnv.getWorkflowState('test-wf-1', 'counter');
   * expect(counter).toBe(5);
   * ```
   */
  getWorkflowState<T = any>(workflowId: string, key?: string): T | Map<string, any> | undefined {
    const trace = this.executor.getTrace(workflowId);
    if (!trace) {
      return undefined;
    }

    if (key) {
      return trace.getState(key) as T;
    }

    return trace.state;
  }

  // ----------------------------------------------------------------------------
  // Assertions
  // ----------------------------------------------------------------------------

  /**
   * Assert that a task was called.
   *
   * @param taskName - Task name
   * @param expectedCount - Exact expected call count; if omitted, at least once
   * @throws {Error} If assertion fails
   *
   * @example
   * ```typescript
   * testEnv.assertTaskCalled('chargeCard');
   * testEnv.assertTaskCalled('chargeCard', 3);
   * ```
   */
  assertTaskCalled(taskName: string, expectedCount?: number): void {
    if (expectedCount === undefined) {
      this.mockRegistry.verifyCalled(taskName);
    } else {
      this.mockRegistry.verifyCalledTimes(taskName, expectedCount);
    }
  }

  /**
   * Assert that a task was called with specific input.
   *
   * @param taskName - Task name
   * @param expectedInput - Expected input
   * @throws {Error} If assertion fails
   *
   * @example
   * ```typescript
   * testEnv.assertTaskCalledWith('chargeCard', { amount: 99.99 });
   * ```
   */
  assertTaskCalledWith<T>(taskName: string, expectedInput: T): void {
    this.mockRegistry.verifyCalledWith(taskName, expectedInput);
  }

  /**
   * Assert that a workflow completed successfully.
   *
   * @param workflowId - Workflow ID
   * @throws {Error} If workflow did not complete
   *
   * @example
   * ```typescript
   * testEnv.assertWorkflowCompleted('test-wf-1');
   * ```
   */
  assertWorkflowCompleted(workflowId: string): void {
    const trace = this.executor.getTrace(workflowId);
    if (!trace) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (trace.status !== 'completed') {
      throw new Error(
        `Expected workflow ${workflowId} to be completed, but status is ${trace.status}`
      );
    }
  }

  /**
   * Assert that a workflow failed.
   *
   * @param workflowId - Workflow ID
   * @param errorMessage - Expected error message: a substring, or a regex to match
   * @throws {Error} If workflow did not fail
   *
   * @example
   * ```typescript
   * testEnv.assertWorkflowFailed('test-wf-1');
   * testEnv.assertWorkflowFailed('test-wf-1', 'Payment failed');
   * testEnv.assertWorkflowFailed('test-wf-1', /timeout/i);
   * ```
   */
  assertWorkflowFailed(workflowId: string, errorMessage?: string | RegExp): void {
    const trace = this.executor.getTrace(workflowId);
    if (!trace) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (trace.status !== 'failed') {
      throw new Error(
        `Expected workflow ${workflowId} to be failed, but status is ${trace.status}`
      );
    }

    if (errorMessage && trace.error) {
      const actualMessage = trace.error.message;
      const matches =
        typeof errorMessage === 'string'
          ? actualMessage.includes(errorMessage)
          : errorMessage.test(actualMessage);

      if (!matches) {
        throw new Error(
          `Expected workflow ${workflowId} to fail with message matching ${errorMessage}, ` +
            `but got: ${actualMessage}`
        );
      }
    }
  }

  /**
   * Assert that a workflow state key has the expected value.
   *
   * Values are compared by their JSON serialization.
   *
   * @param workflowId - Workflow ID
   * @param key - State key
   * @param expectedValue - Expected value
   * @throws {Error} If state doesn't match
   *
   * @example
   * ```typescript
   * testEnv.assertStateEquals('test-wf-1', 'counter', 5);
   * testEnv.assertStateEquals('test-wf-1', 'status', 'completed');
   * ```
   */
  assertStateEquals<T>(workflowId: string, key: string, expectedValue: T): void {
    const trace = this.executor.getTrace(workflowId);
    if (!trace) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const actualValue = trace.getState(key);
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      throw new Error(
        `Expected state[${key}] to be ${JSON.stringify(expectedValue)}, ` +
          `but got ${JSON.stringify(actualValue)}`
      );
    }
  }

  /**
   * Get test environment statistics.
   *
   * @returns Statistics object
   *
   * @example
   * ```typescript
   * const stats = testEnv.getStats();
   * console.log(`Workflows: ${stats.workflowsExecuted}`);
   * console.log(`Tasks: ${stats.tasksExecuted}`);
   * ```
   */
  getStats(): Readonly<TestEnvStats> {
    return { ...this.stats };
  }

  /**
   * Get a summary of the test environment.
   *
   * @returns Human-readable summary
   *
   * @example
   * ```typescript
   * console.log(testEnv.getSummary());
   * ```
   */
  getSummary(): string {
    const traces = this.executor.getAllTraces();
    const completed = Array.from(traces.values()).filter((t) => t.status === 'completed').length;
    const failed = Array.from(traces.values()).filter((t) => t.status === 'failed').length;

    return [
      `Test Environment Summary`,
      `========================`,
      `Namespace: ${this.options.namespace}`,
      `Task Queue: ${this.options.taskQueue}`,
      ``,
      `Statistics:`,
      `- Workflows Executed: ${this.stats.workflowsExecuted} (${completed} completed, ${failed} failed)`,
      `- Tasks Executed: ${this.stats.tasksExecuted}`,
      `- Events Sent: ${this.stats.eventsSent}`,
      `- Queries Handled: ${this.stats.queriesHandled}`,
      `- Child Workflows: ${this.stats.childWorkflowsSpawned}`,
      `- Timers Created: ${this.stats.timersCreated}`,
      `- Total Execution Time: ${this.stats.totalExecutionTime}ms`,
      ``,
      `Current Time: ${this.timeController.now().toISOString()}`,
      `Pending Timers: ${this.timeController.getPendingTimerCount()}`,
      ``,
      this.mockRegistry.getSummary(),
    ].join('\n');
  }

  /**
   * Clean up the test environment.
   *
   * Clears all mocks, traces, and timers. The clock and statistics are kept; use
   * `reset()` to clear those too.
   *
   * @example
   * ```typescript
   * afterEach(async () => {
   *   await testEnv.cleanup();
   * });
   * ```
   */
  async cleanup(): Promise<void> {
    this.mockRegistry.clear();
    this.executor.clearTraces();
    this.timeController.clearTimers();
  }

  /**
   * Reset the test environment to its initial state.
   *
   * Keeps the configuration, clears mocks, traces, timers, and statistics, and
   * sets the clock back to `initialTime`.
   *
   * @example
   * ```typescript
   * testEnv.reset();
   * ```
   */
  reset(): void {
    this.mockRegistry.clear();
    this.executor.clearTraces();
    this.timeController.reset(this.options.initialTime);
    Object.assign(this.stats, {
      workflowsExecuted: 0,
      tasksExecuted: 0,
      eventsSent: 0,
      queriesHandled: 0,
      childWorkflowsSpawned: 0,
      timersCreated: 0,
      totalExecutionTime: 0,
    });
  }
}

/**
 * Create a new test workflow environment.
 *
 * @param options - Environment options
 * @returns Test environment instance
 *
 * @example
 * ```typescript
 * const testEnv = await createTestWorkflowEnvironment({
 *   namespace: 'test',
 *   taskQueue: 'test-queue'
 * });
 * ```
 */
export async function createTestWorkflowEnvironment(
  options: TestEnvOptions = {}
): Promise<TestWorkflowEnvironment> {
  return TestWorkflowEnvironment.create(options);
}
