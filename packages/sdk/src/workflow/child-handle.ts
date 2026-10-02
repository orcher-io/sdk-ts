/**
 * Handle for a child workflow started from a parent workflow.
 *
 * @packageDocumentation
 */

/**
 * Handle for a child workflow started with `ctx.startChildWorkflow()`.
 *
 * Starting a child does not suspend the parent, so a parent can start several
 * children and then await their results together. Call `result()` to wait for
 * the child's outcome, `sendEvent()` to send it an event and `cancel()` to
 * cancel it.
 *
 * @example
 * Start a child, do other work, then wait for it:
 * ```typescript
 * import { workflow, Duration, WorkflowContext } from '@orcher/sdk';
 *
 * export const parentWorkflow = workflow({
 *   name: 'parent-workflow',
 *   run: async (ctx: WorkflowContext, order: Order) => {
 *     const child = await ctx.startChildWorkflow<OrderResult>('process-order', order);
 *
 *     await ctx.sleep(Duration.fromMinutes(1));
 *
 *     return child.result();
 *   },
 * });
 * ```
 *
 * @example
 * Run children in parallel:
 * ```typescript
 * const payment = await ctx.startChildWorkflow('process-payment', paymentData);
 * const inventory = await ctx.startChildWorkflow('reserve-inventory', inventoryData);
 *
 * const [paymentResult, inventoryResult] = await Promise.all([
 *   payment.result(),
 *   inventory.result(),
 * ]);
 * ```
 *
 * @typeParam T - The type of the workflow result
 */
export class ChildWorkflowHandle<T = any> {
  /** Child workflow ID */
  private readonly _workflowId: string;

  /** Child run ID */
  private readonly _runId: string;

  /** Child workflow type name */
  private readonly _workflowType: string;

  /** The parent's context: resolves the child's result from the shared cache
   * (or suspends), and issues sends and cancellations. */
  private readonly parent: ChildWorkflowParent;

  /**
   * Create a child workflow handle. The SDK calls this when a child workflow is started.
   *
   * @param workflowId - The child workflow ID
   * @param runId - The child run ID
   * @param workflowType - The child workflow type name
   * @param parent - The workflow context, which resolves the child's result
   *   from the shared replay cache (or suspends until the child completes) and
   *   issues sends and cancellations.
   *
   * @internal
   */
  constructor(
    workflowId: string,
    runId: string,
    workflowType: string,
    parent: ChildWorkflowParent
  ) {
    this._workflowId = workflowId;
    this._runId = runId;
    this._workflowType = workflowType;
    this.parent = parent;
  }

  /**
   * Get the child workflow ID.
   *
   * @returns The workflow ID
   *
   * @example
   * ```typescript
   * const child = await ctx.startChildWorkflow('process-order', orderData);
   * console.log(`Child workflow ID: ${child.id()}`);
   * ```
   */
  id(): string {
    return this._workflowId;
  }

  /**
   * Get the child workflow run ID.
   *
   * The value is derived from the child's workflow ID (`run_<workflowId>`) and is
   * informational only. It is not the run ID the engine assigns.
   *
   * @returns The run ID
   *
   * @example
   * ```typescript
   * const child = await ctx.startChildWorkflow('process-order', orderData);
   * console.log(`Child run ID: ${child.runId()}`);
   * ```
   */
  runId(): string {
    return this._runId;
  }

  /**
   * Get the child workflow type name.
   *
   * @returns The workflow type
   *
   * @example
   * ```typescript
   * const child = await ctx.startChildWorkflow('process-order', orderData);
   * console.log(`Child workflow type: ${child.workflowType()}`);
   * ```
   */
  workflowType(): string {
    return this._workflowType;
  }

  /**
   * Wait for the child workflow to complete and get its result.
   *
   * If the child has not completed yet, the parent workflow suspends here and
   * resumes once the child's outcome is in the journal. Suspension is signaled
   * by a thrown error; do not catch it.
   *
   * @returns Promise that resolves with the workflow result
   *
   * @throws {ChildWorkflowFailedError} If the child workflow failed, or ended
   *   without a result: canceled, terminated or timed out. The error's
   *   `reason` says which.
   *
   * @example
   * Wait for result:
   * ```typescript
   * const child = await ctx.startChildWorkflow<OrderResult>('process-order', orderData);
   *
   * const result = await child.result();
   * console.log(`Order processed: ${result.orderId}`);
   * ```
   *
   * @example
   * Error handling:
   * ```typescript
   * try {
   *   const result = await child.result();
   * } catch (error) {
   *   if (error instanceof ChildWorkflowFailedError) {
   *     console.error('Child workflow failed:', error.reason);
   *   } else {
   *     throw error; // rethrow everything else, including the suspension signal
   *   }
   * }
   * ```
   */
  async result(): Promise<T> {
    // The child's outcome is injected into the shared context cache under
    // `child:{id}`, the same entry executeChildWorkflow reads. Resolving from
    // there returns the result, throws ChildWorkflowFailedError for a failed
    // child, or suspends until the child completes.
    return this.parent.resolveChildWorkflowResult<T>(this._workflowType, this._workflowId);
  }

  /**
   * Send an event to the child workflow.
   *
   * The child receives it with `ctx.waitForEvent()`.
   *
   * The send is journaled as a step of this workflow: it reaches the engine
   * with the commands of the activation that makes it, and a replay does not
   * send it again.
   *
   * @param eventName - The name of the event to send
   * @param data - The event payload (must be JSON-serializable)
   *
   * @throws {Error} If the event name is invalid
   *
   * @example
   * ```typescript
   * const child = await ctx.startChildWorkflow('order-approval', orderData);
   * await child.sendEvent('approve', { approved: true, approver: 'manager@example.com' });
   * ```
   */
  async sendEvent(eventName: string, data: any): Promise<void> {
    await this.parent.sendEventToChild(this._workflowId, eventName, data);
  }

  /**
   * Request cancellation of the child workflow.
   *
   * The child is canceled the way a client cancels a workflow, and
   * {@link result} then fails with `ChildWorkflowFailedError`. Like
   * {@link sendEvent}, the request is journaled as a step and not repeated on
   * replay; canceling a child that has already finished does nothing. To
   * control what happens to a child when the parent closes, set
   * `parentClosePolicy` when starting it.
   *
   * @example
   * ```typescript
   * const child = await ctx.startChildWorkflow('long-running-task', data);
   * await ctx.sleep(Duration.fromMinutes(5));
   * await child.cancel();
   * ```
   */
  async cancel(): Promise<void> {
    await this.parent.cancelChildWorkflow(this._workflowId);
  }
}

/**
 * The parent side of a child workflow, implemented by `WorkflowContext`. A
 * `ChildWorkflowHandle` holds one: `result()` reads the same `child:{id}`
 * cache the execute path does, and sends and cancellations go out as the
 * parent's own journaled steps.
 *
 * @internal
 */
export interface ChildWorkflowParent {
  resolveChildWorkflowResult<T = any>(workflowType: string, workflowId: string): T;
  sendEventToChild(workflowId: string, eventName: string, payload: unknown): Promise<void>;
  cancelChildWorkflow(workflowId: string): Promise<void>;
}

/**
 * Error thrown by a parent workflow when a child workflow it awaits has failed.
 */
export class ChildWorkflowFailedError extends Error {
  constructor(
    public readonly workflowType: string,
    public readonly workflowId: string,
    public readonly reason: string
  ) {
    super(`Child workflow failed: ${workflowType} (${workflowId}): ${reason}`);
    this.name = 'ChildWorkflowFailedError';
    Object.setPrototypeOf(this, ChildWorkflowFailedError.prototype);
  }
}

/**
 * Error for a child workflow that was canceled.
 *
 * Not raised by the SDK yet.
 */
export class ChildWorkflowCanceledError extends Error {
  constructor(
    public readonly workflowType: string,
    public readonly workflowId: string
  ) {
    super(`Child workflow canceled: ${workflowType} (${workflowId})`);
    this.name = 'ChildWorkflowCanceledError';
    Object.setPrototypeOf(this, ChildWorkflowCanceledError.prototype);
  }
}

/**
 * Error for a child workflow that exceeded its timeout.
 *
 * Not raised by the SDK yet.
 */
export class ChildWorkflowTimedOutError extends Error {
  constructor(
    public readonly workflowType: string,
    public readonly workflowId: string,
    public readonly timeout: number
  ) {
    super(`Child workflow timed out: ${workflowType} (${workflowId}) after ${timeout}ms`);
    this.name = 'ChildWorkflowTimedOutError';
    Object.setPrototypeOf(this, ChildWorkflowTimedOutError.prototype);
  }
}
