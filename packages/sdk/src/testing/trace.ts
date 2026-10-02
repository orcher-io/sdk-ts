/**
 * Recording of what a workflow did during a test.
 *
 * `ExecutionTrace` holds a run's status, state, tasks, events, queries, child workflows, and
 * timers, for inspection and assertions.
 *
 * @module @orcher/sdk/testing/trace
 */

import type {
  ExecutionTrace as IExecutionTrace,
  ExecutionStatus,
  TaskExecution,
  WorkflowEvent,
  WorkflowQuery,
  ChildWorkflowExecution,
  TimerExecution,
  StateSnapshot,
} from './types';

/**
 * Record of one workflow run in a test.
 *
 * The test executor writes to it as the workflow runs; tests read it through
 * `TestWorkflowEnvironment.getExecutionTrace()`. Timestamps and `duration` come from the real
 * clock, not the test clock. Collection getters return copies.
 *
 * @example
 * ```typescript
 * const trace = new ExecutionTrace('wf-123', 'orderWorkflow');
 *
 * // Record task execution
 * trace.recordTaskStart('chargeCard', { amount: 99.99 });
 * trace.recordTaskComplete('chargeCard', { chargeId: 'ch_123' });
 *
 * // Record events
 * trace.recordEvent('orderApproved', { approvedBy: 'manager' });
 *
 * // Get execution summary
 * const summary = trace.toJSON();
 * console.log(`Executed ${summary.tasksExecuted.length} tasks`);
 * ```
 */
export class ExecutionTrace {
  private readonly _workflowId: string;
  private readonly _workflowType: string;
  private _status: ExecutionStatus = 'pending';
  private readonly _state: Map<string, any> = new Map();
  private readonly _tasksExecuted: TaskExecution[] = [];
  private readonly _eventsReceived: WorkflowEvent[] = [];
  private readonly _queriesHandled: WorkflowQuery[] = [];
  private readonly _childWorkflows: ChildWorkflowExecution[] = [];
  private readonly _timers: TimerExecution[] = [];
  private readonly _snapshots: StateSnapshot[] = [];
  private readonly _startTime: Date;
  private _endTime?: Date;
  private _error?: Error;
  private _result?: any;

  constructor(workflowId: string, workflowType: string) {
    this._workflowId = workflowId;
    this._workflowType = workflowType;
    this._startTime = new Date();
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get workflowId(): string {
    return this._workflowId;
  }

  get workflowType(): string {
    return this._workflowType;
  }

  get status(): ExecutionStatus {
    return this._status;
  }

  get state(): Map<string, any> {
    return new Map(this._state);
  }

  get tasksExecuted(): readonly TaskExecution[] {
    return [...this._tasksExecuted];
  }

  get eventsReceived(): readonly WorkflowEvent[] {
    return [...this._eventsReceived];
  }

  get queriesHandled(): readonly WorkflowQuery[] {
    return [...this._queriesHandled];
  }

  get childWorkflows(): readonly ChildWorkflowExecution[] {
    return [...this._childWorkflows];
  }

  get timers(): readonly TimerExecution[] {
    return [...this._timers];
  }

  get snapshots(): readonly StateSnapshot[] {
    return [...this._snapshots];
  }

  get startTime(): Date {
    return this._startTime;
  }

  get endTime(): Date | undefined {
    return this._endTime;
  }

  get error(): Error | undefined {
    return this._error;
  }

  get result(): any {
    return this._result;
  }

  get duration(): number | undefined {
    if (!this._endTime) {
      return undefined;
    }
    return this._endTime.getTime() - this._startTime.getTime();
  }

  // ============================================================================
  // Status Management
  // ============================================================================

  /**
   * Mark workflow as running.
   */
  markRunning(): void {
    this._status = 'running';
  }

  /**
   * Mark workflow as completed with result.
   */
  markCompleted(result: any): void {
    this._status = 'completed';
    this._result = result;
    this._endTime = new Date();
  }

  /**
   * Mark workflow as failed with error.
   */
  markFailed(error: Error): void {
    this._status = 'failed';
    this._error = error;
    this._endTime = new Date();
  }

  /**
   * Mark workflow as canceled (status `'cancelled'`).
   */
  markCancelled(): void {
    this._status = 'cancelled';
    this._endTime = new Date();
  }

  /**
   * Mark workflow as timed out.
   */
  markTimedOut(): void {
    this._status = 'timed_out';
    this._endTime = new Date();
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Set a state value.
   */
  setState(key: string, value: any): void {
    this._state.set(key, value);
  }

  /**
   * Get a state value.
   */
  getState(key: string): any {
    return this._state.get(key);
  }

  /**
   * Check if state key exists.
   */
  hasState(key: string): boolean {
    return this._state.has(key);
  }

  /**
   * Delete a state value.
   */
  deleteState(key: string): void {
    this._state.delete(key);
  }

  /**
   * Clear all state.
   */
  clearState(): void {
    this._state.clear();
  }

  /**
   * Store a copy of the current state, labeled with what triggered the snapshot.
   */
  captureSnapshot(trigger: string): void {
    const snapshot: StateSnapshot = {
      workflowId: this._workflowId,
      timestamp: new Date(),
      state: new Map(this._state),
      trigger,
      sequence: this._snapshots.length,
    };
    this._snapshots.push(snapshot);
  }

  // ============================================================================
  // Task Execution Tracking
  // ============================================================================

  /**
   * Record task execution start.
   */
  recordTaskStart(taskName: string, input: any, attempt: number = 1): void {
    const execution: TaskExecution = {
      taskName,
      input,
      status: 'running',
      startTime: new Date(),
      attempt,
    };
    this._tasksExecuted.push(execution);
  }

  /**
   * Record task execution completion on the most recent execution of that task.
   */
  recordTaskComplete(taskName: string, output: any): void {
    const execution = this._findLastTaskExecution(taskName);
    if (execution) {
      execution.status = 'completed';
      execution.output = output;
      execution.endTime = new Date();
    }
  }

  /**
   * Record task execution failure on the most recent execution of that task.
   */
  recordTaskFailure(taskName: string, error: Error): void {
    const execution = this._findLastTaskExecution(taskName);
    if (execution) {
      execution.status = 'failed';
      execution.error = error;
      execution.endTime = new Date();
    }
  }

  /**
   * Get task execution count.
   */
  getTaskExecutionCount(taskName: string): number {
    return this._tasksExecuted.filter((t) => t.taskName === taskName).length;
  }

  /**
   * Get all executions for a task.
   */
  getTaskExecutions(taskName: string): TaskExecution[] {
    return this._tasksExecuted.filter((t) => t.taskName === taskName);
  }

  /**
   * Find last task execution by name.
   */
  private _findLastTaskExecution(taskName: string): TaskExecution | undefined {
    for (let i = this._tasksExecuted.length - 1; i >= 0; i--) {
      if (this._tasksExecuted[i]!.taskName === taskName) {
        return this._tasksExecuted[i];
      }
    }
    return undefined;
  }

  // ============================================================================
  // Event Tracking
  // ============================================================================

  /**
   * Record workflow event. An ID is generated when none is given.
   */
  recordEvent(name: string, data: any, id?: string): void {
    const event: WorkflowEvent = {
      name,
      data,
      timestamp: new Date(),
      id: id ?? this._generateEventId(),
    };
    this._eventsReceived.push(event);
  }

  /**
   * Get events by name.
   */
  getEvents(name: string): WorkflowEvent[] {
    return this._eventsReceived.filter((e) => e.name === name);
  }

  /**
   * Get event count.
   */
  getEventCount(name?: string): number {
    if (name) {
      return this._eventsReceived.filter((e) => e.name === name).length;
    }
    return this._eventsReceived.length;
  }

  private _generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // Query Tracking
  // ============================================================================

  /**
   * Record workflow query.
   */
  recordQuery(name: string, result: any, args?: any): void {
    const query: WorkflowQuery = {
      name,
      args,
      result,
      timestamp: new Date(),
    };
    this._queriesHandled.push(query);
  }

  /**
   * Get queries by name.
   */
  getQueries(name: string): WorkflowQuery[] {
    return this._queriesHandled.filter((q) => q.name === name);
  }

  /**
   * Get query count.
   */
  getQueryCount(name?: string): number {
    if (name) {
      return this._queriesHandled.filter((q) => q.name === name).length;
    }
    return this._queriesHandled.length;
  }

  // ============================================================================
  // Child Workflow Tracking
  // ============================================================================

  /**
   * Record child workflow spawned.
   */
  recordChildWorkflow(workflowId: string, workflowType: string, input: any): void {
    const child: ChildWorkflowExecution = {
      workflowId,
      workflowType,
      input,
      status: 'running',
      parentWorkflowId: this._workflowId,
    };
    this._childWorkflows.push(child);
  }

  /**
   * Update child workflow status.
   */
  updateChildWorkflow(workflowId: string, status: ExecutionStatus, result?: any): void {
    const child = this._childWorkflows.find((c) => c.workflowId === workflowId);
    if (child) {
      child.status = status;
      if (result !== undefined) {
        child.result = result;
      }
    }
  }

  /**
   * Get child workflow count.
   */
  getChildWorkflowCount(): number {
    return this._childWorkflows.length;
  }

  // ============================================================================
  // Timer Tracking
  // ============================================================================

  /**
   * Record timer creation.
   */
  recordTimer(id: string, duration: number, fireAt: Date): void {
    const timer: TimerExecution = {
      id,
      duration,
      createdAt: new Date(),
      fireAt,
      fired: false,
      cancelled: false,
    };
    this._timers.push(timer);
  }

  /**
   * Mark timer as fired.
   */
  markTimerFired(id: string): void {
    const timer = this._timers.find((t) => t.id === id);
    if (timer) {
      timer.fired = true;
    }
  }

  /**
   * Mark timer as canceled.
   */
  markTimerCancelled(id: string): void {
    const timer = this._timers.find((t) => t.id === id);
    if (timer) {
      timer.cancelled = true;
    }
  }

  /**
   * Get timers that have neither fired nor been canceled.
   */
  getPendingTimers(): TimerExecution[] {
    return this._timers.filter((t) => !t.fired && !t.cancelled);
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /**
   * Return the trace as a plain object matching the `ExecutionTrace` interface.
   *
   * `state` is the trace's own Map, not a copy, and `JSON.stringify` renders a Map as `{}`.
   * Snapshots are not included.
   */
  toJSON(): IExecutionTrace {
    return {
      workflowId: this._workflowId,
      workflowType: this._workflowType,
      status: this._status,
      state: this._state,
      tasksExecuted: [...this._tasksExecuted],
      eventsReceived: [...this._eventsReceived],
      queriesHandled: [...this._queriesHandled],
      childWorkflows: [...this._childWorkflows],
      timers: [...this._timers],
      startTime: this._startTime,
      endTime: this._endTime,
      error: this._error,
      result: this._result,
    };
  }

  /**
   * Get human-readable summary.
   */
  getSummary(): string {
    const lines: string[] = [
      `Workflow: ${this._workflowType} (${this._workflowId})`,
      `Status: ${this._status}`,
      `Duration: ${this.duration ? `${this.duration}ms` : 'N/A'}`,
      `Tasks: ${this._tasksExecuted.length}`,
      `Events: ${this._eventsReceived.length}`,
      `Queries: ${this._queriesHandled.length}`,
      `Child Workflows: ${this._childWorkflows.length}`,
      `Timers: ${this._timers.length}`,
    ];

    if (this._error) {
      lines.push(`Error: ${this._error.message}`);
    }

    if (this._result !== undefined) {
      lines.push(`Result: ${JSON.stringify(this._result)}`);
    }

    return lines.join('\n');
  }

  /**
   * Return the trace to `pending` and clear everything it recorded. The start time is kept.
   */
  reset(): void {
    this._status = 'pending';
    this._tasksExecuted.length = 0;
    this._eventsReceived.length = 0;
    this._queriesHandled.length = 0;
    this._childWorkflows.length = 0;
    this._timers.length = 0;
    this._snapshots.length = 0;
    this._state.clear();
    this._endTime = undefined;
    this._error = undefined;
    this._result = undefined;
  }
}

/**
 * Create a new execution trace.
 *
 * @param workflowId - Unique workflow execution ID
 * @param workflowType - Workflow type/name
 * @returns New execution trace instance
 *
 * @example
 * ```typescript
 * const trace = createExecutionTrace('wf-123', 'orderWorkflow');
 * trace.markRunning();
 * trace.recordTaskStart('chargeCard', { amount: 99.99 });
 * ```
 */
export function createExecutionTrace(workflowId: string, workflowType: string): ExecutionTrace {
  return new ExecutionTrace(workflowId, workflowType);
}
