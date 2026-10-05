/**
 * Runs one activation of a workflow handler and turns its outcome into commands for the engine.
 *
 * @module @orcher/sdk/worker/workflow-executor
 */

import type { WorkflowDefinition } from './types';
import { WorkflowContext, WorkflowCommandType } from '../workflow/context';
import type { ExecutionRequest, ExecutionResult, Logger } from './types';
import { ExecutionError, ExecutionTimeoutError } from './errors';
import { WorkflowError, ErrorCode } from '../errors';

/**
 * Workflow executor configuration
 */
export interface WorkflowExecutorOptions {
  /**
   * Logger instance
   */
  logger: Logger;

  /**
   * Default execution timeout in milliseconds
   *
   * @default 3600000 (1 hour)
   */
  defaultTimeout?: number;

  /**
   * Enable timeout enforcement
   *
   * @default true
   */
  enableTimeout?: boolean;
}

/**
 * Workflow executor statistics
 */
export interface WorkflowExecutorStats {
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
}

/**
 * Runs one activation of a workflow handler and collects the commands it produced.
 *
 * An activation ends in one of three ways: the handler returns (a `COMPLETE_WORKFLOW` command
 * is appended unless the workflow already emitted a terminal command), the handler suspends
 * (the result is successful with `suspended: true` and the pending commands), or the handler
 * fails (the result is unsuccessful with a serialized error). `execute()` never throws.
 *
 * The executor has no DI container. Workflows emit `SCHEDULE_TASK` commands and suspend; the
 * tasks run in the {@link TaskExecutor}, which resolves injected dependencies.
 *
 * @example
 * ```typescript
 * const executor = new WorkflowExecutor({
 *   logger: customLogger,
 *   defaultTimeout: 3600000,
 * });
 *
 * const result = await executor.execute(workflowDef, request);
 * console.log('Workflow result:', result);
 * ```
 */
export class WorkflowExecutor {
  private readonly options: Required<WorkflowExecutorOptions>;
  private readonly logger: Logger;

  private stats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    timedOutExecutions: 0,
    totalDuration: 0,
    minDuration: Infinity,
    maxDuration: 0,
  };

  /**
   * Create a new WorkflowExecutor
   *
   * @param options - Executor configuration
   */
  constructor(options: WorkflowExecutorOptions) {
    this.options = {
      logger: options.logger,
      defaultTimeout: options.defaultTimeout ?? 3600000, // 1 hour
      enableTimeout: options.enableTimeout ?? true,
    };
    this.logger = options.logger;

    this.logger.debug('WorkflowExecutor initialized (no DI - tasks execute via TaskExecutor)');
  }

  /**
   * Execute one activation of a workflow
   *
   * @param workflowDef - Workflow definition
   * @param request - Execution request
   * @returns Execution result with the activation's commands; failures are returned, not thrown
   *
   * @example
   * ```typescript
   * const result = await executor.execute(workflowDef, {
   *   executionId: 'exec-123',
   *   type: 'orderWorkflow',
   *   input: { orderId: '123', amount: 100 },
   *   metadata: {
   *     workflowId: 'order-123',
   *     runId: 'run-456',
   *     attempt: 1,
   *     taskQueue: 'orders',
   *     namespace: 'default',
   *   },
   * });
   * ```
   */
  async execute(
    workflowDef: WorkflowDefinition,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    this.stats.totalExecutions++;

    this.logger.info(`[WF-EXEC] Starting execution: ${request.type} (${request.executionId})`);

    // Created outside the try block so the catch can read the commands of a suspended workflow.
    this.logger.info(`[WF-EXEC] Creating context for ${request.executionId}`);
    const context = this.createContext(request);

    this.logger.info(`[WF-EXEC] Deserializing input for ${request.executionId}`);
    const args = this.deserializeInput(request.input);

    try {
      const timeout = request.metadata.timeout ?? this.options.defaultTimeout;

      this.logger.info(
        `[WF-EXEC] About to call workflow handler for ${request.executionId}, enableTimeout=${this.options.enableTimeout}`
      );
      let result: any;
      if (this.options.enableTimeout) {
        result = await this.executeWithTimeout(workflowDef, context, args, timeout);
      } else {
        result = await this.executeHandler(workflowDef, context, args);
      }

      this.logger.info(
        `[WF-EXEC] Workflow handler returned for ${request.executionId}, result type: ${typeof result}`
      );

      // Re-assert suspension. If the workflow requested suspension during this
      // activation (executeTask, waitForEvent, ...) but still returned a value, its
      // catch block swallowed the WorkflowError.suspended() signal. Honor the
      // suspension instead of completing with a wrong result: a swallowed signal
      // must never produce a wrong terminal state.
      if (context.wasSuspensionRequested()) {
        this.logger.warn(
          `[WF-EXEC] Workflow ${request.type} (${request.executionId}) returned after requesting ` +
            `suspension — a try/catch likely swallowed the suspension signal. Re-asserting ` +
            `suspension and ignoring the returned value. Re-throw isWorkflowSuspension(e) errors ` +
            `from workflow catch blocks.`
        );
        throw WorkflowError.suspended(
          're-asserted swallowed suspension',
          context.pendingSuspensionOps()
        );
      }

      // Includes the RecordStepResult commands produced by ctx.execute() calls,
      // including those of closures the workflow started and did not await.
      await context.closuresSettled();
      const stepCommands = context.takeCommands();
      const reachedSteps = context.takeReachedSteps();
      this.logger.info(
        `[WF-EXEC] Extracted ${stepCommands.length} step commands from context for ${request.executionId}`
      );

      for (const cmd of stepCommands) {
        this.logger.debug(`[WF-EXEC] Step command: type=${cmd.type}, sequence=${cmd.sequence}`);
        if (cmd.type === WorkflowCommandType.SCHEDULE_TASK) {
          const scheduleCmd = cmd as any;
          this.logger.info(
            `[WF-EXEC] ScheduleTask command: taskId=${scheduleCmd.taskId}, taskType=${scheduleCmd.taskType}, sequence=${scheduleCmd.sequence}`
          );
        }
      }

      const serializedResult = this.serializeOutput(result);

      const duration = Date.now() - startTime;
      this.updateDurationStats(duration);
      this.stats.successfulExecutions++;

      this.logger.info(
        `Workflow completed: ${request.type} (${request.executionId}) in ${duration}ms`
      );

      // A COMPLETE_WORKFLOW command, if appended below, takes the next sequence number
      // (highest existing sequence + 1, or 0 when there are no commands).
      const maxSequence =
        stepCommands.length > 0 ? Math.max(...stepCommands.map((cmd) => cmd.sequence || 0)) : -1;
      // Convert Uint8Array fields to plain arrays. JSON.stringify turns a Uint8Array into
      // {0: x, 1: y, ...}, but the Rust side needs [x, y, ...] to deserialize a Vec<u8>.
      const resultForJson = {
        data: Array.from(serializedResult.data),
        metadata: Object.fromEntries(
          Object.entries(serializedResult.metadata).map(([k, v]) => [
            k,
            Array.from(v as Uint8Array),
          ])
        ),
      };

      // Auto-complete only if the workflow did not already emit its own
      // terminal command. A workflow that calls restartFresh emits a
      // RESTART_FRESH command and then returns; adding COMPLETE_WORKFLOW
      // on top produces two terminal commands, which the bridge rejects
      // ("Cannot have multiple terminal commands"). The return value is
      // intentionally discarded when the workflow restarts.
      const alreadyTerminal = stepCommands.some(
        (cmd) =>
          cmd.type === WorkflowCommandType.COMPLETE_WORKFLOW ||
          cmd.type === WorkflowCommandType.FAIL_WORKFLOW ||
          cmd.type === WorkflowCommandType.RESTART_FRESH
      );
      if (!alreadyTerminal) {
        const completeWorkflowCommand = {
          type: WorkflowCommandType.COMPLETE_WORKFLOW,
          sequence: maxSequence + 1,
          result: resultForJson,
        };
        stepCommands.push(completeWorkflowCommand);
      }

      this.logger.info(`[WF-EXEC] About to return ExecutionResult for ${request.executionId}`);
      const executionResult = {
        executionId: request.executionId,
        success: true,
        result: serializedResult,
        duration,
        commands: stepCommands, // Step commands plus the terminal command
        reachedSteps,
        context, // Exposed for query and update handler dispatch
      };

      this.logger.info(
        `[WF-EXEC] Returning ExecutionResult with ${stepCommands.length} commands (including CompleteWorkflow) for ${request.executionId}`
      );
      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateDurationStats(duration);

      // WorkflowError.suspended() is not a failure. It is a control-flow signal that the
      // workflow must wait for external work (a task, a timer, an event).
      //
      // Suspension is also re-asserted if the workflow requested it this activation but
      // then threw a different error: its catch swallowed the suspension signal and
      // raised something else. Suspension wins, because the stray throw must not
      // override work the workflow has already scheduled.
      const isSuspend =
        error instanceof WorkflowError && (error as any).code === ErrorCode.WORKFLOW_SUSPENDED;
      if (isSuspend || context.wasSuspensionRequested()) {
        if (!isSuspend) {
          this.logger.warn(
            `[WF-EXEC] Workflow ${request.type} (${request.executionId}) threw ` +
              `${error instanceof Error ? error.name : 'a value'} after requesting suspension — a ` +
              `try/catch likely swallowed the suspension signal. Re-asserting suspension. Re-throw ` +
              `isWorkflowSuspension(e) errors from workflow catch blocks.`
          );
        }
        this.logger.info(
          `[WF-EXEC] Workflow suspended: ${request.type} (${request.executionId}) - ${
            error instanceof Error ? error.message : String(error)
          }`
        );

        // Includes the SCHEDULE_TASK commands that tell the engine what work to run.
        // A closure still running beside the step that suspended is waited for, so
        // its result is reported with this activation and it does not run again.
        await context.closuresSettled();
        const stepCommands = context.takeCommands();
        const reachedSteps = context.takeReachedSteps();
        this.logger.info(
          `[WF-EXEC] Extracted ${stepCommands.length} commands for suspended workflow ${request.executionId}`
        );

        for (const cmd of stepCommands) {
          this.logger.info(
            `[WF-EXEC] Suspension command: type=${cmd.type}, sequence=${cmd.sequence}`
          );
          if (cmd.type === WorkflowCommandType.SCHEDULE_TASK) {
            const scheduleCmd = cmd as any;
            this.logger.info(
              `[WF-EXEC] ScheduleTask command: taskId=${scheduleCmd.taskId}, taskType=${scheduleCmd.taskType}, sequence=${scheduleCmd.sequence}`
            );
          }
        }

        // A suspension counts as a success: the workflow produced commands and is waiting.
        this.stats.successfulExecutions++;

        const suspendedResult = {
          executionId: request.executionId,
          success: true,
          result: null,
          duration,
          commands: stepCommands,
          reachedSteps,
          suspended: true,
          context, // Exposed for query and update handler dispatch
        };

        this.logger.info(
          `[WF-EXEC] Returning suspended ExecutionResult with ${stepCommands.length} commands for ${request.executionId}`
        );
        return suspendedResult;
      }

      this.stats.failedExecutions++;

      if (error instanceof ExecutionTimeoutError) {
        this.stats.timedOutExecutions++;
      }

      this.logger.error(
        `Workflow failed: ${request.type} (${request.executionId}) after ${duration}ms`,
        error
      );

      this.logger.info(
        `[WF-EXEC] About to return failure ExecutionResult for ${request.executionId}`
      );
      const failureResult = {
        executionId: request.executionId,
        success: false,
        error: this.serializeError(error, request),
        duration,
        reachedSteps: context.takeReachedSteps(),
        context, // Exposed for query and update handler dispatch
      };

      this.logger.info(`[WF-EXEC] Returning failure ExecutionResult for ${request.executionId}`);
      return failureResult;
    }
  }

  /**
   * Get executor statistics
   */
  getStats(): WorkflowExecutorStats {
    const avgDuration =
      this.stats.totalExecutions > 0 ? this.stats.totalDuration / this.stats.totalExecutions : 0;

    return {
      totalExecutions: this.stats.totalExecutions,
      successfulExecutions: this.stats.successfulExecutions,
      failedExecutions: this.stats.failedExecutions,
      timedOutExecutions: this.stats.timedOutExecutions,
      averageDuration: avgDuration,
      minDuration: this.stats.minDuration === Infinity ? 0 : this.stats.minDuration,
      maxDuration: this.stats.maxDuration,
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
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
    };
  }

  /**
   * Create the workflow context and load the replay state into it
   *
   * The context has no DI container access: workflows emit SCHEDULE_TASK commands and
   * suspend, and the tasks run in task workers that do resolve dependencies.
   */
  private createContext(request: ExecutionRequest): WorkflowContext {
    // A request that carries cached step results or a non-empty journal is a replay.
    const isReplaying =
      request.isReplaying ||
      (request.cachedStepResults && request.cachedStepResults.length > 0) ||
      (request.metadata.journalLength && request.metadata.journalLength > 0);

    const context = new WorkflowContext(
      {
        workflowId: request.metadata.workflowId || request.executionId,
        runId: request.metadata.runId || `run-${Date.now()}`,
        workflowType: request.type,
        attempt: request.metadata.attempt,
        namespace: request.metadata.namespace,
        taskQueue: request.metadata.taskQueue,
      },
      isReplaying || false,
      '1.0.0', // version
      // The workflow's clock starts when the engine journaled the start. A
      // request from the engine always carries it; one built by hand (a test
      // driving the executor) may not, and starts the clock now.
      this.workflowStartMs(request)
    );
    if (request.journalTimes) {
      context.recordResolvedAt(request.journalTimes.resolvedAt);
    }

    // Cached step results let the replaying workflow reuse recorded task and closure
    // results instead of running them again. Failed steps are not injected.
    if (request.cachedStepResults && request.cachedStepResults.length > 0) {
      this.logger.info(
        `Injecting ${request.cachedStepResults.length} cached step results for replay`
      );

      for (const cached of request.cachedStepResults) {
        if (!cached.failed) {
          context.injectStepResult(cached.stepId, cached.result);
          this.logger.debug(
            `Injected cached result for step: ${cached.stepId} (type=${cached.stepType})`
          );
        } else {
          this.logger.debug(`Skipping failed step result for: ${cached.stepId}`);
        }
      }
    }

    // Buffered events from HandleEvent journal jobs replay the signals the workflow received.
    if (request.bufferedEvents && request.bufferedEvents.length > 0) {
      this.logger.info(`Injecting ${request.bufferedEvents.length} buffered event(s) for replay`);
      for (const { eventName, payload, position, atMs } of request.bufferedEvents) {
        context.bufferEvent(eventName, payload, position, atMs);
        this.logger.debug(`Buffered event: ${eventName}`);
      }
    }

    this.logger.debug('Created workflow context:', {
      workflowId: context.workflowId(),
      runId: context.runId(),
      type: context.workflowType(),
      isReplaying,
      cachedStepCount: request.cachedStepResults?.length || 0,
    });

    return context;
  }

  /**
   * When the workflow started, as the journal recorded it.
   */
  private workflowStartMs(request: ExecutionRequest): number {
    const startedAtMs = request.journalTimes?.startedAtMs;
    if (typeof startedAtMs === 'number') {
      return startedAtMs;
    }
    if (request.journalTimes) {
      this.logger.warn(
        `[WF-EXEC] The journal of ${request.executionId} records no start time; ` +
          `workflow time starts now`
      );
    }
    return Date.now();
  }

  /**
   * Deserialize input arguments
   */
  private deserializeInput(input: any): any[] {
    this.logger.debug('[WF-EXEC] deserializeInput called with:', JSON.stringify(input, null, 2));

    if (!input) {
      this.logger.debug('[WF-EXEC] Input is null/undefined, returning empty array');
      return [];
    }

    if (Array.isArray(input)) {
      this.logger.debug('[WF-EXEC] Input is array with', input.length, 'items');
      // An array of Payload objects (data + metadata) is decoded element by element.
      if (input.length > 0 && input[0].data !== undefined) {
        this.logger.debug('[WF-EXEC] Input contains Payload objects, deserializing...');
        const { fromPayload } = require('../core/bridge/payload');
        const deserialized = input.map((p: any) => {
          // fromPayload expects Uint8Array fields; they arrive as plain arrays.
          const payload = {
            data: new Uint8Array(p.data),
            metadata: Object.fromEntries(
              Object.entries(p.metadata || {}).map(([k, v]: [string, any]) => [
                k,
                new Uint8Array(v),
              ])
            ),
          };
          return fromPayload(payload);
        });
        this.logger.debug('[WF-EXEC] Deserialized inputs:', JSON.stringify(deserialized));
        return deserialized;
      }
      return input;
    }

    this.logger.debug('[WF-EXEC] Input is single object, wrapping in array');
    return [input];
  }

  /**
   * Execute workflow handler
   */
  private async executeHandler(
    workflowDef: WorkflowDefinition,
    context: WorkflowContext,
    args: any[]
  ): Promise<any> {
    try {
      this.logger.info(
        `[WF-EXEC] executeHandler: Calling workflowDef function, workflowType=${context.workflowType()}`
      );
      // workflowDef is the handler function itself.
      const result = await workflowDef(context, ...args);
      this.logger.info(
        `[WF-EXEC] executeHandler: workflowDef returned, result type: ${typeof result}`
      );
      return result;
    } catch (error) {
      // A WorkflowError (including suspension) is re-thrown unwrapped, because it is a
      // control-flow signal that execute() must recognize.
      if (error instanceof WorkflowError) {
        this.logger.info(
          `[WF-EXEC] executeHandler: WorkflowError thrown, re-throwing: ${error.message}`
        );
        throw error;
      }

      this.logger.error(`[WF-EXEC] executeHandler: Workflow handler threw error:`, error);
      throw new ExecutionError(
        `Workflow handler threw an error: ${error instanceof Error ? error.message : String(error)}`,
        'workflow',
        context.workflowType(),
        context.workflowId(),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute workflow with timeout
   */
  private async executeWithTimeout(
    workflowDef: WorkflowDefinition,
    context: WorkflowContext,
    args: any[],
    timeout: number
  ): Promise<any> {
    const { promise, clear } = this.createTimeout(timeout, workflowDef.name);
    try {
      return await Promise.race([this.executeHandler(workflowDef, context, args), promise]);
    } finally {
      // Settled either way: the timer must not outlive the activation.
      clear();
    }
  }

  /**
   * Create a timeout promise, and the function that cancels its timer.
   */
  private createTimeout(
    timeout: number,
    workflowName: string
  ): { promise: Promise<never>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ExecutionTimeoutError('workflow', workflowName, timeout));
      }, timeout);
    });
    return { promise, clear: () => clearTimeout(timer) };
  }

  /**
   * Serialize output to Payload format
   */
  private serializeOutput(result: any): any {
    const { toPayload } = require('../core/bridge/payload');
    return toPayload(result);
  }

  /**
   * Serialize error
   */
  private serializeError(error: unknown, _request: ExecutionRequest): any {
    const errorObj = {
      message: error instanceof Error ? error.message : String(error),
      // Non-determinism is reported as the kind the core recognises, so it
      // fails the execution as non-deterministic and not retryable rather
      // than as ordinary workflow code: the same code against the same
      // journal would fail the same way.
      type:
        error instanceof WorkflowError && error.code === ErrorCode.WORKFLOW_NON_DETERMINISTIC
          ? 'NonDeterminism'
          : error instanceof Error
            ? error.constructor.name
            : 'Error',
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
