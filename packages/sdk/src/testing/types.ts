/**
 * Types shared by the Orcher testing utilities: environment options, execution
 * trace records, mock strategies, and matcher interfaces.
 *
 * @module @orcher/sdk/testing/types
 */

/**
 * Options for creating a test workflow environment.
 */
export interface TestEnvOptions {
  /**
   * Default namespace for workflows.
   * @default "test"
   */
  namespace?: string;

  /**
   * Default task queue for workflows.
   * @default "test-queue"
   */
  taskQueue?: string;

  /**
   * Enable automatic state snapshot capture.
   *
   * Not supported yet: the option is accepted but no snapshots are captured.
   * @default false
   */
  captureSnapshots?: boolean;

  /**
   * Enable execution tracing for debugging.
   *
   * Traces are always recorded; setting this to false has no effect.
   * @default true
   */
  enableTracing?: boolean;

  /**
   * Initial time for the test environment.
   * @default new Date()
   */
  initialTime?: Date;

  /**
   * Maximum workflow execution timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Enable strict mode (fail on warnings).
   *
   * Not supported yet: the option is accepted but has no effect.
   * @default false
   */
  strictMode?: boolean;
}

/**
 * Execution trace for a workflow run.
 *
 * Records the tasks, events, queries, child workflows, timers, and state of one
 * workflow execution.
 */
export interface ExecutionTrace {
  /**
   * Unique workflow execution ID.
   */
  workflowId: string;

  /**
   * Workflow type/name.
   */
  workflowType: string;

  /**
   * Current execution status.
   */
  status: ExecutionStatus;

  /**
   * Workflow state (key-value pairs).
   */
  state: Map<string, any>;

  /**
   * Tasks executed during workflow run.
   */
  tasksExecuted: TaskExecution[];

  /**
   * Events received by the workflow.
   */
  eventsReceived: WorkflowEvent[];

  /**
   * Queries handled by the workflow.
   */
  queriesHandled: WorkflowQuery[];

  /**
   * Child workflows spawned.
   */
  childWorkflows: ChildWorkflowExecution[];

  /**
   * Timers created during execution.
   */
  timers: TimerExecution[];

  /**
   * Workflow start time.
   */
  startTime: Date;

  /**
   * Workflow end time (if completed).
   */
  endTime?: Date;

  /**
   * Error that caused workflow failure (if failed).
   */
  error?: Error;

  /**
   * Workflow result (if completed).
   */
  result?: any;
}

/**
 * Workflow execution status.
 */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/**
 * Record of a task execution.
 */
export interface TaskExecution {
  /**
   * Task name/type.
   */
  taskName: string;

  /**
   * Task input.
   */
  input: any;

  /**
   * Task output (if completed).
   */
  output?: any;

  /**
   * Error (if failed).
   */
  error?: Error;

  /**
   * Task execution status.
   */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /**
   * Start time.
   */
  startTime: Date;

  /**
   * End time (if completed/failed).
   */
  endTime?: Date;

  /**
   * Attempt number (for retries).
   */
  attempt: number;
}

/**
 * Record of a workflow event.
 */
export interface WorkflowEvent {
  /**
   * Event name.
   */
  name: string;

  /**
   * Event data/payload.
   */
  data: any;

  /**
   * Event timestamp.
   */
  timestamp: Date;

  /**
   * Event ID.
   */
  id: string;
}

/**
 * Record of a workflow query.
 */
export interface WorkflowQuery {
  /**
   * Query name.
   */
  name: string;

  /**
   * Query arguments.
   */
  args?: any;

  /**
   * Query result.
   */
  result: any;

  /**
   * Query timestamp.
   */
  timestamp: Date;
}

/**
 * Record of a child workflow execution.
 */
export interface ChildWorkflowExecution {
  /**
   * Child workflow ID.
   */
  workflowId: string;

  /**
   * Child workflow type.
   */
  workflowType: string;

  /**
   * Child workflow input.
   */
  input: any;

  /**
   * Child workflow result (if completed).
   */
  result?: any;

  /**
   * Child workflow status.
   */
  status: ExecutionStatus;

  /**
   * Parent workflow ID.
   */
  parentWorkflowId: string;
}

/**
 * Record of a timer execution.
 */
export interface TimerExecution {
  /**
   * Timer ID.
   */
  id: string;

  /**
   * Duration in milliseconds.
   */
  duration: number;

  /**
   * Timer creation time.
   */
  createdAt: Date;

  /**
   * Timer fire time.
   */
  fireAt: Date;

  /**
   * Whether timer has fired.
   */
  fired: boolean;

  /**
   * Whether timer was cancelled.
   */
  cancelled: boolean;
}

/**
 * Mock strategy for tasks.
 */
export type MockStrategy =
  | FixedMockStrategy
  | SequenceMockStrategy
  | FunctionMockStrategy
  | ErrorMockStrategy;

/**
 * Fixed-value mock: returns the same value on every call.
 */
export interface FixedMockStrategy {
  type: 'fixed';
  value: any;
}

/**
 * Sequence mock: returns the next value on each call. An `Error` entry is thrown
 * instead of returned.
 */
export interface SequenceMockStrategy {
  type: 'sequence';
  values: (any | Error)[];
  currentIndex: number;
}

/**
 * Function mock: calls a custom function with the task input.
 */
export interface FunctionMockStrategy {
  type: 'function';
  fn: (input: any) => any | Promise<any>;
}

/**
 * Error mock: throws the same error on every call.
 */
export interface ErrorMockStrategy {
  type: 'error';
  error: Error;
}

/**
 * Task mock configuration.
 */
export interface TaskMock {
  /**
   * Task name being mocked.
   */
  taskName: string;

  /**
   * Mock strategy.
   */
  strategy: MockStrategy;

  /**
   * Call count.
   */
  callCount: number;

  /**
   * All calls made to this mock.
   */
  calls: TaskCall[];
}

/**
 * Record of a task call.
 */
export interface TaskCall {
  /**
   * Task name.
   */
  taskName: string;

  /**
   * Input arguments.
   */
  input: any;

  /**
   * Output/result.
   */
  output?: any;

  /**
   * Error (if failed).
   */
  error?: Error;

  /**
   * Call timestamp.
   */
  timestamp: Date;

  /**
   * Call duration in milliseconds.
   */
  duration?: number;
}

/**
 * State snapshot at a point in time.
 */
export interface StateSnapshot {
  /**
   * Workflow ID.
   */
  workflowId: string;

  /**
   * Snapshot timestamp.
   */
  timestamp: Date;

  /**
   * Workflow state at this point.
   */
  state: Map<string, any>;

  /**
   * Description of what triggered this snapshot.
   */
  trigger: string;

  /**
   * Sequence number.
   */
  sequence: number;
}

/**
 * Options for workflow execution in tests.
 */
export interface TestWorkflowOptions {
  /**
   * Workflow ID (generated if not provided).
   */
  workflowId?: string;

  /**
   * Task queue.
   */
  taskQueue?: string;

  /**
   * Workflow timeout in milliseconds.
   */
  timeout?: number;

  /**
   * Initial workflow state.
   *
   * Not supported yet: the option is accepted but the state starts empty.
   */
  initialState?: Record<string, any>;

  /**
   * Enable detailed tracing for this execution.
   *
   * Traces are always recorded; this option has no effect.
   */
  trace?: boolean;
}

/**
 * Assertion result.
 */
export interface AssertionResult {
  /**
   * Whether assertion passed.
   */
  pass: boolean;

  /**
   * Error message (if failed).
   */
  message?: string;

  /**
   * Expected value.
   */
  expected?: any;

  /**
   * Actual value.
   */
  actual?: any;
}

/**
 * Custom Jest/Vitest matchers for workflows.
 */
export interface WorkflowMatchers<R = unknown> {
  /**
   * Assert that a workflow completed successfully.
   */
  toHaveCompletedSuccessfully(): R;

  /**
   * Assert that a workflow failed with specific error.
   */
  toHaveFailedWith(error: string | RegExp | Error): R;

  /**
   * Assert that a workflow is still running.
   */
  toBeRunning(): R;

  /**
   * Assert that a workflow was cancelled.
   */
  toBeCancelled(): R;

  /**
   * Assert that a workflow timed out.
   */
  toHaveTimedOut(): R;
}

/**
 * Custom Jest/Vitest matchers for task calls.
 */
export interface TaskMatchers<R = unknown> {
  /**
   * Assert that a task was called.
   */
  toHaveBeenCalled(): R;

  /**
   * Assert that a task was called specific number of times.
   */
  toHaveBeenCalledTimes(count: number): R;

  /**
   * Assert that a task was called with specific input.
   */
  toHaveBeenCalledWith(input: any): R;

  /**
   * Negated form of these matchers, e.g. `not.toHaveBeenCalled()`.
   */
  not: TaskMatchers<R>;
}

/**
 * Test fixture builder interface.
 */
export interface TestFixture<T> {
  /**
   * Build the fixture with default values.
   */
  build(): T;

  /**
   * Build the fixture with overrides.
   */
  with(overrides: Partial<T>): TestFixture<T>;

  /**
   * Build multiple fixtures.
   */
  buildMany(count: number): T[];
}

/**
 * Mock workflow handle for testing.
 */
export interface MockWorkflowHandle<R = any> {
  /**
   * Workflow ID.
   */
  readonly workflowId: string;

  /**
   * Get workflow result.
   */
  result(): Promise<R>;

  /**
   * Send event to workflow.
   */
  sendEvent(name: string, data: any): Promise<void>;

  /**
   * Query workflow.
   */
  query<Q = any>(name: string, args?: any): Promise<Q>;

  /**
   * Cancel workflow.
   */
  cancel(): Promise<void>;

  /**
   * Get workflow status.
   */
  getStatus(): Promise<ExecutionStatus>;

  /**
   * Wait for workflow to reach specific status.
   */
  waitForStatus(status: ExecutionStatus, timeout?: number): Promise<void>;
}

/**
 * Options for time advancement.
 */
export interface TimeAdvanceOptions {
  /**
   * Run all pending timers.
   */
  runAllTimers?: boolean;

  /**
   * Run only next timer.
   */
  runNextTimer?: boolean;

  /**
   * Fire timers incrementally during advancement.
   *
   * @deprecated Timers always fire incrementally as time advances; this option is ignored.
   */
  incremental?: boolean;
}

/**
 * Timer configuration for testing.
 */
export interface MockTimer {
  /**
   * Timer ID.
   */
  id: string;

  /**
   * Callback to execute when timer fires.
   */
  callback: () => void | Promise<void>;

  /**
   * Fire time.
   */
  fireAt: Date;

  /**
   * Whether timer has fired.
   */
  fired: boolean;

  /**
   * Whether timer is cancelled.
   */
  cancelled: boolean;
}

/**
 * Test environment statistics.
 */
export interface TestEnvStats {
  /**
   * Total workflows executed.
   */
  workflowsExecuted: number;

  /**
   * Total tasks executed.
   */
  tasksExecuted: number;

  /**
   * Total events sent.
   */
  eventsSent: number;

  /**
   * Total queries handled.
   */
  queriesHandled: number;

  /**
   * Total child workflows spawned.
   */
  childWorkflowsSpawned: number;

  /**
   * Total timers created.
   */
  timersCreated: number;

  /**
   * Total execution time (milliseconds).
   */
  totalExecutionTime: number;
}
