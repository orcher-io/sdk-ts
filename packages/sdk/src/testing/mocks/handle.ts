/**
 * Mock workflow handle for tests that work with handles without a server.
 *
 * @module @orcher/sdk/testing/mocks/handle
 */

import type { ExecutionStatus } from '../types';

/**
 * Mock workflow handle for testing.
 *
 * Stands in for a workflow handle. It records the events sent and queries made so tests can
 * check them, answers queries from responses registered with `mockQuery()`, and settles its
 * result only when the test calls `completeWith()`, `failWith()` or `cancel()`. It starts in
 * status `running`.
 *
 * @example Basic usage
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 *
 * // Simulate workflow completion
 * handle.completeWith({ orderId: '123', status: 'completed' });
 *
 * // Get result
 * const result = await handle.result();
 * console.log(result.status); // 'completed'
 * ```
 *
 * @example With events
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 *
 * // Send events
 * await handle.sendEvent('orderApproved', { approvedBy: 'manager' });
 *
 * // Verify events
 * const events = handle.getEventsSent();
 * expect(events).toHaveLength(1);
 * expect(events[0].name).toBe('orderApproved');
 * ```
 *
 * @example With queries
 * ```typescript
 * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
 *
 * // Mock query response
 * handle.mockQuery('getStatus', { status: 'processing', progress: 50 });
 *
 * // Execute query
 * const status = await handle.query('getStatus');
 * console.log(status.progress); // 50
 * ```
 *
 * @typeParam R - The type of the workflow result
 */
export class MockWorkflowHandle<R = any> {
  private readonly _workflowId: string;
  private readonly _workflowType: string;
  private _status: ExecutionStatus = 'running';
  private readonly _eventsSent: Array<{ name: string; data: any; timestamp: Date }> = [];
  private readonly _queriesMade: Array<{ name: string; args?: any; timestamp: Date }> = [];
  private readonly _queryResponses: Map<string, any> = new Map();
  private _cancelled: boolean = false;
  private readonly _resultPromise: Promise<R>;
  private _resolveResult!: (value: R) => void;
  private _rejectResult!: (error: Error) => void;

  /**
   * Create a new mock workflow handle.
   *
   * @param workflowId - Workflow ID
   * @param workflowType - Workflow type name
   *
   * @example
   * ```typescript
   * const handle = new MockWorkflowHandle('wf-123', 'orderWorkflow');
   * ```
   */
  constructor(workflowId: string, workflowType: string = 'unknown') {
    this._workflowId = workflowId;
    this._workflowType = workflowType;

    // Settled by completeWith, failWith or cancel.
    this._resultPromise = new Promise<R>((resolve, reject) => {
      this._resolveResult = resolve;
      this._rejectResult = reject;
    });
  }

  /**
   * Get workflow ID.
   *
   * @returns Workflow ID
   *
   * @example
   * ```typescript
   * console.log(handle.workflowId); // 'wf-123'
   * ```
   */
  get workflowId(): string {
    return this._workflowId;
  }

  /**
   * Get workflow type.
   *
   * @returns Workflow type
   */
  get workflowType(): string {
    return this._workflowType;
  }

  /**
   * Get workflow status.
   *
   * @returns Current status
   *
   * @example
   * ```typescript
   * console.log(handle.status); // 'running'
   * ```
   */
  get status(): ExecutionStatus {
    return this._status;
  }

  /**
   * Check if workflow is completed.
   *
   * @returns True if completed
   */
  get isCompleted(): boolean {
    return this._status === 'completed';
  }

  /**
   * Check if workflow is failed.
   *
   * @returns True if failed
   */
  get isFailed(): boolean {
    return this._status === 'failed';
  }

  /**
   * Check if workflow is canceled.
   *
   * @returns True if `cancel()` was called or the status is `'cancelled'`
   */
  get isCancelled(): boolean {
    return this._status === 'cancelled' || this._cancelled;
  }

  /**
   * Get workflow result.
   *
   * Waits for workflow to complete if still running.
   *
   * @returns Promise that resolves with workflow result
   *
   * @throws {Error} If workflow fails or is canceled
   *
   * @example
   * ```typescript
   * handle.completeWith({ status: 'success' });
   * const result = await handle.result();
   * console.log(result.status); // 'success'
   * ```
   */
  async result(): Promise<R> {
    return this._resultPromise;
  }

  /**
   * Send an event to the workflow.
   *
   * Records the event for verification in tests.
   *
   * @throws {Error} If the workflow is completed, failed or canceled
   *
   * @param name - Event name
   * @param data - Event data
   *
   * @example
   * ```typescript
   * await handle.sendEvent('orderApproved', { approvedBy: 'manager' });
   * ```
   */
  async sendEvent(name: string, data: any): Promise<void> {
    if (this._status === 'completed' || this._status === 'failed' || this._status === 'cancelled') {
      throw new Error(
        `Cannot send event to workflow ${this._workflowId} - workflow is ${this._status}`
      );
    }

    this._eventsSent.push({
      name,
      data,
      timestamp: new Date(),
    });
  }

  /**
   * Query the workflow.
   *
   * Records the query, then returns the response registered with `mockQuery()`. A function
   * response is called with `args`.
   *
   * @param name - Query name
   * @param args - Query arguments
   * @returns Promise that resolves with query result
   *
   * @throws {Error} If no mock response registered
   *
   * @example
   * ```typescript
   * handle.mockQuery('getStatus', { status: 'processing' });
   * const status = await handle.query('getStatus');
   * ```
   */
  async query<Q = any>(name: string, args?: any): Promise<Q> {
    this._queriesMade.push({
      name,
      args,
      timestamp: new Date(),
    });

    if (!this._queryResponses.has(name)) {
      throw new Error(
        `No mock response registered for query '${name}'. ` +
          `Use handle.mockQuery('${name}', response) to register a mock.`
      );
    }

    const response = this._queryResponses.get(name);

    if (typeof response === 'function') {
      return response(args);
    }

    return response as Q;
  }

  /**
   * Cancel the workflow.
   *
   * Sets the status to `'cancelled'` and rejects the result promise.
   *
   * @throws {Error} If the workflow already completed
   *
   * @example
   * ```typescript
   * await handle.cancel();
   * console.log(handle.isCancelled); // true
   * ```
   */
  async cancel(): Promise<void> {
    if (this._status === 'completed') {
      throw new Error(`Cannot cancel workflow ${this._workflowId} - already completed`);
    }

    this._status = 'cancelled';
    this._cancelled = true;
    this._rejectResult(new Error(`Workflow ${this._workflowId} was cancelled`));
  }

  // ============================================================================
  // Mock Control Methods (for tests)
  // ============================================================================

  /**
   * Complete the workflow with a result.
   *
   * Resolves `result()` with the value.
   *
   * @param result - Workflow result
   * @throws {Error} If the status is not `running` or `pending`
   *
   * @example
   * ```typescript
   * handle.completeWith({ orderId: '123', status: 'completed' });
   * const result = await handle.result();
   * ```
   */
  completeWith(result: R): void {
    if (this._status !== 'running' && this._status !== 'pending') {
      throw new Error(`Cannot complete workflow ${this._workflowId} - workflow is ${this._status}`);
    }

    this._status = 'completed';
    this._resolveResult(result);
  }

  /**
   * Fail the workflow with an error.
   *
   * Rejects `result()` with the error.
   *
   * @param error - Error or error message
   * @throws {Error} If the status is not `running` or `pending`
   *
   * @example
   * ```typescript
   * handle.failWith(new Error('Payment failed'));
   *
   * await expect(handle.result()).rejects.toThrow('Payment failed');
   * ```
   */
  failWith(error: Error | string): void {
    if (this._status !== 'running' && this._status !== 'pending') {
      throw new Error(`Cannot fail workflow ${this._workflowId} - workflow is ${this._status}`);
    }

    const err = typeof error === 'string' ? new Error(error) : error;
    this._status = 'failed';
    this._rejectResult(err);
  }

  /**
   * Register the response `query()` returns for a query name.
   *
   * @param queryName - Query name
   * @param response - Response to return (can be function for dynamic responses)
   *
   * @example Static response
   * ```typescript
   * handle.mockQuery('getStatus', { status: 'processing', progress: 50 });
   * ```
   *
   * @example Dynamic response
   * ```typescript
   * handle.mockQuery('getProgress', (args) => {
   *   return { progress: args.taskId * 10 };
   * });
   * ```
   */
  mockQuery(queryName: string, response: any | ((args?: any) => any)): void {
    this._queryResponses.set(queryName, response);
  }

  /**
   * Set the workflow status directly.
   *
   * Only the status changes; the result promise is not settled.
   *
   * @param status - New status
   *
   * @example
   * ```typescript
   * handle.setStatus('running');
   * ```
   */
  setStatus(status: ExecutionStatus): void {
    this._status = status;
  }

  // ============================================================================
  // Verification Methods (for assertions)
  // ============================================================================

  /**
   * Get all events sent to the workflow.
   *
   * @returns Array of events
   *
   * @example
   * ```typescript
   * await handle.sendEvent('approve', { by: 'manager' });
   * const events = handle.getEventsSent();
   * expect(events).toHaveLength(1);
   * expect(events[0].name).toBe('approve');
   * ```
   */
  getEventsSent(): Array<{ name: string; data: any; timestamp: Date }> {
    return [...this._eventsSent];
  }

  /**
   * Get all queries made to the workflow.
   *
   * @returns Array of queries
   *
   * @example
   * ```typescript
   * await handle.query('getStatus');
   * const queries = handle.getQueriesMade();
   * expect(queries).toHaveLength(1);
   * expect(queries[0].name).toBe('getStatus');
   * ```
   */
  getQueriesMade(): Array<{ name: string; args?: any; timestamp: Date }> {
    return [...this._queriesMade];
  }

  /**
   * Get event count.
   *
   * @param eventName - Optional event name to filter
   * @returns Number of events sent
   *
   * @example
   * ```typescript
   * await handle.sendEvent('approve', {});
   * await handle.sendEvent('approve', {});
   * console.log(handle.getEventCount('approve')); // 2
   * ```
   */
  getEventCount(eventName?: string): number {
    if (eventName) {
      return this._eventsSent.filter((e) => e.name === eventName).length;
    }
    return this._eventsSent.length;
  }

  /**
   * Get query count.
   *
   * @param queryName - Optional query name to filter
   * @returns Number of queries made
   *
   * @example
   * ```typescript
   * await handle.query('getStatus');
   * console.log(handle.getQueryCount('getStatus')); // 1
   * ```
   */
  getQueryCount(queryName?: string): number {
    if (queryName) {
      return this._queriesMade.filter((q) => q.name === queryName).length;
    }
    return this._queriesMade.length;
  }

  /**
   * Verify that an event was sent.
   *
   * @param eventName - Event name
   * @param expectedData - Optional expected data
   * @throws {Error} If event was not sent
   *
   * @example
   * ```typescript
   * handle.verifyEventSent('approve', { by: 'manager' });
   * ```
   */
  verifyEventSent(eventName: string, expectedData?: any): void {
    const events = this._eventsSent.filter((e) => e.name === eventName);

    if (events.length === 0) {
      throw new Error(`Expected event '${eventName}' to be sent, but it was not sent.`);
    }

    if (expectedData !== undefined) {
      const found = events.some((e) => this.deepEqual(e.data, expectedData));
      if (!found) {
        throw new Error(
          `Expected event '${eventName}' to be sent with data ${JSON.stringify(
            expectedData
          )}, but it was not.`
        );
      }
    }
  }

  /**
   * Verify that a query was made.
   *
   * @param queryName - Query name
   * @throws {Error} If query was not made
   *
   * @example
   * ```typescript
   * handle.verifyQueryMade('getStatus');
   * ```
   */
  verifyQueryMade(queryName: string): void {
    const queries = this._queriesMade.filter((q) => q.name === queryName);

    if (queries.length === 0) {
      throw new Error(`Expected query '${queryName}' to be made, but it was not made.`);
    }
  }

  /**
   * Clear all recorded events and queries.
   *
   * @example
   * ```typescript
   * handle.clear();
   * ```
   */
  clear(): void {
    this._eventsSent.length = 0;
    this._queriesMade.length = 0;
  }

  /**
   * Get summary of handle state.
   *
   * @returns Human-readable summary
   *
   * @example
   * ```typescript
   * console.log(handle.getSummary());
   * ```
   */
  getSummary(): string {
    return [
      `Workflow Handle: ${this._workflowType} (${this._workflowId})`,
      `Status: ${this._status}`,
      `Events Sent: ${this._eventsSent.length}`,
      `Queries Made: ${this._queriesMade.length}`,
      `Cancelled: ${this._cancelled}`,
    ].join('\n');
  }

  /**
   * Compare two values by their JSON serialization, so object key order matters.
   */
  private deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * Wait for workflow to reach specific status.
   *
   * Polls every 10 ms of real time.
   *
   * @param status - Target status
   * @param timeout - Timeout in real milliseconds (default: 5000)
   * @returns Promise that resolves when status is reached
   *
   * @throws {Error} If timeout is reached
   *
   * @example
   * ```typescript
   * setTimeout(() => handle.completeWith({ success: true }), 100);
   * await handle.waitForStatus('completed');
   * ```
   */
  async waitForStatus(status: ExecutionStatus, timeout: number = 5000): Promise<void> {
    const startTime = Date.now();

    while (this._status !== status) {
      if (Date.now() - startTime > timeout) {
        throw new Error(
          `Timeout waiting for workflow ${this._workflowId} to reach status ${status}. ` +
            `Current status: ${this._status}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/**
 * Create a new mock workflow handle.
 *
 * @param workflowId - Workflow ID
 * @param workflowType - Workflow type name
 * @returns New mock handle instance
 *
 * @example
 * ```typescript
 * const handle = createMockWorkflowHandle('wf-123', 'orderWorkflow');
 * handle.completeWith({ status: 'success' });
 * ```
 */
export function createMockWorkflowHandle<R = any>(
  workflowId: string,
  workflowType?: string
): MockWorkflowHandle<R> {
  return new MockWorkflowHandle<R>(workflowId, workflowType);
}
