/**
 * In-memory workflow execution for tests.
 *
 * `TestExecutor` runs a workflow function against a mock context, without an Orcher server.
 *
 * @module @orcher/sdk/testing/executor
 */

import type { WorkflowContext } from '../workflow/context';
import type { WorkflowFunction, DurationInput } from '../workflow/types';
import { durationToMillis } from '../workflow/types';
import type { TaskReference } from '../di/types';
import { ExecutionTrace } from './trace';
import type { TestWorkflowOptions } from './types';

/**
 * Runs workflows in memory against mocked tasks and the test clock.
 *
 * Tasks resolve through the mock task registry, and `sleep` waits on the time controller. Every
 * run records an `ExecutionTrace`. Tasks are not retried: a mock that throws fails the call.
 *
 * @internal Used by `TestWorkflowEnvironment`.
 *
 * @example
 * ```typescript
 * const executor = new TestExecutor(mockTaskRegistry, timeController);
 *
 * const result = await executor.execute(
 *   orderWorkflow,
 *   { orderId: '123', amount: 99.99 },
 *   { workflowId: 'wf-123', taskQueue: 'test-queue' }
 * );
 * ```
 */
export class TestExecutor {
  private readonly mockTaskRegistry: any; // a MockTaskRegistry
  private readonly timeController: any; // a TimeController
  private readonly traces: Map<string, ExecutionTrace> = new Map();
  private workflowIdCounter: number = 0;

  /** Pending event resolvers: key = `${workflowId}:${eventName}` */
  private readonly pendingEventResolvers: Map<string, Array<(value: any) => void>> = new Map();
  /** Pre-queued events not yet consumed: key = `${workflowId}:${eventName}` */
  private readonly queuedEvents: Map<string, any[]> = new Map();
  /** Query handlers registered by running workflows: key = `${workflowId}:${queryName}` */
  private readonly queryHandlerStore: Map<string, () => any> = new Map();
  /** Child workflow registry for recursive execution */
  private readonly childWorkflowRegistry: Map<string, WorkflowFunction<any[], any>> = new Map();

  constructor(mockTaskRegistry: any, timeController: any) {
    this.mockTaskRegistry = mockTaskRegistry;
    this.timeController = timeController;
  }

  /**
   * Deliver an event to a running workflow.
   *
   * A workflow already waiting in `waitForEvent` resumes with the data. Otherwise the event is
   * queued, and the next `waitForEvent` for that name returns it at once.
   */
  deliverEvent(workflowId: string, eventName: string, data: any): void {
    const key = `${workflowId}:${eventName}`;
    const resolvers = this.pendingEventResolvers.get(key);
    if (resolvers && resolvers.length > 0) {
      const resolve = resolvers.shift()!;
      resolve(data);
    } else {
      const queue = this.queuedEvents.get(key) ?? [];
      queue.push(data);
      this.queuedEvents.set(key, queue);
    }
  }

  /**
   * Run a workflow's query handler and return its result.
   *
   * @throws {Error} If the workflow has not called `registerQueryHandler` for `queryName`
   */
  executeQuery<TResult = any>(workflowId: string, queryName: string): TResult {
    const key = `${workflowId}:${queryName}`;
    const handler = this.queryHandlerStore.get(key);
    if (!handler) {
      throw new Error(
        `No query handler registered for '${queryName}' on workflow '${workflowId}'`
      );
    }
    return handler() as TResult;
  }

  /**
   * Register the function that runs when a workflow starts a child of `workflowType`.
   *
   * `executeChildWorkflow` throws for any type not registered here.
   */
  registerChildWorkflow(workflowType: string, fn: WorkflowFunction<any[], any>): void {
    this.childWorkflowRegistry.set(workflowType, fn);
  }

  /**
   * Execute a workflow with given input.
   *
   * @param workflow - Workflow function to execute
   * @param input - Workflow input
   * @param options - Execution options
   * @returns Workflow result
   *
   * @throws {Error} If the workflow throws or runs past `options.timeout` (default 30000 ms)
   */
  async execute<TInput, TResult>(
    workflow: WorkflowFunction<[TInput], TResult>,
    input: TInput,
    options: TestWorkflowOptions = {}
  ): Promise<TResult> {
    const workflowId = options.workflowId ?? this.generateWorkflowId();
    const workflowType = workflow.name || 'anonymous';

    const trace = new ExecutionTrace(workflowId, workflowType);
    this.traces.set(workflowId, trace);

    const context = this.createMockContext(workflowId, trace, options);

    const timeoutMs = options.timeout ?? 30000;
    // The timeout runs on the real clock, not the test clock, so `advanceTime`
    // does not bring it closer. It is cleared once the workflow settles, so a
    // finished test leaves no real timer behind to hold the process open.
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<typeof TIMEOUT_SYMBOL>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(TIMEOUT_SYMBOL), timeoutMs);
    });

    try {
      trace.markRunning();

      const resultPromise = this.executeWorkflow(workflow, context, input);
      const result = await Promise.race([resultPromise, timeoutPromise]);

      if (result === TIMEOUT_SYMBOL) {
        trace.markTimedOut();
        throw new Error(`Workflow ${workflowType} (${workflowId}) timed out after ${timeoutMs}ms`);
      }

      trace.markCompleted(result);
      return result as TResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      trace.markFailed(err);
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Get execution trace for a workflow.
   *
   * @param workflowId - Workflow ID
   * @returns Execution trace or undefined if not found
   */
  getTrace(workflowId: string): ExecutionTrace | undefined {
    return this.traces.get(workflowId);
  }

  /**
   * Get all execution traces.
   *
   * @returns Map of all traces
   */
  getAllTraces(): Map<string, ExecutionTrace> {
    return new Map(this.traces);
  }

  /**
   * Clear all traces.
   */
  clearTraces(): void {
    this.traces.clear();
  }

  /**
   * Generate a workflow ID of the form `test-wf-<counter>-<wall-clock ms>`.
   */
  private generateWorkflowId(): string {
    this.workflowIdCounter++;
    return `test-wf-${this.workflowIdCounter}-${Date.now()}`;
  }

  /**
   * Execute workflow function with context and input.
   */
  private async executeWorkflow<TInput, TResult>(
    workflow: WorkflowFunction<[TInput], TResult>,
    context: WorkflowContext,
    input: TInput
  ): Promise<TResult> {
    try {
      const result = await workflow(context, input);
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Create mock workflow context for testing.
   */
  private createMockContext(
    workflowId: string,
    trace: ExecutionTrace,
    options: TestWorkflowOptions
  ): WorkflowContext {
    const self = this;
    const startTimeMs = this.timeController.now().getTime();

    const context = {
      workflowId: () => workflowId,
      taskQueue: () => options.taskQueue ?? 'test-queue',

      // Tasks resolve through the mock task registry. Workflows pass the
      // TaskReference that @Task created, exactly as they do against the real
      // context; the mock is looked up by the reference's task name, which is
      // the name the engine would schedule. A bare name is also accepted, for
      // tests that mock a task without declaring a handler class for it.
      executeTask: async <TInput, TOutput>(
        taskRef: TaskReference<TInput, TOutput> | string,
        input: TInput
      ): Promise<TOutput> => {
        const taskName = resolveTaskName(taskRef);
        trace.recordTaskStart(taskName, input);

        try {
          const output = await self.mockTaskRegistry.execute(taskName, input);
          trace.recordTaskComplete(taskName, output);
          return output;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          trace.recordTaskFailure(taskName, err);
          throw err;
        }
      },

      setState: async <T>(key: string, value: T): Promise<void> => {
        trace.setState(key, value);
      },

      getState: async <T>(key: string): Promise<T | undefined> => {
        return trace.getState(key) as T | undefined;
      },

      hasState: async (key: string): Promise<boolean> => {
        return trace.hasState(key);
      },

      deleteState: async (key: string): Promise<void> => {
        trace.deleteState(key);
      },

      // `sleep` waits on the test clock. It takes a Duration like the real
      // context, or a bare number of milliseconds.
      sleep: async (duration: DurationInput): Promise<void> => {
        const ms = durationToMillis(duration);
        const timerId = self.generateTimerId();
        const fireAt = new Date(self.timeController.now().getTime() + ms);
        trace.recordTimer(timerId, ms, fireAt);

        await self.timeController.sleep(ms);
        trace.markTimerFired(timerId);
      },

      now: (): Date => {
        return self.timeController.now();
      },

      // WorkflowTime on the test clock. The real `ctx.time.now()` is the time of
      // the current activation, which moves forward each time the workflow wakes
      // from a timer; reading the test clock gives the same progression, driven
      // by `advanceTime`.
      time: createTestWorkflowTime(() => self.timeController.now().getTime(), startTimeMs),

      // Returns a queued event at once, otherwise waits for `deliverEvent`.
      // The optional timeout runs on the real clock, not the test clock.
      waitForEvent: async <T = any>(eventName: string, timeout?: number): Promise<T> => {
        const key = `${workflowId}:${eventName}`;
        const queue = self.queuedEvents.get(key);
        if (queue && queue.length > 0) {
          return queue.shift() as T;
        }
        const waitPromise = new Promise<T>((resolve) => {
          const resolvers = self.pendingEventResolvers.get(key) ?? [];
          resolvers.push(resolve);
          self.pendingEventResolvers.set(key, resolvers);
        });
        if (timeout != null && timeout > 0) {
          const timeoutPromise = new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`waitForEvent('${eventName}') timed out`)), timeout)
          );
          return Promise.race([waitPromise, timeoutPromise]);
        }
        return waitPromise;
      },

      // The workflow registers handlers; test code runs them with `executeQuery`.
      registerQueryHandler: <T>(name: string, handler: () => T): void => {
        const key = `${workflowId}:${name}`;
        self.queryHandlerStore.set(key, handler);
      },

      // Runs the handler stored by `registerQueryHandler`. Query arguments are ignored.
      query: async <TArgs, TResult>(queryName: string, _args?: TArgs): Promise<TResult> => {
        const key = `${workflowId}:${queryName}`;
        const handler = self.queryHandlerStore.get(key);
        if (!handler) {
          throw new Error(
            `No query handler registered for '${queryName}'. ` +
            `Call ctx.registerQueryHandler('${queryName}', ...) in the workflow first.`
          );
        }
        return handler() as TResult;
      },

      // Runs the function registered with `registerChildWorkflow` in a context of
      // its own, with its own trace. An unregistered type throws.
      executeChildWorkflow: async <TInput, TResult>(
        workflowType: string,
        input: TInput
      ): Promise<TResult> => {
        const childWorkflowId = self.generateWorkflowId();
        trace.recordChildWorkflow(childWorkflowId, workflowType, input);

        const childFn = self.childWorkflowRegistry.get(workflowType);
        if (!childFn) {
          throw new Error(
            `Child workflow '${workflowType}' is not registered in TestExecutor. ` +
            `Call executor.registerChildWorkflow('${workflowType}', fn) before running.`
          );
        }

        const childTrace = new ExecutionTrace(childWorkflowId, workflowType);
        self.traces.set(childWorkflowId, childTrace);
        const childContext = self.createMockContext(childWorkflowId, childTrace, {
          taskQueue: options.taskQueue,
        });

        childTrace.markRunning();
        try {
          const result = await childFn(childContext, input);
          childTrace.markCompleted(result);
          return result as TResult;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          childTrace.markFailed(err);
          throw err;
        }
      },

      // Not supported yet: `restartFresh` always throws in the test executor.
      restartFresh: async <TNewInput>(_newInput: TNewInput): Promise<never> => {
        throw new Error('restartFresh not yet implemented in test executor');
      },

      log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void => {
        // Logs go to the console, prefixed with the workflow ID.
        const prefix = `[TEST:${workflowId}]`;
        switch (level) {
          case 'debug':
            console.debug(prefix, message, data ?? '');
            break;
          case 'info':
            console.info(prefix, message, data ?? '');
            break;
          case 'warn':
            console.warn(prefix, message, data ?? '');
            break;
          case 'error':
            console.error(prefix, message, data ?? '');
            break;
        }
      },

      // A partial WorkflowRandom: only `random`, `uuid` and `int`. The value is
      // derived from the workflow ID alone, so a test is reproducible, and every
      // call within one workflow returns the same number.
      get random() {
        const getRandomNumber = (): number => {
          const hash = workflowId.split('').reduce((acc, char) => {
            return (acc << 5) - acc + char.charCodeAt(0);
          }, 0);
          return Math.abs(Math.sin(hash)) % 1;
        };

        return {
          random: getRandomNumber,
          uuid: (): string => {
            const timestamp = self.timeController.now().getTime();
            const random = Math.floor(getRandomNumber() * 1000000);
            return `test-uuid-${timestamp}-${random}`;
          },
          int: (min: number, max: number): number => {
            return Math.floor(getRandomNumber() * (max - min + 1)) + min;
          },
        } as any;
      },
    } as any as WorkflowContext;

    return context;
  }

  /**
   * Generate a timer ID for the trace.
   */
  private generateTimerId(): string {
    return `timer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Sentinel that the timeout promise resolves with, so `Promise.race` can tell a timeout apart
 * from any value the workflow returns.
 */
const TIMEOUT_SYMBOL = Symbol('TIMEOUT');

/**
 * Name a task the way the engine does: by the TaskReference's task name.
 */
function resolveTaskName(taskRef: TaskReference<any, any> | string): string {
  if (typeof taskRef === 'string') {
    return taskRef;
  }
  if (taskRef && typeof taskRef === 'object' && typeof taskRef.taskName === 'string') {
    return taskRef.taskName;
  }
  throw new Error(
    'executeTask requires a TaskReference. Use @Task() decorator to create TaskReferences.'
  );
}

/**
 * The `WorkflowTime` surface, read from the test clock.
 */
function createTestWorkflowTime(clockMs: () => number, startTimeMs: number) {
  const elapsed = (): number => clockMs() - startTimeMs;
  return {
    now: (): Date => new Date(clockMs()),
    elapsed,
    elapsedSecs: (): number => Math.floor(elapsed() / 1000),
    startTimeMs: (): number => startTimeMs,
    startedAt: (): Date => new Date(startTimeMs),
    toISOString: (): string => new Date(clockMs()).toISOString(),
    hasElapsed: (durationMs: number): boolean => elapsed() >= durationMs,
    remainingMs: (timeoutMs: number): number => Math.max(0, timeoutMs - elapsed()),
    remainingSecs: (timeoutSecs: number): number =>
      Math.max(0, timeoutSecs - Math.floor(elapsed() / 1000)),
  };
}

/**
 * Create a new test executor.
 *
 * @param mockTaskRegistry - Mock task registry
 * @param timeController - Time controller
 * @returns New test executor instance
 *
 * @example
 * ```typescript
 * const registry = new MockTaskRegistry();
 * const timeController = new TimeController();
 * const executor = createTestExecutor(registry, timeController);
 * ```
 */
export function createTestExecutor(mockTaskRegistry: any, timeController: any): TestExecutor {
  return new TestExecutor(mockTaskRegistry, timeController);
}
