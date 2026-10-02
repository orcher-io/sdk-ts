/**
 * The context passed to every task function.
 *
 * It lets a task:
 * - Send heartbeats, optionally with progress details
 * - Check for cancellation
 * - Read metadata about the execution
 *
 * @packageDocumentation
 */

import { TaskError, ErrorCode } from '../errors';

/**
 * Metadata about the current task execution.
 */
export interface TaskExecution {
  /** Id of the workflow this task belongs to. */
  workflowId: string;

  /** Run id of the workflow execution. */
  runId: string;

  /** Unique task id. */
  taskId: string;

  /** Current attempt number, starting at 1. */
  attempt: number;

  /** Task type name. */
  taskType: string;

  /** Heartbeat timeout in milliseconds, if configured. */
  heartbeatTimeout?: number;
}

/**
 * The message a task sends when it heartbeats.
 */
export interface HeartbeatMessage {
  /** Id of the task sending the heartbeat. */
  taskId: string;

  /** Optional JSON-serializable progress details. */
  details?: any;

  /** Time of the heartbeat, in milliseconds since the Unix epoch. */
  timestamp: number;
}

/**
 * Signals that a task has been asked to cancel.
 *
 * Read {@link CancellationToken.isCancelled} to poll, or await
 * {@link CancellationToken.waitForCancellation} to be woken.
 */
export class CancellationToken {
  private _cancelled: boolean = false;
  private readonly waiters: Array<() => void> = [];

  /** Whether cancellation has been requested. */
  get isCancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Request cancellation and wake every waiter. Calling it again does nothing.
   *
   * @internal
   */
  cancel(): void {
    if (this._cancelled) {
      return;
    }
    this._cancelled = true;
    // Every path that cancels a task (the heartbeat response, the executor's
    // timeout) goes through this method, so waiters are woken here rather than
    // by polling the flag. Polling would notice cancellation up to an interval
    // late, letting the work win a race it should lose, and would leave an
    // interval running for every task that finishes without being canceled.
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Wait for cancellation.
   *
   * Returns a promise that resolves when cancellation is requested, or
   * immediately if it already has been. It never rejects.
   */
  async waitForCancellation(): Promise<void> {
    if (this._cancelled) {
      return;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/**
 * The context passed as the first argument to every task function.
 *
 * It provides APIs for:
 * - Sending heartbeats to report liveness and progress
 * - Checking for cancellation
 * - Reading task metadata
 *
 * ## Heartbeats
 *
 * A long-running task with a heartbeat timeout should heartbeat periodically,
 * so the engine knows it is still running:
 *
 * ```typescript
 * import { task, TaskContext } from '@orcher/sdk';
 *
 * export const processLargeFile = task({
 *   name: 'process-large-file',
 *   heartbeatTimeout: 30_000,
 *   execute: async (ctx: TaskContext, file: FileData) => {
 *     for (let i = 0; i < file.chunks.length; i++) {
 *       await processChunk(file.chunks[i]);
 *
 *       // Heartbeat every 10 chunks
 *       if (i % 10 === 0) {
 *         await ctx.heartbeat();
 *       }
 *     }
 *   },
 * });
 * ```
 *
 * ## Cancellation
 *
 * Tasks should check for cancellation and exit early:
 *
 * ```typescript
 * export const longRunningTask = task({
 *   name: 'long-running-task',
 *   execute: async (ctx: TaskContext, data: Data) => {
 *     for (let i = 0; i < 1000; i++) {
 *       if (ctx.isCancelled()) {
 *         throw new Error('Task canceled');
 *       }
 *
 *       await processItem(i);
 *     }
 *   },
 * });
 * ```
 *
 * ## Progress Reporting
 *
 * Heartbeats can carry progress details:
 *
 * ```typescript
 * export const batchProcessor = task({
 *   name: 'batch-processor',
 *   execute: async (ctx: TaskContext, items: Item[]) => {
 *     for (let i = 0; i < items.length; i++) {
 *       await processItem(items[i]);
 *
 *       await ctx.heartbeatWithDetails({
 *         current: i + 1,
 *         total: items.length,
 *         percentage: ((i + 1) / items.length) * 100,
 *       });
 *     }
 *   },
 * });
 * ```
 */
export class TaskContext {
  private readonly execution: TaskExecution;

  private readonly _cancellationToken: CancellationToken;

  /** Delivers heartbeats; set by the executor. */
  private heartbeatCallback?: (message: HeartbeatMessage) => void | Promise<void>;

  /**
   * Create a task context. The SDK creates it; tasks receive it as their first parameter.
   *
   * @param execution - Task execution metadata
   * @param cancellationToken - Cancellation token; a fresh one is created when omitted
   *
   * @internal
   */
  constructor(execution: TaskExecution, cancellationToken?: CancellationToken) {
    this.execution = execution;
    this._cancellationToken = cancellationToken || new CancellationToken();
  }

  // ============================================================================
  // Heartbeats
  // ============================================================================

  /**
   * Send a heartbeat to show the task is still running.
   *
   * When the task has a heartbeat timeout, call this more often than the
   * timeout, or the task is considered failed.
   *
   * @throws {TaskError} With code `TASK_CANCELED` if the task has been canceled
   *
   * @example
   * ```typescript
   * export const longTask = task({
   *   name: 'long-task',
   *   execute: async (ctx: TaskContext) => {
   *     for (let i = 0; i < 100; i++) {
   *       await doWork(i);
   *       await ctx.heartbeat();
   *     }
   *   },
   * });
   * ```
   */
  async heartbeat(): Promise<void> {
    return this.heartbeatWithDetails(undefined);
  }

  /**
   * Send a heartbeat with optional progress details.
   *
   * The details can be any JSON-serializable value that describes the task's
   * progress.
   *
   * @param details - Progress details; must be JSON-serializable
   * @throws {TaskError} With code `TASK_CANCELED` if the task has been canceled
   *
   * @example
   * Report progress percentage:
   * ```typescript
   * export const processFile = task({
   *   name: 'process-file',
   *   execute: async (ctx: TaskContext, file: FileData) => {
   *     const total = file.lines.length;
   *
   *     for (let i = 0; i < total; i++) {
   *       await processLine(file.lines[i]);
   *
   *       await ctx.heartbeatWithDetails({
   *         current: i + 1,
   *         total,
   *         percentage: ((i + 1) / total) * 100,
   *       });
   *     }
   *   },
   * });
   * ```
   *
   * @example
   * Report the current stage:
   * ```typescript
   * export const dataSync = task({
   *   name: 'data-sync',
   *   execute: async (ctx: TaskContext, config: SyncConfig) => {
   *     await ctx.heartbeatWithDetails({ stage: 'fetching', source: config.source });
   *     const data = await fetchData(config.source);
   *
   *     await ctx.heartbeatWithDetails({ stage: 'transforming', recordCount: data.length });
   *     const transformed = await transformData(data);
   *
   *     await ctx.heartbeatWithDetails({ stage: 'uploading', recordCount: transformed.length });
   *     await uploadData(transformed);
   *   },
   * });
   * ```
   */
  async heartbeatWithDetails(details?: any): Promise<void> {
    if (this.isCancelled()) {
      // Typed so the executor and task code can tell a cancellation apart from
      // an ordinary failure by its code instead of matching on the message.
      throw new TaskError('Task has been cancelled', ErrorCode.TASK_CANCELED);
    }

    const message: HeartbeatMessage = {
      taskId: this.execution.taskId,
      details,
      timestamp: Date.now(),
    };

    if (this.heartbeatCallback) {
      await this.heartbeatCallback(message);
    }
  }

  /**
   * Set the callback that delivers heartbeats. The executor sets it when it
   * invokes the task.
   *
   * @param callback - Heartbeat callback function
   *
   * @internal
   */
  setHeartbeatCallback(callback: (message: HeartbeatMessage) => void | Promise<void>): void {
    this.heartbeatCallback = callback;
  }

  // ============================================================================
  // Cancellation
  // ============================================================================

  /**
   * Whether the task has been asked to cancel.
   *
   * Long-running tasks should check this periodically and stop early when it
   * is true.
   *
   * @returns True if cancellation has been requested
   *
   * @example
   * ```typescript
   * export const longComputation = task({
   *   name: 'long-computation',
   *   execute: async (ctx: TaskContext) => {
   *     let result = 0;
   *
   *     for (let i = 0; i < 1000000; i++) {
   *       // Check every 1000 iterations
   *       if (i % 1000 === 0 && ctx.isCancelled()) {
   *         throw new Error('Computation canceled');
   *       }
   *
   *       result += compute(i);
   *     }
   *
   *     return result;
   *   },
   * });
   * ```
   */
  isCancelled(): boolean {
    return this._cancellationToken.isCancelled;
  }

  /**
   * Get the cancellation token.
   *
   * Use it for patterns beyond polling, such as racing work against
   * cancellation with `Promise.race()`.
   *
   * @returns Cancellation token
   *
   * @example
   * Race with cancellation:
   * ```typescript
   * export const cancellableTask = task({
   *   name: 'cancellable-task',
   *   execute: async (ctx: TaskContext) => {
   *     const work = async () => {
   *       await longRunningOperation();
   *       return 'completed';
   *     };
   *
   *     return Promise.race([
   *       work(),
   *       ctx.cancellationToken().waitForCancellation().then(() => {
   *         throw new Error('Task canceled');
   *       }),
   *     ]);
   *   },
   * });
   * ```
   */
  cancellationToken(): CancellationToken {
    return this._cancellationToken;
  }

  /**
   * Request cancellation. Used to test cancellation behavior.
   *
   * @internal
   */
  cancel(): void {
    this._cancellationToken.cancel();
  }

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get the id of the workflow this task belongs to.
   *
   * @returns Workflow id
   *
   * @example
   * ```typescript
   * console.log(`Running in workflow: ${ctx.workflowId()}`);
   * ```
   */
  workflowId(): string {
    return this.execution.workflowId;
  }

  /**
   * Get the run id of the workflow execution.
   *
   * @returns Run id
   *
   * @example
   * ```typescript
   * console.log(`Run id: ${ctx.runId()}`);
   * ```
   */
  runId(): string {
    return this.execution.runId;
  }

  /**
   * Get the unique task id.
   *
   * @returns Task id
   *
   * @example
   * ```typescript
   * console.log(`Task id: ${ctx.taskId()}`);
   * ```
   */
  taskId(): string {
    return this.execution.taskId;
  }

  /**
   * Get the current attempt number, starting at 1.
   *
   * Useful for behaving differently on retries. Retry backoff itself is
   * applied by the engine according to the task's retry policy.
   *
   * @returns Attempt number, starting at 1
   *
   * @example
   * Fall back after repeated failures:
   * ```typescript
   * export const adaptiveTask = task({
   *   name: 'adaptive-task',
   *   execute: async (ctx: TaskContext, data: Data) => {
   *     if (ctx.attempt() > 2) {
   *       return fallbackApproach(data);
   *     }
   *     return primaryApproach(data);
   *   },
   * });
   * ```
   */
  attempt(): number {
    return this.execution.attempt;
  }

  /**
   * Get the task type name.
   *
   * @returns Task type name: the task's registered name
   *
   * @example
   * ```typescript
   * console.log(`Task type: ${ctx.taskType()}`);
   * ```
   */
  taskType(): string {
    return this.execution.taskType;
  }

  /**
   * Get the heartbeat timeout.
   *
   * @returns Heartbeat timeout in milliseconds, or `undefined` if not configured
   *
   * @example
   * Heartbeat at half the timeout interval:
   * ```typescript
   * export const adaptiveTask = task({
   *   name: 'adaptive-task',
   *   execute: async (ctx: TaskContext) => {
   *     const timeout = ctx.heartbeatTimeout();
   *     if (!timeout) {
   *       return doWork();
   *     }
   *
   *     const timer = setInterval(() => void ctx.heartbeat().catch(() => {}), timeout / 2);
   *     try {
   *       await doWork();
   *     } finally {
   *       clearInterval(timer);
   *     }
   *   },
   * });
   * ```
   */
  heartbeatTimeout(): number | undefined {
    return this.execution.heartbeatTimeout;
  }

  /**
   * Whether this is a retry, meaning the attempt number is greater than 1.
   *
   * @returns True if this is a retry
   *
   * @example
   * ```typescript
   * if (ctx.isRetry()) {
   *   console.log(`Retrying task (attempt ${ctx.attempt()})`);
   * }
   * ```
   */
  isRetry(): boolean {
    return this.execution.attempt > 1;
  }

  // ============================================================================
  // Logging
  // ============================================================================

  /**
   * Get a logger that adds the task's metadata to every message.
   *
   * @returns Task logger with metadata
   *
   * @example
   * ```typescript
   * const logger = ctx.logger();
   *
   * logger.info('Task started');
   * logger.debug('Processing data');
   * logger.error('Something went wrong', err);
   * ```
   */
  logger(): TaskLogger {
    return new TaskLogger(this.execution);
  }
}

/**
 * Console logger that attaches the task's workflow id, run id, task id, type,
 * and attempt to every message.
 */
export class TaskLogger {
  constructor(private readonly execution: TaskExecution) {}

  private getContext(): Record<string, any> {
    return {
      workflowId: this.execution.workflowId,
      runId: this.execution.runId,
      taskId: this.execution.taskId,
      taskType: this.execution.taskType,
      attempt: this.execution.attempt,
    };
  }

  /** Log at info level. */
  info(message: string, ...args: any[]): void {
    console.log('[INFO]', message, this.getContext(), ...args);
  }

  /** Log at debug level. */
  debug(message: string, ...args: any[]): void {
    console.debug('[DEBUG]', message, this.getContext(), ...args);
  }

  /** Log at warning level. */
  warn(message: string, ...args: any[]): void {
    console.warn('[WARN]', message, this.getContext(), ...args);
  }

  /** Log at error level, with an optional error. */
  error(message: string, error?: Error, ...args: any[]): void {
    console.error('[ERROR]', message, this.getContext(), error, ...args);
  }
}
