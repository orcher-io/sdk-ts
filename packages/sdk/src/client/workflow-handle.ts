/**
 * The handle a client uses to observe and control one workflow execution.
 *
 * @module @orcher/sdk
 */

import { ClientError, TimeoutError } from '../core/errors';
import { hasValidNameCharacters, NAME_RULE } from '../core/names';
import {
  isWorkflowOutcomeFailure,
  wrapWorkflowError,
  wrapWorkflowResultError,
} from '../errors/from-native';
import { getNativeModule } from '../core/native';
import type { NativeWorkflowHandle, Disposable, WorkflowExecutionDescription } from '../core/types';
import { WorkflowStatus } from '../core/types';
import type { CancelOptions } from './types';
import { durationToMillis } from '../workflow/types';

/**
 * Validation and serialization for event, query, and update names and payloads.
 *
 * @internal
 */
class EventHelpers {
  /**
   * Check that a name is non-empty, at most 255 characters, and uses only the
   * allowed characters.
   *
   * @param eventName - Name to validate
   * @throws {ClientError} If the name is invalid
   */
  static validateEventName(eventName: string): void {
    if (!eventName || eventName.trim().length === 0) {
      throw new ClientError('Event name must be a non-empty string');
    }

    if (eventName.length > 255) {
      throw new ClientError('Event name must not exceed 255 characters');
    }

    if (!hasValidNameCharacters(eventName)) {
      throw new ClientError(
        `Event name must contain only ${NAME_RULE}`
      );
    }
  }

  /**
   * Serialize a payload to JSON. Strings are passed through unchanged.
   *
   * @param payload - Payload to serialize
   * @returns Serialized payload
   */
  static serialize(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }
    return JSON.stringify(payload);
  }
}

/**
 * Handle for observing and controlling one workflow execution.
 *
 * Returned by `Client.startWorkflow` and `Client.getWorkflowHandle`.
 *
 * @example
 * ```typescript
 * const handle = await client.startWorkflow({
 *   workflowId: 'order-123',
 *   workflowType: 'orderWorkflow',
 *   taskQueue: 'orders',
 *   args: [{ orderId: 123 }]
 * });
 *
 * const result = await handle.result();
 * console.log('Workflow result:', result);
 * ```
 */
export class WorkflowHandle<T = unknown> implements Disposable {
  private disposed = false;

  /**
   * @internal
   */
  constructor(
    private readonly native: NativeWorkflowHandle,
    public readonly workflowId: string,
    public readonly runId?: string
  ) {}

  /**
   * Wait for the workflow to complete and return its result.
   *
   * A workflow that ended without a result rejects with the subclass of
   * `WorkflowOutcomeError` for how it ended. All of them are `WorkflowError`s
   * and `OrcherError`s.
   *
   * @returns Promise that resolves with the workflow result
   * @throws {WorkflowFailedError} If the workflow failed; `failure` holds what the server recorded
   * @throws {WorkflowCanceledError} If the workflow was canceled
   * @throws {WorkflowTerminatedError} If the workflow was terminated
   * @throws {WorkflowTimedOutError} If the workflow exceeded its execution timeout
   * @throws {OrcherError} If the result could not be read, for example because
   *   the workflow does not exist (`WorkflowError` with code `WORKFLOW_NOT_FOUND`)
   *
   * @example
   * ```typescript
   * const result = await handle.result();
   * console.log('Result:', result);
   * ```
   */
  async result(): Promise<T> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      // The native module parses the JSON result, so it needs no further decoding.
      const result = await nativeModule.workflowHandleGetResult(this.native);
      return result as T;
    } catch (err) {
      throw await this.resultError(err);
    }
  }

  /**
   * The error for a failed wait on the result.
   *
   * The server answers a run that ended without a result with only a message,
   * so the run's status is read to say how it ended. If that read fails too,
   * the error is still a `WorkflowOutcomeError`, chosen from the message.
   */
  private async resultError(err: unknown): Promise<Error> {
    const outcome = this.runId
      ? { workflowId: this.workflowId, runId: this.runId }
      : { workflowId: this.workflowId };
    let status: string | undefined;
    if (isWorkflowOutcomeFailure(err)) {
      try {
        status = await getNativeModule().workflowHandleGetStatus(this.native);
      } catch {
        status = undefined;
      }
    }
    return wrapWorkflowResultError(err, outcome, status);
  }

  /**
   * Wait for the workflow result, giving up after a timeout.
   *
   * The timeout only bounds how long this call waits; the workflow keeps
   * running.
   *
   * @param timeoutMs - Timeout in milliseconds; must be positive
   * @returns Promise that resolves with the workflow result
   * @throws {TimeoutError} If the workflow does not complete within the timeout
   * @throws {ClientError} If `timeoutMs` is not positive
   * @throws {WorkflowOutcomeError} If the workflow ended without a result; the
   *   subclasses are those of {@link WorkflowHandle.result}
   *
   * @example
   * ```typescript
   * try {
   *   const result = await handle.resultWithTimeout(5000);
   * } catch (err) {
   *   if (err instanceof TimeoutError) {
   *     console.log('Workflow did not complete within 5 seconds');
   *   }
   * }
   * ```
   */
  async resultWithTimeout(timeoutMs: number): Promise<T> {
    this.ensureNotDisposed();

    if (timeoutMs <= 0) {
      throw new ClientError('Timeout must be a positive number');
    }

    // A timeout throws rather than resolving `null`, so it cannot be confused
    // with a workflow that legitimately produced no value. This matches the
    // other SDKs: Rust yields Err(Timeout) and Python raises TimeoutError.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new TimeoutError(`Timed out after ${timeoutMs}ms waiting for workflow result`)),
        timeoutMs
      );
    });

    try {
      return await Promise.race([this.result(), timeoutPromise]);
    } catch (err) {
      // Rethrow the TimeoutError as is: rewrapping it would break
      // `instanceof TimeoutError` for the caller.
      if (err instanceof TimeoutError) {
        throw err;
      }
      throw wrapWorkflowError(err, 'Failed to get workflow result', this.workflowId);
    } finally {
      // Clear the timer so it does not keep the event loop alive after the
      // result has arrived.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Get the current status of the workflow.
   *
   * A status string the SDK does not recognize maps to `WorkflowStatus.Unknown`.
   *
   * @returns Promise that resolves with the workflow status
   * @throws {OrcherError} If the status check fails
   *
   * @example
   * ```typescript
   * const status = await handle.status();
   * if (status === WorkflowStatus.Completed) {
   *   console.log('Workflow completed');
   * }
   * ```
   */
  async status(): Promise<WorkflowStatus> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      const statusStr = await nativeModule.workflowHandleGetStatus(this.native);

      const statusMap: Record<string, WorkflowStatus> = {
        RUNNING: WorkflowStatus.Running,
        COMPLETED: WorkflowStatus.Completed,
        FAILED: WorkflowStatus.Failed,
        CANCELLED: WorkflowStatus.Cancelled,
        TERMINATED: WorkflowStatus.Terminated,
        TIMED_OUT: WorkflowStatus.TimedOut,
      };

      return statusMap[statusStr] ?? WorkflowStatus.Unknown;
    } catch (err) {
      throw wrapWorkflowError(err, 'Failed to get workflow status', this.workflowId);
    }
  }

  /**
   * Describe this workflow execution.
   *
   * Returns metadata about the execution, including status, timing, pending
   * tasks, timers and events, and configuration.
   *
   * @returns Promise that resolves with the workflow execution description
   * @throws {OrcherError} If the describe call fails
   *
   * @example
   * ```typescript
   * const description = await handle.describe();
   * console.log('Status:', description.status);
   * console.log('Pending tasks:', description.pendingTasks);
   * ```
   */
  async describe(): Promise<WorkflowExecutionDescription> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      return await nativeModule.workflowHandleDescribe(this.native);
    } catch (err) {
      throw wrapWorkflowError(err, `Failed to describe workflow ${this.workflowId}`, this.workflowId);
    }
  }

  /**
   * Request cancellation of the workflow.
   *
   * The workflow may handle cancellation gracefully or ignore it. Use
   * {@link WorkflowHandle.terminate} to stop it unconditionally.
   *
   * @param options - `cleanupTimeout` limits how long the workflow may spend
   *   cleaning up before the engine terminates it (a {@link Duration} or
   *   milliseconds). Engines from before cancellation cleanup ignore it and
   *   cancel at once.
   * @throws {ClientError} If `cleanupTimeout` is negative or not a finite number
   * @throws {OrcherError} If the cancellation request fails
   *
   * @example
   * ```typescript
   * await handle.cancel();
   * await handle.cancel({ cleanupTimeout: Duration.fromSeconds(30) });
   * ```
   */
  async cancel(options: CancelOptions = {}): Promise<void> {
    this.ensureNotDisposed();

    const cleanupTimeout =
      options.cleanupTimeout === undefined ? undefined : durationToMillis(options.cleanupTimeout);
    if (cleanupTimeout !== undefined && !(Number.isFinite(cleanupTimeout) && cleanupTimeout >= 0)) {
      throw new ClientError(
        `cleanupTimeout must be a non-negative number of milliseconds, got ${cleanupTimeout}`
      );
    }

    try {
      const nativeModule = getNativeModule();
      await nativeModule.workflowHandleCancel(
        this.native,
        cleanupTimeout === undefined ? undefined : { cleanupTimeout }
      );
    } catch (err) {
      throw wrapWorkflowError(err, 'Failed to cancel workflow', this.workflowId);
    }
  }

  /**
   * Terminate the workflow immediately.
   *
   * The workflow gets no chance to clean up or handle the termination.
   *
   * @param reason - Optional reason for termination
   * @throws {OrcherError} If termination fails
   *
   * @example
   * ```typescript
   * await handle.terminate('User requested termination');
   * ```
   */
  async terminate(reason?: string): Promise<void> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      await nativeModule.workflowHandleTerminate(this.native, reason);
    } catch (err) {
      throw wrapWorkflowError(err, 'Failed to terminate workflow', this.workflowId);
    }
  }

  /**
   * Reset the workflow to a specific journal point and re-execute from there.
   *
   * Creates an execution that replays the journal up to `targetEventId`,
   * then makes fresh decisions from that point. The current execution is
   * marked with terminal status "reset".
   *
   * @param targetEventId - Journal event id to reset to; events up to and including it are kept
   * @param reason - Human-readable reason for the reset
   * @returns The id of the execution the reset created
   * @throws {OrcherError} If the workflow is not found or the event id is invalid
   *
   * @example
   * ```typescript
   * const newExecutionId = await handle.reset(5, 'Bad deployment caused failures');
   * ```
   */
  async reset(targetEventId: number, reason?: string): Promise<string> {
    this.ensureNotDisposed();

    try {
      const nativeModule = getNativeModule();
      return await nativeModule.workflowHandleReset(this.native, targetEventId, reason);
    } catch (err) {
      throw wrapWorkflowError(err, 'Failed to reset workflow', this.workflowId);
    }
  }

  /**
   * Send an event to the running workflow.
   *
   * Events let external systems send asynchronous messages to a running
   * workflow. The workflow waits for them with `ctx.waitForEvent()` or
   * `ctx.waitForEventWithTimeout()`.
   *
   * @param eventName - Name of the event to send
   * @param payload - Event payload, serialized to JSON
   * @throws {ClientError} If the event name is invalid
   * @throws {OrcherError} If sending the event fails
   *
   * @example
   * ```typescript
   * await handle.sendEvent('approve', {
   *   approved: true,
   *   approver: 'manager@company.com',
   *   reason: 'Order verified',
   *   timestamp: new Date().toISOString(),
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Typed payload
   * interface ApprovalData {
   *   approved: boolean;
   *   approver: string;
   *   reason: string;
   * }
   *
   * await handle.sendEvent<ApprovalData>('approve', {
   *   approved: true,
   *   approver: 'manager@company.com',
   *   reason: 'Verified',
   * });
   * ```
   */
  async sendEvent<TPayload = unknown>(eventName: string, payload?: TPayload): Promise<void> {
    this.ensureNotDisposed();

    try {
      EventHelpers.validateEventName(eventName);

      const nativeModule = getNativeModule();
      await nativeModule.workflowHandleSendEvent(this.native, eventName, payload);
    } catch (err) {
      if (err instanceof ClientError) {
        throw err;
      }
      throw wrapWorkflowError(err, `Failed to send event '${eventName}' to workflow ${this.workflowId}`, this.workflowId);
    }
  }

  /**
   * Query the workflow state.
   *
   * A query reads the current state of a running workflow without modifying
   * it. The workflow must register a handler for it, for example with
   * `ctx.registerQueryHandler()`.
   *
   * @param queryName - Name of the query to execute
   * @param args - Optional arguments passed to the query handler
   * @param _options - Accepted for API compatibility; not used
   * @returns Promise that resolves with the query result
   * @throws {ClientError} If the query name is invalid
   * @throws {OrcherError} If the query execution fails
   *
   * @example
   * ```typescript
   * const status = await handle.query<string>('getOrderStatus');
   * console.log('Order status:', status);
   * ```
   *
   * @example
   * ```typescript
   * // Typed result
   * interface OrderData {
   *   orderId: string;
   *   status: string;
   *   total: number;
   * }
   *
   * const order = await handle.query<OrderData>('getOrderData');
   * console.log('Order:', order.orderId, order.status);
   * ```
   */
  async query<TResult = unknown>(
    queryName: string,
    args?: unknown,
    _options?: { timeout?: number }
  ): Promise<TResult> {
    this.ensureNotDisposed();

    try {
      EventHelpers.validateEventName(queryName);

      const nativeModule = getNativeModule();
      const result = await nativeModule.workflowHandleQuery(
        this.native,
        queryName,
        args
      );
      return result as TResult;
    } catch (err) {
      if (err instanceof ClientError) {
        throw err;
      }
      throw wrapWorkflowError(err, `Failed to query workflow ${this.workflowId} with query '${queryName}'`, this.workflowId);
    }
  }

  /**
   * Send an update to the workflow.
   *
   * An update is a synchronous mutation: it can read and modify workflow
   * state, and its result is journaled so replay reproduces it.
   *
   * @typeParam TResult - Expected return type of the update
   * @param updateName - Name of the update handler to invoke
   * @param args - Optional arguments to pass to the update handler
   * @param _options - Accepted for API compatibility; not used
   * @returns The update result
   * @throws {ClientError} If the update name is invalid
   * @throws {OrcherError} If the update fails or is rejected
   *
   * @example
   * ```typescript
   * const result = await handle.update<string>('approveOrder', { approved: true });
   * console.log('Update result:', result);
   * ```
   */
  async update<TResult = unknown>(
    updateName: string,
    args?: unknown,
    _options?: { timeout?: number }
  ): Promise<TResult> {
    this.ensureNotDisposed();

    try {
      EventHelpers.validateEventName(updateName);

      const nativeModule = getNativeModule();
      const result = await nativeModule.workflowHandleUpdate(
        this.native,
        updateName,
        args
      );
      return result as TResult;
    } catch (err) {
      if (err instanceof ClientError) {
        throw err;
      }
      throw wrapWorkflowError(err, `Failed to update workflow ${this.workflowId} with update '${updateName}'`, this.workflowId);
    }
  }

  /**
   * Mark the handle as disposed. After disposal, the handle cannot be used.
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      // The native handle is freed by its Rust Drop implementation.
    }
  }

  /**
   * Dispose the handle at the end of a `using` block.
   *
   * @example
   * ```typescript
   * {
   *   using handle = await client.startWorkflow(...);
   *   await handle.result();
   * } // Automatically disposed here
   * ```
   */
  [Symbol.dispose](): void {
    this.dispose();
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new ClientError('Workflow handle has been disposed');
    }
  }
}
