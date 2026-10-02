/**
 * Runs task handlers with a task context, heartbeats, timeouts and error reporting.
 *
 * @module @orcher/sdk/worker/task-executor
 */

import type { TaskDefinition } from './types';
import { TaskContext, CancellationToken } from '../task/context';
import type { ExecutionRequest, ExecutionResult, Logger } from './types';
import { ExecutionError, ExecutionTimeoutError, describeTaskFailure } from './errors';
import type { OrcherContainer } from '../di/container';
import { globalRegistry as diGlobalRegistry } from '../di/registry';

/** True if `v` is an array of byte values (integers 0-255), the form of a serialized payload. */
function isByteArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((b) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

/**
 * Task executor configuration
 */
export interface TaskExecutorOptions {
  /**
   * Logger instance
   */
  logger: Logger;

  /**
   * DI container for resolving task handler instances
   *
   * When set, handlers registered with `@Task()` are resolved from the container, so their
   * class receives its injected dependencies.
   */
  container?: OrcherContainer;

  /**
   * Default execution timeout in milliseconds
   *
   * @default 600000 (10 minutes)
   */
  defaultTimeout?: number;

  /**
   * Enable timeout enforcement
   *
   * @default true
   */
  enableTimeout?: boolean;

  /**
   * Heartbeat interval in milliseconds
   *
   * @default 30000 (30 seconds)
   */
  heartbeatInterval?: number;

  /**
   * Enable heartbeating
   *
   * @default true
   */
  enableHeartbeat?: boolean;
}

/**
 * Task executor statistics
 */
export interface TaskExecutorStats {
  /**
   * Total number of executions
   */
  totalExecutions: number;

  /**
   * Number of successful executions
   */
  successfulExecutions: number;

  /**
   * Number of failed executions
   */
  failedExecutions: number;

  /**
   * Number of timed out executions
   */
  timedOutExecutions: number;

  /**
   * Number of cancelled executions
   */
  cancelledExecutions: number;

  /**
   * Average execution duration in milliseconds
   */
  averageDuration: number;

  /**
   * Minimum execution duration in milliseconds
   */
  minDuration: number;

  /**
   * Maximum execution duration in milliseconds
   */
  maxDuration: number;

  /**
   * Total heartbeats sent
   */
  totalHeartbeats: number;
}

/**
 * Connects a running task's heartbeats to the worker that runs it.
 *
 * The worker also heartbeats every task on its own, independent of the task's code.
 */
export interface TaskHeartbeatBinding {
  /**
   * Hand a heartbeat from the task's code, with its details, to the worker;
   * resolves whether the task has been asked to stop.
   */
  record(details?: unknown): Promise<boolean>;
  /**
   * Resolves `true` once the engine asks the task to stop, and `false` once
   * its outcome is reported.
   */
  cancelled(): Promise<boolean>;
}

/**
 * Runs task handlers with a task context, heartbeats, timeouts and error reporting.
 *
 * A handler failure never escapes `execute()`: it is returned as an unsuccessful
 * {@link ExecutionResult} with a serialized error.
 *
 * @example
 * ```typescript
 * const executor = new TaskExecutor({
 *   logger: customLogger,
 *   defaultTimeout: 600000,
 *   heartbeatInterval: 30000,
 * });
 *
 * const result = await executor.execute(taskDef, request);
 * console.log('Task result:', result);
 * ```
 */
export class TaskExecutor {
  private readonly options: Required<Omit<TaskExecutorOptions, 'container'>> &
    Pick<TaskExecutorOptions, 'container'>;
  private readonly logger: Logger;
  private readonly container: OrcherContainer | null;

  private stats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    timedOutExecutions: 0,
    cancelledExecutions: 0,
    totalDuration: 0,
    minDuration: Infinity,
    maxDuration: 0,
    totalHeartbeats: 0,
  };

  /**
   * Create a new TaskExecutor
   *
   * @param options - Executor configuration
   */
  constructor(options: TaskExecutorOptions) {
    this.options = {
      logger: options.logger,
      container: options.container,
      defaultTimeout: options.defaultTimeout ?? 600000, // 10 minutes
      enableTimeout: options.enableTimeout ?? true,
      heartbeatInterval: options.heartbeatInterval ?? 30000, // 30 seconds
      enableHeartbeat: options.enableHeartbeat ?? true,
    };
    this.logger = options.logger;
    this.container = options.container ?? null;
  }

  /**
   * Execute a task
   *
   * @param taskDef - Task definition
   * @param request - Execution request
   * @param heartbeats - Connects the task's heartbeats and cancellation to the worker
   * @returns Execution result; failures and timeouts are returned, not thrown
   *
   * @example
   * ```typescript
   * const result = await executor.execute(taskDef, {
   *   executionId: 'exec-123',
   *   type: 'sendEmail',
   *   input: { to: 'user@example.com', subject: 'Hello' },
   *   metadata: {
   *     workflowId: 'order-123',
   *     runId: 'run-456',
   *     attempt: 1,
   *     taskQueue: 'emails',
   *     namespace: 'default',
   *   },
   * });
   * ```
   */
  async execute(
    taskDef: TaskDefinition,
    request: ExecutionRequest,
    heartbeats?: TaskHeartbeatBinding
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.stats.totalExecutions++;

    this.logger.info(`Executing task: ${request.type} (${request.executionId})`);

    const cancellationToken = new CancellationToken();
    let heartbeatTimer: NodeJS.Timeout | null = null;

    try {
      const context = this.createContext(request, cancellationToken);
      if (heartbeats) {
        // The worker heartbeats the task on its own. Heartbeats from the task's code are
        // forwarded to it, and an engine request to stop cancels the token.
        context.setHeartbeatCallback(async (message) => {
          if (await heartbeats.record(message.details)) {
            cancellationToken.cancel();
          }
        });
        heartbeats
          .cancelled()
          .then((cancelled) => {
            if (cancelled) {
              cancellationToken.cancel();
            }
          })
          .catch(() => undefined);
      }

      const args = this.deserializeInput(request.input);

      if (this.options.enableHeartbeat) {
        heartbeatTimer = this.startHeartbeat(request.executionId);
      }

      const timeout = request.metadata.timeout ?? this.options.defaultTimeout;

      let result: any;
      if (this.options.enableTimeout) {
        result = await this.executeWithTimeout(taskDef, context, args, timeout, cancellationToken);
      } else {
        result = await this.executeHandler(taskDef, context, args);
      }

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      const serializedResult = this.serializeOutput(result);

      const duration = Date.now() - startTime;
      this.updateDurationStats(duration);
      this.stats.successfulExecutions++;

      this.logger.info(`Task completed: ${request.type} (${request.executionId}) in ${duration}ms`);

      return {
        executionId: request.executionId,
        success: true,
        result: serializedResult,
        duration,
      };
    } catch (error) {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      const duration = Date.now() - startTime;
      this.updateDurationStats(duration);
      this.stats.failedExecutions++;

      if (error instanceof ExecutionTimeoutError) {
        this.stats.timedOutExecutions++;
      }

      if (cancellationToken.isCancelled) {
        this.stats.cancelledExecutions++;
      }

      this.logger.error(
        `Task failed: ${request.type} (${request.executionId}) after ${duration}ms`,
        error
      );

      return {
        executionId: request.executionId,
        success: false,
        error: this.serializeError(error, request),
        duration,
      };
    }
  }

  /**
   * Get executor statistics
   */
  getStats(): TaskExecutorStats {
    const avgDuration =
      this.stats.totalExecutions > 0 ? this.stats.totalDuration / this.stats.totalExecutions : 0;

    return {
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
      timedOutExecutions: this.stats.timedOutExecutions,
      cancelledExecutions: this.stats.cancelledExecutions,
      averageDuration: avgDuration,
      minDuration: this.stats.minDuration === Infinity ? 0 : this.stats.minDuration,
      maxDuration: this.stats.maxDuration,
      totalHeartbeats: this.stats.totalHeartbeats,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      timedOutExecutions: 0,
      cancelledExecutions: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      totalHeartbeats: 0,
    };
  }

  /**
   * Create task context
   */
  private createContext(
    request: ExecutionRequest,
    cancellationToken: CancellationToken
  ): TaskContext {
    const context = new TaskContext(
      {
        taskId: request.executionId,
        taskType: request.type,
        workflowId: request.metadata.workflowId || 'unknown',
        runId: request.metadata.runId || 'unknown',
        attempt: request.metadata.attempt,
        heartbeatTimeout: (request.metadata as { heartbeatTimeoutMs?: number }).heartbeatTimeoutMs,
      },
      cancellationToken
    );

    this.logger.debug('Created task context:', {
      taskId: context.taskId(),
      taskType: context.taskType(),
      workflowId: context.workflowId(),
    });

    return context;
  }

  /**
   * Deserialize input arguments
   */
  private deserializeInput(input: any): any[] {
    if (input === null || input === undefined) {
      return [];
    }

    // The engine delivers a scheduled task's input as the UTF-8 bytes of its JSON
    // encoding (a Rust Vec<u8>, which serializes to a JSON array of numbers). Decode
    // those bytes back to the value and pass it to the handler; otherwise the handler
    // would receive the first byte of the JSON (e.g. 123 = '{') instead of the input.
    // Workflows receive an already-decoded value, so this keeps the two paths consistent.
    if (isByteArray(input)) {
      if (input.length === 0) {
        return [];
      }
      try {
        const text = new TextDecoder().decode(Uint8Array.from(input));
        return [JSON.parse(text)];
      } catch {
        // Not JSON-encoded bytes after all: treat the array as plain arguments below.
      }
    }

    if (Array.isArray(input)) {
      return input;
    }

    // A single value is passed as the handler's only argument.
    return [input];
  }

  /**
   * Execute task handler
   */
  private async executeHandler(
    taskDef: TaskDefinition,
    context: TaskContext,
    args: any[]
  ): Promise<any> {
    try {
      const taskMetadata = diGlobalRegistry.getTask(context.taskType());

      if (taskMetadata && this.container) {
        // A @Task() method runs on an instance resolved from the container, so the class
        // receives its injected dependencies.
        const { handlerClass, methodName } = taskMetadata;

        this.logger.debug(
          `Resolving task handler from DI container: ${handlerClass.name}.${methodName}`
        );

        try {
          const handlerInstance = this.container.resolve(handlerClass);

          const method = (handlerInstance as any)[methodName];
          if (typeof method !== 'function') {
            throw new Error(`Method ${methodName} not found on ${handlerClass.name}`);
          }

          const result = await method.call(handlerInstance, context, ...args);
          return result;
        } catch (error) {
          this.logger.error(
            `Failed to resolve task handler ${handlerClass.name} from DI container:`,
            error
          );
          throw error;
        }
      } else {
        // A task that is not registered with @Task() is a plain function and is called
        // directly.
        const result = await taskDef(context, ...args);
        return result;
      }
    } catch (error) {
      throw new ExecutionError(
        `Task handler threw an error: ${error instanceof Error ? error.message : String(error)}`,
        'task',
        context.taskType(),
        context.taskId(),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute task with timeout
   */
  private async executeWithTimeout(
    taskDef: TaskDefinition,
    context: TaskContext,
    args: any[],
    timeout: number,
    cancellationToken: CancellationToken
  ): Promise<any> {
    // The timer is cleared as soon as the handler settles. Left running, it would
    // hold the task's closure for the full timeout and then cancel the token of a
    // task that had already completed.
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        cancellationToken.cancel();
        reject(new ExecutionTimeoutError('task', taskDef.name, timeout));
      }, timeout);
    });
    try {
      return await Promise.race([this.executeHandler(taskDef, context, args), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Start the local heartbeat timer
   *
   * The timer only counts and logs heartbeats for the statistics. Heartbeats reach the
   * engine through the worker's {@link TaskHeartbeatBinding}.
   */
  private startHeartbeat(executionId: string): NodeJS.Timeout {
    return setInterval(() => {
      this.sendHeartbeat(executionId);
    }, this.options.heartbeatInterval);
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(executionId: string): void {
    this.stats.totalHeartbeats++;
    this.logger.debug(`Heartbeat sent for task: ${executionId}`);
  }

  /**
   * Serialize output
   *
   * Returns the value unchanged; encoding for the wire happens outside the executor.
   */
  private serializeOutput(result: any): any {
    return result;
  }

  /**
   * Serialize error
   */
  private serializeError(error: unknown, _request: ExecutionRequest): any {
    const failure = describeTaskFailure(error);
    const errorObj = {
      message: failure.message,
      type: failure.type,
      nonRetryable: failure.nonRetryable,
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error ? error.cause : undefined,
    };

    if (error instanceof ExecutionError) {
      return {
        ...errorObj,
        handlerType: error.handlerType,
        handlerName: error.handlerName,
        executionId: error.executionId,
      };
    }

    if (error instanceof ExecutionTimeoutError) {
      return {
        ...errorObj,
        executionType: error.executionType,
        handlerName: error.handlerName,
        timeout: error.timeout,
      };
    }

    return errorObj;
  }

  /**
   * Update duration statistics
   */
  private updateDurationStats(duration: number): void {
    this.stats.totalDuration += duration;
    this.stats.minDuration = Math.min(this.stats.minDuration, duration);
    this.stats.maxDuration = Math.max(this.stats.maxDuration, duration);
  }
}
