/**
 * Mock Orcher client for tests that start workflows without a server.
 *
 * @module @orcher/sdk/testing/mocks/client
 */

import type { WorkflowFunction } from '../../workflow/types';
import { MockWorkflowHandle } from './handle';

/**
 * Options for starting a workflow on `MockOrcherClient`.
 */
export interface StartWorkflowOptions<T = any> {
  /**
   * Workflow ID (generated if not provided).
   */
  workflowId?: string;

  /**
   * Task queue.
   */
  taskQueue?: string;

  /**
   * Workflow input.
   */
  input?: T;

  /**
   * Workflow timeout in milliseconds.
   */
  timeout?: number;

  /**
   * Additional metadata.
   */
  metadata?: Record<string, string>;
}

/**
 * Mock Orcher client for testing code that starts workflows.
 *
 * The mock never runs the workflow function. Starting a workflow records the start and returns
 * a `MockWorkflowHandle`, which the test completes or fails, or which settles on its own from a
 * result or error configured with `mockWorkflowResult()` or `mockWorkflowError()`.
 *
 * @example Basic usage
 * ```typescript
 * const client = new MockOrcherClient();
 *
 * // Start a workflow
 * const handle = await client.startWorkflow(orderWorkflow, {
 *   workflowId: 'order-123',
 *   input: { orderId: '123', amount: 99.99 }
 * });
 *
 * // Simulate completion
 * handle.completeWith({ status: 'completed' });
 *
 * // Get result
 * const result = await handle.result();
 * ```
 *
 * @example With events
 * ```typescript
 * const client = new MockOrcherClient();
 * const handle = await client.startWorkflow(orderWorkflow, {
 *   workflowId: 'order-123',
 *   input: orderData
 * });
 *
 * // Send event
 * await handle.sendEvent('orderApproved', { approvedBy: 'manager' });
 *
 * // Verify
 * client.verifyWorkflowStarted('order-123');
 * ```
 *
 * @example Mocking workflow results
 * ```typescript
 * const client = new MockOrcherClient();
 *
 * // Pre-configure result
 * client.mockWorkflowResult(orderWorkflow, { status: 'completed' });
 *
 * // Start workflow - will automatically complete
 * const handle = await client.startWorkflow(orderWorkflow, { input: orderData });
 * const result = await handle.result();
 * console.log(result.status); // 'completed'
 * ```
 */
export class MockOrcherClient {
  private readonly handles: Map<string, MockWorkflowHandle> = new Map();
  private readonly workflowsStarted: Array<{
    workflowId: string;
    workflowType: string;
    options: StartWorkflowOptions;
    timestamp: Date;
  }> = [];
  private readonly mockedResults: Map<string, any> = new Map();
  private readonly mockedErrors: Map<string, Error> = new Map();
  private workflowIdCounter: number = 0;
  private connected: boolean = false;
  private readonly serverUrl: string = 'mock://localhost:50051';
  private readonly namespace: string = 'test';

  /**
   * Create a new mock Orcher client. It starts out connected.
   *
   * @param options - Client options; `serverUrl` and `namespace` only appear in `getSummary()`
   *
   * @example
   * ```typescript
   * const client = new MockOrcherClient({
   *   serverUrl: 'mock://localhost:50051',
   *   namespace: 'test'
   * });
   * ```
   */
  constructor(
    options: {
      serverUrl?: string;
      namespace?: string;
    } = {}
  ) {
    if (options.serverUrl) {
      (this as any).serverUrl = options.serverUrl;
    }
    if (options.namespace) {
      (this as any).namespace = options.namespace;
    }
    this.connected = true;
  }

  /**
   * Mark the client connected. Always succeeds.
   *
   * @returns Promise that resolves when connected
   *
   * @example
   * ```typescript
   * await client.connect();
   * ```
   */
  async connect(): Promise<void> {
    this.connected = true;
  }

  /**
   * Mark the client disconnected, so `startWorkflow` throws until `connect()` is called.
   *
   * @example
   * ```typescript
   * await client.disconnect();
   * ```
   */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /**
   * Check if client is connected.
   *
   * @returns True if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Start a workflow.
   *
   * Records the start and returns a mock handle. The workflow type is the function's name. If a
   * result or error is mocked for that type, the handle settles with it on the next macrotask,
   * after this method has returned.
   *
   * @param workflow - Workflow function
   * @param options - Start options
   * @returns Promise that resolves with workflow handle
   * @throws {Error} If the client is disconnected
   *
   * @example
   * ```typescript
   * const handle = await client.startWorkflow(orderWorkflow, {
   *   workflowId: 'order-123',
   *   input: { orderId: '123', amount: 99.99 },
   *   taskQueue: 'orders'
   * });
   * ```
   */
  async startWorkflow<TInput, TResult>(
    workflow: WorkflowFunction<[any, TInput], TResult>,
    options: StartWorkflowOptions<TInput> = {}
  ): Promise<MockWorkflowHandle<TResult>> {
    if (!this.connected) {
      throw new Error('Client is not connected. Call connect() first.');
    }

    const workflowId = options.workflowId ?? this.generateWorkflowId();
    const workflowType = workflow.name || 'anonymous';

    this.workflowsStarted.push({
      workflowId,
      workflowType,
      options,
      timestamp: new Date(),
    });

    const handle = new MockWorkflowHandle<TResult>(workflowId, workflowType);
    this.handles.set(workflowId, handle);

    // A mocked result or error settles the handle asynchronously, so the caller
    // holds the handle before it settles.
    const mockedResult = this.mockedResults.get(workflowType);
    if (mockedResult !== undefined) {
      setTimeout(() => handle.completeWith(mockedResult), 0);
    }

    const mockedError = this.mockedErrors.get(workflowType);
    if (mockedError !== undefined) {
      setTimeout(() => handle.failWith(mockedError), 0);
    }

    return handle;
  }

  /**
   * Get a workflow handle by ID.
   *
   * @param workflowId - Workflow ID
   * @returns Workflow handle or undefined
   *
   * @example
   * ```typescript
   * const handle = client.getWorkflowHandle('order-123');
   * if (handle) {
   *   const result = await handle.result();
   * }
   * ```
   */
  getWorkflowHandle<R = any>(workflowId: string): MockWorkflowHandle<R> | undefined {
    return this.handles.get(workflowId) as MockWorkflowHandle<R> | undefined;
  }

  /**
   * Start a workflow and wait for its result.
   *
   * Without a mocked result or error for the workflow type, the returned promise settles only
   * when the test completes or fails the handle.
   *
   * @param workflow - Workflow function
   * @param options - Start options
   * @returns Promise that resolves with workflow result
   *
   * @example
   * ```typescript
   * // Pre-configure result
   * client.mockWorkflowResult(orderWorkflow, { status: 'completed' });
   *
   * // Execute and get result
   * const result = await client.executeWorkflow(orderWorkflow, {
   *   input: { orderId: '123', amount: 99.99 }
   * });
   * console.log(result.status); // 'completed'
   * ```
   */
  async executeWorkflow<TInput, TResult>(
    workflow: WorkflowFunction<[any, TInput], TResult>,
    options: StartWorkflowOptions<TInput> = {}
  ): Promise<TResult> {
    const handle = await this.startWorkflow(workflow, options);
    return handle.result();
  }

  // ============================================================================
  // Mock Control Methods
  // ============================================================================

  /**
   * Mock a workflow result.
   *
   * Every workflow of this type started afterwards completes with the result. A result of
   * `undefined` is treated as no mock.
   *
   * @param workflow - Workflow function or type name
   * @param result - Result to return
   *
   * @example
   * ```typescript
   * client.mockWorkflowResult(orderWorkflow, { status: 'completed' });
   *
   * const handle = await client.startWorkflow(orderWorkflow, { input: orderData });
   * const result = await handle.result();
   * console.log(result.status); // 'completed'
   * ```
   */
  mockWorkflowResult<T>(workflow: WorkflowFunction<any, T> | string, result: T): void {
    const workflowType = typeof workflow === 'string' ? workflow : workflow.name;
    this.mockedResults.set(workflowType, result);
  }

  /**
   * Mock a workflow error.
   *
   * Every workflow of this type started afterwards fails with the error.
   *
   * @param workflow - Workflow function or type name
   * @param error - Error to throw
   *
   * @example
   * ```typescript
   * client.mockWorkflowError(orderWorkflow, new Error('Payment failed'));
   *
   * const handle = await client.startWorkflow(orderWorkflow, { input: orderData });
   * await expect(handle.result()).rejects.toThrow('Payment failed');
   * ```
   */
  mockWorkflowError(workflow: WorkflowFunction<any, any> | string, error: Error | string): void {
    const workflowType = typeof workflow === 'string' ? workflow : workflow.name;
    const err = typeof error === 'string' ? new Error(error) : error;
    this.mockedErrors.set(workflowType, err);
  }

  /**
   * Clear all mocked results and errors.
   *
   * @example
   * ```typescript
   * client.clearMocks();
   * ```
   */
  clearMocks(): void {
    this.mockedResults.clear();
    this.mockedErrors.clear();
  }

  // ============================================================================
  // Verification Methods
  // ============================================================================

  /**
   * Get count of workflows started.
   *
   * @param workflowType - Optional workflow type to filter
   * @returns Number of workflows started
   *
   * @example
   * ```typescript
   * await client.startWorkflow(orderWorkflow, { input: orderData });
   * console.log(client.getWorkflowStartCount()); // 1
   * console.log(client.getWorkflowStartCount('orderWorkflow')); // 1
   * ```
   */
  getWorkflowStartCount(workflowType?: string): number {
    if (workflowType) {
      return this.workflowsStarted.filter((w) => w.workflowType === workflowType).length;
    }
    return this.workflowsStarted.length;
  }

  /**
   * Get all workflows started.
   *
   * @returns Array of workflow start records
   *
   * @example
   * ```typescript
   * const workflows = client.getWorkflowsStarted();
   * workflows.forEach(w => {
   *   console.log(`Started: ${w.workflowType} (${w.workflowId})`);
   * });
   * ```
   */
  getWorkflowsStarted(): Array<{
    workflowId: string;
    workflowType: string;
    options: StartWorkflowOptions;
    timestamp: Date;
  }> {
    return [...this.workflowsStarted];
  }

  /**
   * Get workflows started of specific type.
   *
   * @param workflowType - Workflow type name
   * @returns Array of matching workflow records
   *
   * @example
   * ```typescript
   * const orderWorkflows = client.getWorkflowsStartedByType('orderWorkflow');
   * console.log(`Started ${orderWorkflows.length} order workflows`);
   * ```
   */
  getWorkflowsStartedByType(workflowType: string): Array<{
    workflowId: string;
    workflowType: string;
    options: StartWorkflowOptions;
    timestamp: Date;
  }> {
    return this.workflowsStarted.filter((w) => w.workflowType === workflowType);
  }

  /**
   * Verify that a workflow was started.
   *
   * @param workflowId - Workflow ID
   * @throws {Error} If workflow was not started
   *
   * @example
   * ```typescript
   * await client.startWorkflow(orderWorkflow, {
   *   workflowId: 'order-123',
   *   input: orderData
   * });
   *
   * client.verifyWorkflowStarted('order-123');
   * ```
   */
  verifyWorkflowStarted(workflowId: string): void {
    const workflow = this.workflowsStarted.find((w) => w.workflowId === workflowId);
    if (!workflow) {
      throw new Error(`Expected workflow '${workflowId}' to be started, but it was not.`);
    }
  }

  /**
   * Verify that a workflow type was started.
   *
   * @param workflowType - Workflow type name
   * @param expectedCount - Optional expected count
   * @throws {Error} If verification fails
   *
   * @example
   * ```typescript
   * client.verifyWorkflowTypeStarted('orderWorkflow');
   * client.verifyWorkflowTypeStarted('orderWorkflow', 3);
   * ```
   */
  verifyWorkflowTypeStarted(workflowType: string, expectedCount?: number): void {
    const count = this.getWorkflowStartCount(workflowType);

    if (expectedCount === undefined) {
      if (count === 0) {
        throw new Error(`Expected workflow type '${workflowType}' to be started, but it was not.`);
      }
    } else {
      if (count !== expectedCount) {
        throw new Error(
          `Expected workflow type '${workflowType}' to be started ${expectedCount} time${
            expectedCount === 1 ? '' : 's'
          }, but was started ${count} time${count === 1 ? '' : 's'}.`
        );
      }
    }
  }

  /**
   * Clear all recorded workflow starts and handles. Mocked results and errors are kept.
   *
   * @example
   * ```typescript
   * client.clear();
   * ```
   */
  clear(): void {
    this.handles.clear();
    this.workflowsStarted.length = 0;
  }

  /**
   * Reset client to initial state.
   *
   * Clears all mocks, handles, and recorded starts.
   *
   * @example
   * ```typescript
   * client.reset();
   * ```
   */
  reset(): void {
    this.clear();
    this.clearMocks();
    this.workflowIdCounter = 0;
  }

  /**
   * Get summary of client state.
   *
   * @returns Human-readable summary
   *
   * @example
   * ```typescript
   * console.log(client.getSummary());
   * ```
   */
  getSummary(): string {
    return [
      `Mock ORCHER Client`,
      `===================`,
      `Server URL: ${this.serverUrl}`,
      `Namespace: ${this.namespace}`,
      `Connected: ${this.connected}`,
      ``,
      `Workflows Started: ${this.workflowsStarted.length}`,
      `Active Handles: ${this.handles.size}`,
      `Mocked Results: ${this.mockedResults.size}`,
      `Mocked Errors: ${this.mockedErrors.size}`,
    ].join('\n');
  }

  /**
   * Generate a workflow ID of the form `mock-wf-<counter>-<wall-clock ms>`.
   */
  private generateWorkflowId(): string {
    this.workflowIdCounter++;
    return `mock-wf-${this.workflowIdCounter}-${Date.now()}`;
  }
}

/**
 * Create a new mock Orcher client.
 *
 * @param options - Client options
 * @returns New mock client instance
 *
 * @example
 * ```typescript
 * const client = createMockOrcherClient({
 *   serverUrl: 'mock://localhost:50051',
 *   namespace: 'test'
 * });
 * ```
 */
export function createMockOrcherClient(
  options: {
    serverUrl?: string;
    namespace?: string;
  } = {}
): MockOrcherClient {
  return new MockOrcherClient(options);
}
