/**
 * Workflow execution context.
 *
 * This module provides `WorkflowContext`, the interface through which workflow
 * code talks to the Orcher runtime. It covers:
 * - Executing tasks and inline closures
 * - Managing workflow state
 * - Handling timers and delays
 * - Interacting with child workflows
 * - Managing events and queries
 * - Accessing deterministic helpers (random, time)
 * - Workflow metadata and versioning
 *
 * @packageDocumentation
 */

import { durationToMillis, type DurationInput } from './types';
import { WorkflowRandom } from './random';
import { WorkflowTime } from './time';
import { EventManager, EventHelpers, type SendEventCommand } from './events';
import { QueryManager, QueryHandler, QueryOptions, QueryHelpers } from './query';
import { ChildWorkflowHandle, ChildWorkflowFailedError } from './child-handle';
import type { TaskReference } from '../di/types';
import { Duration, ParentClosePolicy } from './types';
import type { RetryPolicy } from './types';
import { WorkflowError, TASK_FAILED_SENTINEL_KEY } from '../errors';

/**
 * Metadata about the current workflow execution.
 */
export interface WorkflowExecution {
  /** Unique workflow ID */
  workflowId: string;

  /** Unique run ID for this execution attempt */
  runId: string;

  /** Workflow type name, as given to `workflow()` or `@Workflow()` */
  workflowType: string;

  /** Current attempt number (starts at 1) */
  attempt: number;

  /** Namespace this workflow is running in */
  namespace: string;

  /** Task queue this workflow is assigned to */
  taskQueue: string;
}

/**
 * Kinds of command a workflow can emit.
 *
 * The workflow context generates commands and the executor sends them to the
 * engine. Each one describes an action the workflow wants taken.
 */
export enum WorkflowCommandType {
  SCHEDULE_TASK = 'SCHEDULE_TASK',
  START_TIMER = 'START_TIMER',
  CANCEL_TIMER = 'CANCEL_TIMER',
  START_CHILD_WORKFLOW = 'START_CHILD_WORKFLOW',
  CANCEL_CHILD_WORKFLOW = 'CANCEL_CHILD_WORKFLOW',
  RECORD_STEP_RESULT = 'RECORD_STEP_RESULT',
  WAIT_FOR_EVENT = 'WAIT_FOR_EVENT',
  COMPLETE_WORKFLOW = 'COMPLETE_WORKFLOW',
  FAIL_WORKFLOW = 'FAIL_WORKFLOW',
  RESTART_FRESH = 'RESTART_FRESH',
  SEND_EVENT = 'SEND_EVENT',
}

/**
 * Fields shared by every workflow command.
 */
export interface WorkflowCommand {
  type: WorkflowCommandType;
  sequence: number;
}

/**
 * Per-call overrides when executing a task.
 *
 * Each option accepts the `Duration` helper or a bare number of milliseconds,
 * like the other user-facing duration options.
 */
export interface TaskExecuteOptions {
  /** Overall time the task is allowed to take. */
  timeout?: DurationInput;
  /** Maximum time between heartbeats before the task is considered failed.
   * Omitted, the heartbeat timeout declared on `task({ heartbeatTimeout })`
   * applies; with neither, heartbeat supervision is off. */
  heartbeatTimeout?: DurationInput;
  /** How long the task may wait in its queue before a worker starts it.
   *
   * Omitted means it waits as long as it needs to. `timeout` covers only the
   * run itself, so the queue wait is limited separately by this option. */
  queueTimeout?: DurationInput;
}

/**
 * Schedule task command
 */
export interface ScheduleTaskCommand extends WorkflowCommand {
  type: WorkflowCommandType.SCHEDULE_TASK;
  taskId: string;
  taskType: string;
  taskQueue: string;
  input: any;
  /** Overall task timeout, in milliseconds. */
  timeout?: number;
  /** Maximum time between heartbeats before the task is considered failed, in
   * milliseconds. Omitted means no heartbeat supervision. */
  heartbeatTimeoutMs?: number;
  /** How long the task may wait in its queue before a worker starts it, in
   * milliseconds. Omitted means no queue limit. */
  queueTimeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

/**
 * Start timer command
 */
export interface StartTimerCommand extends WorkflowCommand {
  type: WorkflowCommandType.START_TIMER;
  timerId: string;
  durationMs: number;
}

/**
 * Start child workflow command
 */
export interface StartChildWorkflowCommand extends WorkflowCommand {
  type: WorkflowCommandType.START_CHILD_WORKFLOW;
  workflowId: string;
  workflowType: string;
  taskQueue: string;
  input: any;
  /** Execution timeout, in milliseconds */
  timeout?: number;
  parentClosePolicy?: ParentClosePolicy;
}

/**
 * Cancel child workflow command
 */
export interface CancelChildWorkflowCommand extends WorkflowCommand {
  type: WorkflowCommandType.CANCEL_CHILD_WORKFLOW;
  workflowId: string;
}

/**
 * Kind of step recorded in the journal.
 *
 * The values match the `StepType` enum in the Orcher protos.
 */
export enum StepType {
  UNSPECIFIED = 0,
  TASK = 1,
  CLOSURE = 2,
  CHILD_WORKFLOW = 3,
  SIDE_EFFECT = 4,
}

/**
 * Record step result command (for inline closures and tasks)
 */
export interface RecordStepResultCommand extends WorkflowCommand {
  type: WorkflowCommandType.RECORD_STEP_RESULT;
  stepName: string;
  stepType: StepType;
  result: any;
}

// The canonical RetryPolicy lives in ./types. It is re-exported here because the
// package also exposes it as `ContextRetryPolicy`.
export type { RetryPolicy };

// One enum for the policy, defined beside the other workflow types. Two
// enums under one name were not assignable to each other, so the one the
// package root exported could not be passed to the context's child workflow
// calls.
export { ParentClosePolicy };

/**
 * Child workflow options
 */
export interface ChildWorkflowOptions {
  /** Workflow ID for the child workflow (generated if not provided) */
  workflowId?: string;
  /** Task queue for the child workflow (inherits from parent if not provided) */
  taskQueue?: string;
  /** Execution timeout, as a `Duration` */
  timeout?: Duration;
  /** Policy for what happens to child when parent closes */
  parentClosePolicy?: ParentClosePolicy;
}

/**
 * Restart fresh command
 *
 * Restart the workflow with a fresh execution history.
 * See `ctx.restartFresh()` for the API that emits this command.
 */
export interface RestartFreshCommand extends WorkflowCommand {
  type: WorkflowCommandType.RESTART_FRESH;
  /** New workflow type (if migrating to a new version) */
  workflowType?: string;
  /** New input for the restarted workflow */
  input: any;
  /** New task queue (if changing routing) */
  taskQueue?: string;
  /** New execution timeout, in milliseconds */
  timeout?: number;
}

/**
 * Options for restarting a workflow with a fresh execution history.
 *
 * Restart fresh is useful to:
 * - Prevent unbounded history growth in long-running workflows
 * - Periodically refresh code versions
 * - Implement entity workflows that run forever
 * - Checkpoint state and start fresh
 */
export interface RestartFreshOptions {
  /**
   * New workflow type (optional)
   *
   * If provided, the restarted workflow will execute with this type.
   * Useful for migrating to a new workflow version.
   */
  workflowType?: string;

  /**
   * New task queue (optional)
   *
   * If provided, the restarted workflow will be routed to this queue.
   * Useful for moving workflows to different worker pools.
   */
  taskQueue?: string;

  /**
   * New execution timeout (optional).
   *
   * If provided, the restarted workflow will use this timeout: a `Duration`,
   * or a number of milliseconds.
   */
  timeout?: DurationInput;
}

/**
 * Internal state maintained by the workflow context.
 */
interface ContextState {
  /** Whether the workflow is currently replaying from history */
  replaying: boolean;

  /**
   * The one step counter. Task, timer, child, closure and session ids are
   * derived from it, and each step takes exactly one number whether it is
   * issued or read back from the journal, so an id depends only on the step's
   * place in the code. Waits for events are not engine steps and take none.
   */
  sequence: number;

  /** Commands generated by the workflow (to be sent to executor) */
  commands: WorkflowCommand[];

  /** Workflow state storage (key-value pairs) */
  workflowState: Map<string, any>;

  /** Pending task results (for replay) */
  pendingTaskResults: Map<string, any>;

  /** Step type mapping (to track inline closures) */
  stepTypeMap: Map<string, string>;

  /** Cached workflow input (for restart_fresh) */
  cachedInput?: any;

  /** Whether restart_fresh has been called (terminal command) */
  restartFreshCalled: boolean;

  /** Fired timers (timer ID -> fire time) */
  firedTimers: Map<string, number>;

  /** Event buffer (event name -> payloads) */
  eventBuffer: Map<string, any[]>;

  /** Query handlers (query name -> handler function) */
  queryHandlers: Map<string, () => any>;

  /** Child workflow handles (workflow ID -> handle) */
  childWorkflows: Map<string, ChildWorkflowHandle<any>>;

  /** Task queue override for session routing (consumed after each executeTask call) */
  taskQueueOverride?: string;
}

/**
 * Signature of a task function.
 */
export type TaskFunction<I = any, O = any> = (ctx: any, input: I) => Promise<O>;

/**
 * The context passed as the first argument to every workflow.
 *
 * It is the workflow's API to the Orcher runtime and its durable operations.
 *
 * ## Key Features
 *
 * - **Execution**: `executeTask()` for registered tasks, `execute()` for inline closures
 * - **Deterministic helpers**: `random` and `time` for values that must not change on replay
 * - **State**: `setState()` and `getState()`
 * - **Timers**: `sleep()` and `sleepWithId()` for durable delays
 * - **Events and queries**: `waitForEvent()` and `registerQueryHandler()`
 * - **Child workflows**: `executeChildWorkflow()` and `startChildWorkflow()`
 * - **Metadata**: workflow ID, run ID, attempt, version label, and so on
 *
 * @example
 * Basic workflow:
 * ```typescript
 * import { workflow, WorkflowContext } from '@orcher/sdk';
 *
 * export const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   run: async (ctx: WorkflowContext, order: Order) => {
 *     // Registered task, created with task() or @Task()
 *     const payment = await ctx.executeTask(chargePayment, order);
 *
 *     // Inline closure, journaled under the step name
 *     const user = await ctx.execute('fetch_user', async () => {
 *       const response = await fetch(`/api/users/${order.userId}`);
 *       return response.json();
 *     });
 *
 *     // Deterministic helpers
 *     const confirmationId = ctx.random.uuid();
 *     const orderTime = ctx.time.now();
 *
 *     return {
 *       orderId: order.id,
 *       chargeId: payment.chargeId,
 *       confirmationId,
 *       orderTime: orderTime.toISOString(),
 *     };
 *   },
 * });
 * ```
 */
export class WorkflowContext {
  /** Workflow execution metadata */
  private readonly execution: WorkflowExecution;

  /** Workflow version string */
  private readonly _version: string;

  /** Deterministic random helper (property access) */
  private readonly _random: WorkflowRandom;

  /** The workflow's clock, read from the journal (property access) */
  private readonly _time: WorkflowTime;

  /** Event manager for handling workflow events */
  private readonly eventManager: EventManager;

  /** Query manager for handling workflow queries */
  private readonly queryManager: QueryManager;

  /** Internal context state */
  private readonly state: ContextState;

  /**
   * Whether a suspension was requested during this activation.
   *
   * Suspension is signaled by throwing `WorkflowError.suspended()`. Because a
   * JavaScript `catch` swallows every throw regardless of type, a workflow that
   * wraps `executeTask()`/`waitForEvent()`/… in a `try/catch` can accidentally
   * swallow the signal and continue as if the call returned. This flag lets the
   * executor re-assert suspension so a swallowed signal can never produce a wrong
   * terminal state. See `suspend()`.
   */
  private suspensionRequested = false;

  /** Pending-operation ids from the most recent suspension request. */
  private suspensionOps: string[] = [];

  /**
   * Create a workflow context. The SDK creates it; workflows receive it as
   * their first parameter.
   *
   * Workflows have no access to the DI container, by design:
   * - Tasks run on task workers, which do have DI support
   * - Workflows only emit SCHEDULE_TASK commands and suspend
   * - This keeps workflows deterministic and lets task workers scale separately
   *
   * @param execution - Workflow execution metadata
   * @param replaying - Whether the workflow is replaying from history
   * @param version - Workflow version string
   * @param startTimeMs - Workflow start time in milliseconds
   *
   * @internal
   */
  constructor(
    execution: WorkflowExecution,
    replaying: boolean = false,
    version: string = '1.0.0',
    startTimeMs: number = Date.now()
  ) {
    this.execution = execution;
    this._version = version;
    this._random = new WorkflowRandom(execution.workflowId);
    this._time = new WorkflowTime(startTimeMs);
    this.eventManager = new EventManager();
    this.queryManager = new QueryManager();

    this.state = {
      replaying,
      sequence: 0,
      commands: [],
      workflowState: new Map(),
      pendingTaskResults: new Map(),
      stepTypeMap: new Map(),
      firedTimers: new Map(),
      eventBuffer: new Map(),
      queryHandlers: new Map(),
      childWorkflows: new Map(),
      restartFreshCalled: false,
    };

    // Register automatic queries for observability
    this.registerAutomaticQueries();
  }

  // ============================================================================
  // Deterministic Helpers (Property Access)
  // ============================================================================

  /**
   * Get the deterministic random helper
   *
   * Provides access to deterministic random operations. All random values are
   * seeded by the workflow ID and an auto-incrementing counter, ensuring the
   * same sequence of "random" values across replays.
   *
   * **Note**: This is a property, not a method. Use `ctx.random.uuid()`, not `ctx.random().uuid()`.
   *
   * @returns WorkflowRandom helper instance
   *
   * @example
   * Generate deterministic UUIDs:
   * ```typescript
   * const orderId = `ORD-${ctx.random.uuid()}`;
   * const confirmationId = `CONF-${ctx.random.uuid()}`;
   * ```
   *
   * @example
   * Random selection:
   * ```typescript
   * const warehouse = ctx.random.choose(['east', 'west', 'central']);
   * const delay = ctx.random.randomRange(1, 10);
   * ```
   */
  get random(): WorkflowRandom {
    return this._random;
  }

  /**
   * Get the deterministic time helper
   *
   * The workflow's clock, read from its journal: it starts when the engine
   * journaled the workflow's start and moves to when each task result, fired
   * timer, child outcome or event the workflow receives was journaled. A
   * replay reads the same time at each point in the code as the run it
   * replays.
   *
   * **Note**: This is a property, not a method. Use `ctx.time.now()`, not `ctx.time().now()`.
   *
   * @returns WorkflowTime helper instance
   *
   * @example
   * Stamp a record with the workflow's time:
   * ```typescript
   * const orderTime = ctx.time.now();
   * await ctx.executeTask(orderTasks.saveOrder, { ...order, createdAt: orderTime.toISOString() });
   * ```
   *
   * @example
   * Branch on how long the workflow has run:
   * ```typescript
   * if (ctx.time.elapsedSecs() > 300) {
   *   await ctx.executeTask(orderTasks.escalate, order);
   * }
   * ```
   */
  get time(): WorkflowTime {
    return this._time;
  }

  // ============================================================================
  // Execution APIs
  // ============================================================================

  /**
   * Execute a registered task, journaling its result.
   *
   * The task runs on a task worker, not inside the workflow. The first time
   * this is reached, the workflow schedules the task and suspends. When the
   * task completes, the workflow is replayed and this call returns the
   * journaled result. Tasks defined with `@Task()` have their dependencies
   * injected from the DI container on the task worker.
   *
   * @param taskRef - A `TaskReference`, from `task()` or `createTaskRefs()` on a `@Tasks()` class
   * @param input - Input data for the task
   * @param options - Per-call timeout overrides
   * @returns Promise resolving to the task result
   *
   * @throws {Error} If `taskRef` is not a `TaskReference`
   * @throws {WorkflowError} If the task failed terminally (after its retries)
   *
   * @example
   * With a reference from `createTaskRefs()`:
   * ```typescript
   * // paymentTasks = createTaskRefs(PaymentTasks)
   * const payment = await ctx.executeTask(paymentTasks.chargeCard, {
   *   amount: order.total,
   *   token: paymentToken,
   * });
   * ```
   *
   * @example
   * With a reference from `task()`, and a per-call timeout:
   * ```typescript
   * const payment = await ctx.executeTask(chargePayment, order, {
   *   timeout: Duration.fromSeconds(30),
   * });
   * ```
   */
  async executeTask<I, O>(
    taskRef: TaskReference<I, O>,
    input: I,
    options?: TaskExecuteOptions
  ): Promise<O> {
    // A TaskReference has taskName, handlerClass and methodName properties.
    if (
      typeof taskRef !== 'object' ||
      taskRef === null ||
      !('taskName' in taskRef) ||
      !('handlerClass' in taskRef) ||
      !('methodName' in taskRef)
    ) {
      throw new Error(
        'executeTask requires a TaskReference. Use @Task() decorator to create TaskReferences.'
      );
    }

    const taskName = taskRef.taskName;

    // The task ID is deterministic across replays. The task name prefix makes
    // the journal easier to read. It takes one number on every path, cached or
    // not, so the ids of the steps after it do not depend on whether it had
    // already completed.
    const sequence = this.nextSequence();
    const taskId = `${taskName}_${sequence}`;
    this.reachStep(taskId);

    // A journaled result means the task already ran: return it instead of
    // scheduling the task again. This is what makes the task durable.
    // pendingTaskResults is checked regardless of the replaying flag, because
    // results can be injected during execution as well as on replay.
    if (this.state.pendingTaskResults.has(taskId)) {
      this.observe(taskId);
      const cached = this.state.pendingTaskResults.get(taskId);
      // A terminal task failure from the engine arrives as a sentinel value. Decode it
      // and throw a catchable error instead of returning it as a success value.
      if (cached && typeof cached === 'object' && (cached as any)[TASK_FAILED_SENTINEL_KEY]) {
        const c = cached as any;
        throw WorkflowError.taskFailed(taskName, c.attempts ?? 1, c.message ?? 'Task failed');
      }
      return cached as O;
    }

    // No result yet: schedule the task. Tasks never run inline in a workflow,
    // the same model as the other Orcher SDKs:
    // - The workflow emits SCHEDULE_TASK and suspends
    // - Task workers poll for scheduled tasks and execute them
    // - Task results come back and resume the workflow
    //
    // This means:
    // - Task workers scale independently of workflow workers
    // - Every task has a real TaskScheduled journal entry
    // - Workflows stay deterministic, with no DI access
    const command: ScheduleTaskCommand = {
      type: WorkflowCommandType.SCHEDULE_TASK,
      sequence,
      taskId,
      taskType: taskName,
      taskQueue: this.state.taskQueueOverride ?? this.execution.taskQueue,
      input,
    };

    // Timeout precedence: this call's option, then the timeout declared on the
    // task (`@Task({ timeout })` or `task({ timeout })`), then the scheduler
    // default. The heartbeat timeout takes the same precedence, without a
    // default: undeclared, heartbeat supervision is off. The queue timeout
    // comes from this call only.
    if (options?.timeout !== undefined) {
      command.timeout = durationToMillis(options.timeout);
    } else if (taskRef.timeout !== undefined) {
      command.timeout = taskRef.timeout;
    }
    if (options?.heartbeatTimeout !== undefined) {
      command.heartbeatTimeoutMs = durationToMillis(options.heartbeatTimeout);
    } else if (taskRef.heartbeatTimeout !== undefined) {
      command.heartbeatTimeoutMs = taskRef.heartbeatTimeout;
    }
    if (options?.queueTimeout !== undefined) {
      command.queueTimeoutMs = durationToMillis(options.queueTimeout);
    }

    // Send the task's declared retry policy to the engine. Tasks that declare none use the
    // engine default.
    if (taskRef.retryPolicy) {
      // TaskReference carries the DI RetryPolicy type; it is structurally compatible with the
      // workflow RetryPolicy the command expects (worker.ts normalizes the fields defensively).
      command.retryPolicy = taskRef.retryPolicy as unknown as RetryPolicy;
    }

    // A session's queue override applies to one task only.
    this.state.taskQueueOverride = undefined;

    this.addCommand(command);

    this.state.stepTypeMap.set(taskId, 'task');

    // Suspend until a task worker has run the task. The executor catches
    // WorkflowError.suspended() and then:
    // 1. Includes the SCHEDULE_TASK command in the ExecutionResult
    // 2. Marks the execution as suspended, not failed
    // 3. The engine journals TaskScheduled and dispatches to the task queue
    // 4. When the task completes, the workflow resumes with the cached result
    this.suspend(`Waiting for task: ${taskName}`, [taskId]);
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a worker session that pins all subsequent tasks to a single worker.
   *
   * This schedules an internal `__orcher_create_session` task on the workflow's
   * normal queue. A worker picks it up, acquires a session slot, and returns
   * its unique queue name. The returned {@link SessionContext} routes tasks
   * run through it to that worker-specific queue.
   *
   * **Replay safety**: task IDs are derived from the step sequence. On replay,
   * the session queue name comes from the journal and the session is not recreated.
   *
   * @param options - Session configuration options
   * @returns Promise resolving to a SessionContext for pinned task execution
   *
   * @example
   * ```typescript
   * const session = await ctx.createSession({
   *   creationTimeout: 30_000,
   *   executionTimeout: 600_000,
   * });
   *
   * const model = await session.executeTask(loadModel, { name: 'bert-base' });
   * const result = await session.executeTask(runInference, { data });
   * session.complete();
   * ```
   */
  async createSession(
    options?: import('./session').SessionOptions
  ): Promise<import('./session').SessionContext> {
    const {
      SESSION_CREATE_TASK,
      SessionContext: SessionCtx,
      SessionState,
    } = await import('./session');

    const opts = {
      creationTimeout: options?.creationTimeout ?? 30_000,
      executionTimeout: options?.executionTimeout ?? 600_000,
      maxConcurrentTasks: options?.maxConcurrentTasks ?? 1,
      heartbeatInterval: options?.heartbeatInterval ?? 5_000,
    };

    // One number on every path, cached or not, like every other step.
    const sequence = this.nextSequence();
    const sessionId = `session_${sequence}`;
    const taskId = `${SESSION_CREATE_TASK}_${sequence}`;
    this.reachStep(taskId);

    // On replay, the journaled session creation result is a serialized SessionInfo.
    if (this.state.pendingTaskResults.has(taskId)) {
      this.observe(taskId);
      const cached = this.state.pendingTaskResults.get(taskId);
      return new SessionCtx(this, {
        session_id: cached.session_id ?? sessionId,
        session_queue: cached.session_queue,
        worker_identity: cached.worker_identity ?? '',
        state: SessionState.OPEN,
      });
    }

    // No journaled result: schedule the session creation task.
    const inputData = {
      session_id: sessionId,
      creation_timeout_ms: opts.creationTimeout,
      execution_timeout_ms: opts.executionTimeout,
      max_concurrent_tasks: opts.maxConcurrentTasks,
      heartbeat_interval_ms: opts.heartbeatInterval,
    };

    const command: ScheduleTaskCommand = {
      type: WorkflowCommandType.SCHEDULE_TASK,
      sequence,
      taskId,
      taskType: SESSION_CREATE_TASK,
      taskQueue: this.execution.taskQueue,
      input: inputData,
    };

    this.addCommand(command);
    this.state.stepTypeMap.set(taskId, 'task');

    this.suspend(`Creating session '${sessionId}'`, [taskId]);
  }

  /**
   * Execute an inline closure and journal its result.
   *
   * The closure runs inside the workflow worker. Its result is recorded under
   * `stepName`, and on replay the recorded result is returned without running
   * the closure again. Use it for small operations (HTTP calls, database
   * queries) that do not warrant a registered task. A closure that throws is
   * not recorded.
   *
   * @param stepName - Unique name for this operation, used as the journal key
   * @param closure - Async function to execute
   * @returns Promise resolving to the closure result
   *
   * @example
   * HTTP call:
   * ```typescript
   * const user = await ctx.execute('fetch_user', async () => {
   *   const response = await fetch(`/api/users/${userId}`);
   *   return response.json();
   * });
   * ```
   *
   * @example
   * Database query:
   * ```typescript
   * const orders = await ctx.execute('query_orders', async () => {
   *   return db.query('SELECT * FROM orders WHERE user_id = ?', [userId]);
   * });
   * ```
   */
  async execute<T>(stepName: string, closure: () => Promise<T>): Promise<T> {
    if (!stepName || stepName.trim().length === 0) {
      throw new Error('execute() requires a non-empty step name');
    }

    // The step id is the name and a number from the step counter, taken on
    // every path, cached or not. Taking it only when the closure runs would
    // shift the id of every later step once the closure's result was in the
    // journal, and two runs of one name (a loop) would share one result.
    const sequence = this.nextSequence();
    const stepId = `${stepName}_${sequence}`;

    // A journaled result means the closure already ran.
    if (this.state.pendingTaskResults.has(stepId)) {
      const cached = this.state.pendingTaskResults.get(stepId);
      if (cached && typeof cached === 'object' && (cached as any)[TASK_FAILED_SENTINEL_KEY]) {
        const c = cached as any;
        throw WorkflowError.taskFailed(stepName, c.attempts ?? 1, c.message ?? 'Step failed');
      }
      return cached as T;
    }

    // Run the closure and record its result for journaling. The run is held
    // until it settles: a closure beside a step that suspends (in a
    // `Promise.all`, say) is still running when the workflow suspends, and the
    // executor waits for it so its result goes out with this activation
    // instead of being lost and the closure run again on the next one.
    const run = (async () => {
      const result = await closure();
      // StepType.CLOSURE (2): an inline closure, not a registered task.
      const command: RecordStepResultCommand = {
        type: WorkflowCommandType.RECORD_STEP_RESULT,
        sequence,
        stepName: stepId,
        stepType: StepType.CLOSURE,
        result,
      };
      this.addCommand(command);
      this.state.stepTypeMap.set(stepId, 'closure');
      return result;
    })();
    this.runningClosures.add(run);
    const forget = () => {
      this.runningClosures.delete(run);
    };
    run.then(forget, forget);
    return run;
  }

  /**
   * Waits until every closure started in this activation has settled, so the
   * results of those that succeeded are among the commands taken next.
   *
   * @internal Used by the executor before it takes the activation's commands.
   */
  async closuresSettled(): Promise<void> {
    while (this.runningClosures.size > 0) {
      await Promise.allSettled([...this.runningClosures]);
    }
  }

  /** Closures started in this activation that have not settled yet. */
  private readonly runningClosures = new Set<Promise<unknown>>();

  // ============================================================================
  // Timers
  // ============================================================================

  /**
   * Wait for a durable timer to fire.
   *
   * The timer is held by the engine, so it survives worker restarts. The
   * workflow suspends and resumes when the timer fires.
   *
   * @param duration - How long to wait, as a `Duration`
   * @returns Promise that resolves when timer fires
   *
   * @example
   * Wait 5 minutes:
   * ```typescript
   * await ctx.sleep(Duration.fromMinutes(5));
   * ```
   *
   * @example
   * Delayed processing:
   * ```typescript
   * await ctx.executeTask(sendConfirmation, order);
   * await ctx.sleep(Duration.fromHours(1));
   * await ctx.executeTask(sendFollowUp, order);
   * ```
   */
  async sleep(duration: Duration): Promise<void> {
    // Derive a deterministic id from the step sequence (timer_{sequence}), so it
    // is stable across replays and correlates to the engine's fired-timer event.
    const sequence = this.nextSequence();
    return this.emitTimer(`timer_${sequence}`, sequence, duration.toMilliseconds());
  }

  /**
   * Sleep using a specific, stable timer ID (e.g. to address it for cancellation).
   *
   * Like `sleep()` but with an explicit ID. Prefer `sleep()` unless you need a
   * known ID.
   *
   * @param timerId - Unique timer ID
   * @param duration - How long to wait, as a `Duration`
   * @returns Promise that resolves when the timer fires
   *
   * @example
   * ```typescript
   * await ctx.sleepWithId('approval_timeout', Duration.fromHours(24));
   * ```
   */
  async sleepWithId(timerId: string, duration: Duration): Promise<void> {
    if (!timerId || timerId.trim().length === 0) {
      throw new Error('sleepWithId() requires a non-empty timer ID');
    }
    const durationMs = duration.toMilliseconds();
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('sleepWithId() requires a non-negative duration');
    }
    const sequence = this.nextSequence();
    return this.emitTimer(timerId, sequence, durationMs);
  }

  /** Waits issued per event name in this activation, for deadline timer ids. */
  private readonly eventTimeoutWaits = new Map<string, number>();

  /**
   * The deadline timer id for the next `waitForEventWithTimeout(eventName)`
   * in this activation: `event_timeout_<name>_<n>`, n counting waits on that
   * name from 1. Deterministic across replays because every activation
   * issues the same waits in the same order.
   */
  private eventTimeoutTimerId(eventName: string): string {
    const n = (this.eventTimeoutWaits.get(eventName) ?? 0) + 1;
    this.eventTimeoutWaits.set(eventName, n);
    return `event_timeout_${eventName}_${n}`;
  }

  /**
   * Emit a StartTimer command and suspend until the timer fires, or return
   * immediately on replay once the worker has injected the fired-timer marker
   * under `timer:{id}`. Callers consume the sequence unconditionally, before
   * this check, so IDs stay in lockstep across replays.
   */
  private emitTimer(timerId: string, sequence: number, durationMs: number): void {
    this.reachStep(timerId);
    if (this.state.pendingTaskResults.has(`timer:${timerId}`)) {
      this.observe(`timer:${timerId}`);
      return; // The timer has already fired
    }
    const command: StartTimerCommand = {
      type: WorkflowCommandType.START_TIMER,
      sequence,
      timerId,
      durationMs,
    };
    this.addCommand(command);
    this.suspend(`Waiting for timer: ${timerId}`, [timerId]);
  }

  // ============================================================================
  // Child Workflows
  // ============================================================================

  /**
   * Execute a child workflow and wait for its result.
   *
   * Equivalent to `startChildWorkflow()` followed by `handle.result()`.
   * The parent suspends until the child completes.
   *
   * Child workflows run independently but are linked to the parent. What
   * happens to the child when the parent closes is set by
   * `parentClosePolicy`, which defaults to `ParentClosePolicy.REQUEST_CANCEL`.
   *
   * @param workflowName - Registered name of the child workflow
   * @param input - Input data to pass to the child workflow
   * @param options - Optional child workflow configuration
   * @returns Promise that resolves with the child workflow result
   *
   * @throws {ChildWorkflowFailedError} If the child workflow failed
   *
   * @example
   * ```typescript
   * import { workflow, WorkflowContext } from '@orcher/sdk';
   *
   * export const orderWorkflow = workflow({
   *   name: 'order-workflow',
   *   run: async (ctx: WorkflowContext, order: Order) => {
   *     const payment = await ctx.executeChildWorkflow<PaymentResult>('process-payment', {
   *       orderId: order.id,
   *       amount: order.total,
   *     });
   *     return payment;
   *   },
   * });
   * ```
   *
   * @example
   * With options:
   * ```typescript
   * const result = await ctx.executeChildWorkflow('process-payment', paymentData, {
   *   workflowId: `payment-${orderId}`,
   *   timeout: Duration.fromMinutes(5),
   *   parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
   * });
   * ```
   */
  async executeChildWorkflow<T = any>(
    workflowName: string,
    input: any,
    options?: ChildWorkflowOptions
  ): Promise<T> {
    const workflowType = this.getWorkflowName(workflowName);
    // Derive a deterministic ID from the step sequence (child_{sequence}), like
    // executeTask and the Rust and Python SDKs. The sequence is consumed
    // unconditionally, before the cache check, so it stays in lockstep across
    // replays whether or not the child has completed. The ID round-trips: the
    // engine echoes it back for correlation. A caller-supplied workflowId
    // overrides it, to address the child by a known ID; the sequence is still
    // consumed so ordering stays stable.
    const sequence = this.nextSequence();
    const workflowId = options?.workflowId || `child_${sequence}`;
    this.reachStep(workflowId);

    // Emit StartChildWorkflow unless the child has already completed, in which
    // case its outcome is cached under `child:{id}`.
    if (!this.state.pendingTaskResults.has(`child:${workflowId}`)) {
      const taskQueue = options?.taskQueue || this.execution.taskQueue;
      const parentClosePolicy = options?.parentClosePolicy || ParentClosePolicy.REQUEST_CANCEL;
      const command: StartChildWorkflowCommand = {
        type: WorkflowCommandType.START_CHILD_WORKFLOW,
        sequence,
        workflowId,
        workflowType,
        taskQueue,
        input,
        timeout: options?.timeout?.toMilliseconds(),
        parentClosePolicy,
      };
      this.addCommand(command);
    }

    // Return the child's result from the shared cache, or suspend until it
    // completes. The handle path uses the same resolver.
    return this.resolveChildWorkflowResult<T>(workflowType, workflowId);
  }

  /**
   * Resolve a child workflow's result from the shared replay cache, or suspend
   * until it completes.
   *
   * Shared by `executeChildWorkflow()` (start and await) and
   * `ChildWorkflowHandle.result()` (start now, await later). The worker injects
   * the child's outcome under `child:{id}`: either a success value, or a
   * `{ __orcher_child_failed__: true, message }` sentinel for a failed child.
   *
   * @throws {ChildWorkflowFailedError} If the child workflow failed
   * @internal
   */
  resolveChildWorkflowResult<T = any>(workflowType: string, workflowId: string): T {
    const cacheKey = `child:${workflowId}`;
    if (this.state.pendingTaskResults.has(cacheKey)) {
      this.observe(cacheKey);
      const cached = this.state.pendingTaskResults.get(cacheKey);
      if (cached && typeof cached === 'object' && (cached as any).__orcher_child_failed__) {
        throw new ChildWorkflowFailedError(
          workflowType,
          workflowId,
          (cached as any).message ?? 'Child workflow failed'
        );
      }
      return cached as T;
    }
    // Not completed yet: suspend so the runtime waits for the child.
    this.suspend(`Waiting for child workflow: ${workflowType}`, [workflowId]);
  }

  /**
   * Start a child workflow without waiting for its result.
   *
   * Returns a handle; call `handle.result()` to wait for the child. Starting a
   * child does not suspend the parent, which makes it possible to:
   * - Start several child workflows and await them together
   * - Do other work before waiting for the result
   *
   * @param workflowName - Registered name of the child workflow
   * @param input - Input data to pass to the child workflow
   * @param options - Optional child workflow configuration
   * @returns Promise that resolves with a `ChildWorkflowHandle`
   *
   * @example
   * Parallel execution:
   * ```typescript
   * const payment = await ctx.startChildWorkflow('process-payment', paymentData);
   * const inventory = await ctx.startChildWorkflow('reserve-inventory', inventoryData);
   *
   * await ctx.sleep(Duration.fromSeconds(10));
   *
   * const [paymentResult, inventoryResult] = await Promise.all([
   *   payment.result(),
   *   inventory.result(),
   * ]);
   * ```
   *
   * @example
   * With options:
   * ```typescript
   * const child = await ctx.startChildWorkflow('process-order', orderData, {
   *   workflowId: `order-${orderId}`,
   *   taskQueue: 'orders',
   *   timeout: Duration.fromMinutes(5),
   *   parentClosePolicy: ParentClosePolicy.ABANDON,
   * });
   * ```
   */
  async startChildWorkflow<T = any>(
    workflowName: string,
    input: any,
    options?: ChildWorkflowOptions
  ): Promise<ChildWorkflowHandle<T>> {
    const workflowType = this.getWorkflowName(workflowName);
    // Derive a deterministic ID from the step sequence (child_{sequence}),
    // consumed unconditionally so it stays in lockstep across replays, like
    // executeChildWorkflow and the Rust and Python SDKs. runId is derived from
    // it (informational only) so it does not consume values from ctx.random.
    const sequence = this.nextSequence();
    const workflowId = options?.workflowId || `child_${sequence}`;
    this.reachStep(workflowId);
    const runId = `run_${workflowId}`;

    // Emit StartChildWorkflow unless the child has already completed. This does
    // not suspend: the handle's result() suspends later, so several children
    // can be started before any is awaited.
    if (!this.state.pendingTaskResults.has(`child:${workflowId}`)) {
      const taskQueue = options?.taskQueue || this.execution.taskQueue;
      const parentClosePolicy = options?.parentClosePolicy || ParentClosePolicy.REQUEST_CANCEL;
      const command: StartChildWorkflowCommand = {
        type: WorkflowCommandType.START_CHILD_WORKFLOW,
        sequence,
        workflowId,
        workflowType,
        taskQueue,
        input,
        timeout: options?.timeout?.toMilliseconds(),
        parentClosePolicy,
      };
      this.addCommand(command);
    }

    // The handle shares this context, so its result() resolves from the same
    // `child:{id}` cache entry as executeChildWorkflow, and suspends if the
    // child has not completed.
    const handle = new ChildWorkflowHandle<T>(workflowId, runId, workflowType, this);
    this.state.childWorkflows.set(workflowId, handle);
    return handle;
  }

  /**
   * Send an event to a child this workflow started, once across replays.
   *
   * The engine keeps no record a worker could read for a send, so it runs as
   * an inline step: the first run issues the command and journals the step,
   * and a replay returns the journaled step without issuing it again.
   *
   * @internal Used by `ChildWorkflowHandle.sendEvent()`
   */
  async sendEventToChild(workflowId: string, eventName: string, payload: unknown): Promise<void> {
    EventHelpers.validateEventName(eventName);
    await this.execute(`send_event:${workflowId}:${eventName}`, async () => {
      const command: SendEventCommand = {
        type: WorkflowCommandType.SEND_EVENT,
        sequence: this.state.sequence,
        targetWorkflowId: workflowId,
        eventName,
        payload,
      };
      this.addCommand(command);
      return null;
    });
  }

  /**
   * Cancel a child this workflow started, once across replays; see
   * `sendEventToChild`.
   *
   * @internal Used by `ChildWorkflowHandle.cancel()`
   */
  async cancelChildWorkflow(workflowId: string): Promise<void> {
    await this.execute(`cancel_child:${workflowId}`, async () => {
      const command: CancelChildWorkflowCommand = {
        type: WorkflowCommandType.CANCEL_CHILD_WORKFLOW,
        sequence: this.state.sequence,
        workflowId,
      };
      this.addCommand(command);
      return null;
    });
  }

  /**
   * Get workflow name from string
   * @internal
   */
  private getWorkflowName(workflowRef: string): string {
    return workflowRef;
  }

  // ============================================================================
  // Restart Fresh
  // ============================================================================

  /**
   * Restart the workflow with a fresh execution history.
   *
   * Starts a new execution with the same workflow ID but an empty history,
   * which keeps long-running workflows from growing their history without bound.
   * It can be called once per execution.
   *
   * **Use cases:**
   * - Long-running workflows (cron jobs, subscriptions, entity workflows)
   * - History management (prevent unbounded event history)
   * - Code updates (periodically restart so the latest code is picked up)
   * - Entity pattern (workflows representing durable objects)
   *
   * **Behavior:**
   * - Same workflow ID, different run ID
   * - Fresh event history (no previous events)
   * - New deterministic state (random, time reset)
   * - State must be passed explicitly as input
   *
   * @param input - Input data for the new execution
   * @param options - Optional configuration for the new execution
   *
   * @throws {Error} If `restartFresh()` has already been called in this execution
   *
   * @example
   * Basic restart:
   * ```typescript
   * import { workflow, Duration, WorkflowContext } from '@orcher/sdk';
   *
   * export const subscriptionWorkflow = workflow({
   *   name: 'subscription-workflow',
   *   run: async (ctx: WorkflowContext, state: SubscriptionState) => {
   *     await ctx.executeTask(chargeCustomer, state);
   *     await ctx.executeTask(sendInvoice, state);
   *
   *     await ctx.sleep(Duration.fromDays(30));
   *
   *     // Carry the state into the next cycle explicitly
   *     ctx.restartFresh({ ...state, cycle: state.cycle + 1 });
   *   },
   * });
   * ```
   *
   * @example
   * Restart as a different workflow type:
   * ```typescript
   * ctx.restartFresh(order, {
   *   workflowType: 'order-workflow-v2',
   *   taskQueue: 'orders-v2',
   * });
   * ```
   */
  restartFresh(input: any, options?: RestartFreshOptions): void {
    // restartFresh is a terminal command.
    if (this.state.restartFreshCalled) {
      throw new Error('restartFresh() has already been called. This is a terminal command.');
    }

    const command: RestartFreshCommand = {
      type: WorkflowCommandType.RESTART_FRESH,
      sequence: this.nextSequence(),
      workflowType: options?.workflowType,
      input,
      taskQueue: options?.taskQueue,
      timeout: options?.timeout === undefined ? undefined : durationToMillis(options.timeout),
    };

    this.addCommand(command);
    this.state.restartFreshCalled = true;

    console.log(
      `Workflow ${this.execution.workflowId} restarting with fresh execution` +
        (options?.workflowType ? ` (new type: ${options.workflowType})` : '')
    );
  }

  /**
   * Check if restart fresh has been called
   *
   * @returns True if restartFresh() has been called
   *
   * @internal
   */
  isRestartFreshCalled(): boolean {
    return this.state.restartFreshCalled;
  }

  // ============================================================================
  // State Management
  // ============================================================================

  /**
   * Set a workflow state value.
   *
   * State is held in memory for the current activation and is not journaled.
   * It is rebuilt on replay because the workflow code that set it runs again,
   * so it must be derived only from deterministic inputs and step results.
   * Update handlers and queries can read it.
   *
   * @param key - State key
   * @param value - State value (must be JSON-serializable)
   *
   * @example
   * ```typescript
   * ctx.setState('orderStatus', { status: 'processing', step: 2 });
   * ctx.setState('attemptCount', 3);
   * ```
   */
  setState<T>(key: string, value: T): void {
    if (!key || key.trim().length === 0) {
      throw new Error('setState() requires a non-empty key');
    }

    this.state.workflowState.set(key, value);
  }

  /**
   * Get a workflow state value previously stored with `setState()`.
   *
   * @param key - State key
   * @returns State value or undefined if not found
   *
   * @example
   * ```typescript
   * const status = ctx.getState<OrderStatus>('orderStatus');
   * const count = ctx.getState<number>('attemptCount') ?? 0;
   * ```
   */
  getState<T>(key: string): T | undefined {
    if (!key || key.trim().length === 0) {
      throw new Error('getState() requires a non-empty key');
    }

    return this.state.workflowState.get(key) as T | undefined;
  }

  /**
   * Cache the workflow input so it can be reused when restarting fresh.
   *
   * @param input - Workflow input to cache
   *
   * @example
   * ```typescript
   * ctx.cacheInput(orderInput);
   * ```
   */
  cacheInput(input: any): void {
    this.state.cachedInput = input;
  }

  /**
   * Get the workflow input cached with `cacheInput()`.
   *
   * @returns Cached input or undefined
   *
   * @example
   * ```typescript
   * const originalInput = ctx.getCachedInput();
   * ```
   */
  getCachedInput<T>(): T | undefined {
    return this.state.cachedInput as T | undefined;
  }

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get the workflow ID
   *
   * @returns Unique workflow ID
   *
   * @example
   * ```typescript
   * console.log(`Processing workflow ${ctx.workflowId()}`);
   * ```
   */
  workflowId(): string {
    return this.execution.workflowId;
  }

  /**
   * Get the run ID
   *
   * @returns Unique run ID for this execution attempt
   *
   * @example
   * ```typescript
   * console.log(`Run ID: ${ctx.runId()}`);
   * ```
   */
  runId(): string {
    return this.execution.runId;
  }

  /**
   * Check if the workflow is replaying
   *
   * @returns True if replaying from history
   *
   * @example
   * ```typescript
   * if (!ctx.isReplaying()) {
   *   console.log('Fresh execution');
   * }
   * ```
   */
  isReplaying(): boolean {
    return this.state.replaying;
  }

  /**
   * Get the current attempt number
   *
   * @returns Attempt number (starts at 1)
   *
   * @example
   * ```typescript
   * if (ctx.attempt() > 3) {
   *   await ctx.executeTask(escalateIssue, order);
   * }
   * ```
   */
  attempt(): number {
    return this.execution.attempt;
  }

  /**
   * Get the workflow type name
   *
   * @returns Workflow type name, as given to `workflow()` or `@Workflow()`
   *
   * @example
   * ```typescript
   * console.log(`Workflow type: ${ctx.workflowType()}`);
   * ```
   */
  workflowType(): string {
    return this.execution.workflowType;
  }

  /**
   * Get the namespace
   *
   * @returns Namespace this workflow is running in
   *
   * @example
   * ```typescript
   * console.log(`Namespace: ${ctx.namespace()}`);
   * ```
   */
  namespace(): string {
    return this.execution.namespace;
  }

  /**
   * Get the task queue
   *
   * @returns Task queue this workflow is assigned to
   *
   * @example
   * ```typescript
   * console.log(`Task queue: ${ctx.taskQueue()}`);
   * ```
   */
  taskQueue(): string {
    return this.execution.taskQueue;
  }

  /**
   * The workflow's version string, a metadata label only.
   *
   * It is a plain identifier for metrics and inventory, not a replay-safety
   * mechanism: the engine does not gate or route replay by version. To change
   * workflow logic safely, run the new code under a new workflow name
   * (side by side) or reset the execution. Do not branch on this value.
   *
   * @returns Workflow version string
   */
  version(): string {
    return this._version;
  }

  // ============================================================================
  // Event Methods
  // ============================================================================

  /**
   * Wait for an external event.
   *
   * Suspends the workflow until the named event is received. If the event is
   * already buffered, returns it immediately.
   *
   * @param eventName - Name of the event to wait for
   * @returns Promise that resolves with the event payload
   *
   * @example
   * ```typescript
   * // Wait for approval event
   * const approval = await ctx.waitForEvent<ApprovalData>('approve');
   * if (approval.approved) {
   *   // Continue processing
   * }
   * ```
   */
  async waitForEvent<T = any>(eventName: string): Promise<T> {
    EventHelpers.validateEventName(eventName);

    // If event is already buffered (replay path), return it immediately.
    if (this.eventManager.getBuffer().has(eventName)) {
      return this.takeBufferedEvent(eventName) as T;
    }

    // Not buffered: push a WaitForEvent command and suspend.
    // The server releases the workflow claim (no proto command produced) so it
    // can be re-polled when SendEvent delivers an EventReceived journal entry.
    //
    // A wait is not an engine step (events are matched to waits by name), so
    // it takes no number from the step counter on any path. If parking took
    // one and finding the event did not, a step issued beside the wait would
    // get another id once the event had arrived. The sequence only labels the
    // command.
    const sequence = this.state.sequence;
    this.addCommand({
      type: WorkflowCommandType.WAIT_FOR_EVENT,
      sequence,
      stepId: `event_${eventName}_${sequence}`,
      eventName,
    } as any);

    this.suspend(`Waiting for event: ${eventName}`, [`event:${eventName}`]);
  }

  /**
   * Wait for an external event, with a timeout.
   *
   * Suspends the workflow until the named event is received or the timeout
   * elapses. Returns null if the timeout is reached before the event arrives.
   *
   * @param eventName - Name of the event to wait for
   * @param timeout - How long to wait, as a `Duration` or milliseconds
   * @returns Promise that resolves with the event payload, or null once the
   *   timeout has elapsed without the event. The deadline is a durable timer,
   *   so it holds across worker restarts and fires even while no worker is
   *   running the workflow.
   *
   * @example
   * ```typescript
   * // Wait for approval with 24-hour timeout
   * const approval = await ctx.waitForEventWithTimeout<ApprovalData>(
   *   'approve',
   *   Duration.fromHours(24)
   * );
   *
   * if (approval === null) {
   *   // Timed out
   *   await ctx.executeTask(escalateOrder, order);
   * } else if (approval.approved) {
   *   // Approved
   *   await ctx.executeTask(processOrder, order);
   * }
   * ```
   */
  async waitForEventWithTimeout<T = any>(
    eventName: string,
    timeout: DurationInput
  ): Promise<T | null> {
    EventHelpers.validateEventName(eventName);

    const timeoutMs = durationToMillis(timeout);
    if (timeoutMs <= 0) {
      throw new Error('Timeout must be greater than 0');
    }

    // The timeout is a durable timer raced against the event. The timer is a
    // real engine command with a working fire path; the wait itself produces
    // no engine command, so the timer is what makes "parked until either the
    // event or the deadline" true on the engine side.
    //
    // The timer id is derived from the event name and how many waits on that
    // name this activation has issued, and it is allocated before anything
    // else, on every path. Allocating it only when the wait parks would give
    // the next wait on the same name a different id on replay than it had
    // live, and that wait would then find an earlier wait's fired timer and
    // time out for no reason. It is deliberately not the step sequence: a
    // wait takes no number from the step counter on any path (see
    // `waitForEvent`).
    const timerId = this.eventTimeoutTimerId(eventName);
    // Reached on every path, whichever of the event and the deadline wins:
    // the journal holds this timer whenever an earlier activation parked here.
    this.reachStep(timerId);
    const fired = this.state.pendingTaskResults.get(`timer:${timerId}`);
    const timerFired = this.state.pendingTaskResults.has(`timer:${timerId}`);
    // A fired-timer marker without a position is treated as later than any
    // event, so a buffered event still wins.
    const firedAt =
      fired && typeof fired === 'object' && typeof fired.firedAt === 'number'
        ? (fired.firedAt as number)
        : Number.POSITIVE_INFINITY;

    // Whichever the journal shows first decides. An event that arrived after
    // the deadline fired stays buffered for the next wait: this wait already
    // timed out in an earlier activation, and a replay must not change that.
    if (this.eventManager.getBuffer().has(eventName)) {
      const eventAt = this.bufferedEventPositions.get(eventName)?.[0] ?? Number.NEGATIVE_INFINITY;
      if (!timerFired || eventAt < firedAt) {
        return this.takeBufferedEvent(eventName) as T;
      }
    }
    if (timerFired) {
      this.observe(`timer:${timerId}`);
      return null;
    }

    // Neither arrived yet: park on the event and start the deadline timer.
    // The timer is not canceled when the event wins; the engine's cancel only
    // journals the cancellation and the timer fires anyway, which costs one
    // harmless extra replay and nothing else.
    // The sequence fields only label the commands; the counter is not
    // advanced (see `waitForEvent`).
    const sequence = this.state.sequence;
    this.addCommand({
      type: WorkflowCommandType.WAIT_FOR_EVENT,
      sequence,
      stepId: `event_${eventName}_${sequence}`,
      eventName,
      timeoutMs,
    } as any);
    const timerCommand: StartTimerCommand = {
      type: WorkflowCommandType.START_TIMER,
      sequence,
      timerId,
      durationMs: timeoutMs,
    };
    this.addCommand(timerCommand);

    this.suspend(`Waiting for event (with timeout): ${eventName}`, [`event:${eventName}`, timerId]);
  }

  /**
   * Buffer an incoming event.
   *
   * The workflow executor calls this when an event is received from an external
   * source. Workflow code should not call it.
   *
   * @param eventName - Name of the event
   * @param payload - Event payload
   * @param position - The event's journal position among this activation's
   *   jobs. Omitted means "before everything", so the event wins any race
   *   with a deadline timer.
   *
   * @internal
   */
  bufferEvent(eventName: string, payload: any, position?: number, atMs?: number): void {
    this.eventManager.bufferEvent(eventName, payload);
    const positions = this.bufferedEventPositions.get(eventName) ?? [];
    positions.push(position ?? Number.NEGATIVE_INFINITY);
    this.bufferedEventPositions.set(eventName, positions);
    const times = this.bufferedEventTimes.get(eventName) ?? [];
    times.push(atMs);
    this.bufferedEventTimes.set(eventName, times);
  }

  /** Journal positions of buffered events, kept in step with the buffer. */
  private readonly bufferedEventPositions = new Map<string, number[]>();

  /** When each buffered event was journaled, kept in step with the buffer. */
  private readonly bufferedEventTimes = new Map<string, Array<number | undefined>>();

  /** Take the next buffered event for a name, keeping positions in step. The
   * workflow's clock moves to when the event was journaled. */
  private takeBufferedEvent(eventName: string): any {
    this.bufferedEventPositions.get(eventName)?.shift();
    const atMs = this.bufferedEventTimes.get(eventName)?.shift();
    if (atMs !== undefined) {
      this._time.advanceTo(atMs);
    }
    return this.eventManager.getBuffer().pop(eventName);
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  /**
   * Register a query handler.
   *
   * Query handlers let external systems inspect workflow state without
   * modifying it. Queries are read-only.
   *
   * @param name - Query name (must be unique)
   * @param handler - Query handler function
   * @param options - Optional query configuration
   *
   * @example
   * ```typescript
   * ctx.registerQueryHandler('getOrderStatus', () => {
   *   return ctx.getState('orderStatus') || 'pending';
   * });
   * ```
   *
   * @example
   * ```typescript
   * ctx.registerQueryHandler(
   *   'getOrderTotal',
   *   () => ctx.getState('total'),
   *   { cacheTtl: 60000 } // Cache for 1 minute
   * );
   * ```
   */
  registerQueryHandler<T>(name: string, handler: QueryHandler<T>, options?: QueryOptions): void {
    QueryHelpers.validateQueryName(name);
    this.queryManager.registerHandler(name, handler, options);
  }

  /**
   * Execute a registered query.
   *
   * The executor calls this when a client queries the workflow.
   * Query handlers should be synchronous and read-only.
   *
   * @param name - Query name
   * @param options - Query options
   * @returns Query result
   *
   * @internal
   */
  executeQuery<T>(name: string, options?: QueryOptions): T {
    const result = this.queryManager.executeQuery<T>(name, options);
    return result.value;
  }

  /**
   * Check whether a query handler is registered.
   *
   * @param name - Query name
   * @returns True if handler exists
   */
  hasQueryHandler(name: string): boolean {
    return this.queryManager.hasHandler(name);
  }

  /**
   * Get the names of all registered queries.
   *
   * @returns Array of query names
   */
  getQueryNames(): string[] {
    return this.queryManager.getQueryNames();
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Get next sequence number
   *
   * @internal
   */
  private nextSequence(): number {
    return this.state.sequence++;
  }

  /**
   * Add a command to the command queue
   *
   * @internal
   */
  private addCommand(command: WorkflowCommand): void {
    this.state.commands.push(command);
  }

  /** The id of every step the code reached this activation, in order. */
  private readonly reachedSteps: string[] = [];

  /**
   * Record that the code reached the step with this id: a task, a timer or a
   * child workflow, whether its outcome is already in the journal or its
   * command is issued now. sdk-core holds the activation to having reached
   * every step the journal recorded, which is how it tells that the code no
   * longer replays the run (see `takeReachedSteps`).
   *
   * @internal
   */
  reachStep(stepId: string): void {
    this.reachedSteps.push(stepId);
  }

  /**
   * The ids of the steps the code reached this activation, for the
   * activation's result. sdk-core compares them with the steps the journal
   * recorded: a recorded step left unreached by an activation that issues new
   * work or ends the workflow is reported as non-determinism, and the
   * activation is retried instead of applied.
   *
   * @internal Used by the executor
   */
  takeReachedSteps(): string[] {
    return this.reachedSteps.splice(0);
  }

  /**
   * Suspend the workflow until pending external work completes.
   *
   * Records that suspension was requested (so the executor can re-assert it even
   * if a user `try/catch` swallows the throw), then throws the suspension signal.
   * All suspension points (`executeTask`, `waitForEvent`, sessions, …) route
   * through here.
   *
   * @internal
   */
  private suspend(reason: string, pendingOperations: string[]): never {
    this.suspensionRequested = true;
    this.suspensionOps = pendingOperations;
    throw WorkflowError.suspended(reason, pendingOperations);
  }

  /**
   * Whether a suspension was requested during this activation. The executor uses
   * this to re-assert suspension when a workflow swallows the signal.
   *
   * @internal
   */
  wasSuspensionRequested(): boolean {
    return this.suspensionRequested;
  }

  /** Pending-operation ids from the most recent suspension request. @internal */
  pendingSuspensionOps(): string[] {
    return this.suspensionOps;
  }

  /**
   * Register automatic queries for observability
   *
   * @internal
   */
  private registerAutomaticQueries(): void {
    // Workflow identification queries
    this.registerQueryHandler('workflow_id', () => this.workflowId());
    this.registerQueryHandler('workflow_type', () => this.workflowType());
    this.registerQueryHandler('run_id', () => this.runId());
    this.registerQueryHandler('is_replaying', () => this.isReplaying());
    this.registerQueryHandler('attempt', () => this.attempt());
    this.registerQueryHandler('version', () => this.version());
    this.registerQueryHandler('namespace', () => this.namespace());
    this.registerQueryHandler('task_queue', () => this.taskQueue());

    // Comprehensive workflow info
    this.registerQueryHandler('workflow_info', () => ({
      workflowId: this.workflowId(),
      runId: this.runId(),
      workflowType: this.workflowType(),
      namespace: this.namespace(),
      taskQueue: this.taskQueue(),
      attempt: this.attempt(),
      version: this.version(),
      isReplaying: this.isReplaying(),
      restartFreshCalled: this.state.restartFreshCalled,
    }));

    // Restart fresh status query
    this.registerQueryHandler('restart_fresh_called', () => this.state.restartFreshCalled);
  }

  /**
   * Take all pending commands, leaving the queue empty. Used by the executor.
   *
   * @internal
   */
  takeCommands(): WorkflowCommand[] {
    const commands = this.state.commands;
    this.state.commands = [];
    // Closure results first, in the order the closures finished: the other
    // commands include any terminal command, which must come last, and a
    // closure can finish after the workflow issued one.
    const isClosureResult = (c: WorkflowCommand) =>
      c.type === WorkflowCommandType.RECORD_STEP_RESULT;
    return [...commands.filter(isClosureResult), ...commands.filter((c) => !isClosureResult(c))];
  }

  // ============================================================================
  // Replay Support Methods
  // ============================================================================

  /**
   * Inject a step result for replay.
   *
   * Populates the pendingTaskResults cache with results from the journal. When
   * a workflow resumes or replays, the engine sends cached results, which are
   * injected here before the workflow code runs.
   *
   * @param stepId - The step identifier (task_id or step_name)
   * @param result - The cached result to inject
   *
   * @internal Used by the service/executor during replay
   *
   * @example
   * ```typescript
   * // Before executing the workflow on replay:
   * for (const cachedResult of executionRequest.cachedResults) {
   *   ctx.injectStepResult(cachedResult.stepId, cachedResult.result);
   * }
   * ```
   */
  injectStepResult(stepId: string, result: any): void {
    this.state.pendingTaskResults.set(stepId, result);
  }

  /**
   * Record when the engine journaled each result this activation can hand the
   * workflow, keyed as the results are: a step's id, `timer:{id}`,
   * `child:{workflow id}`. Receiving one moves the workflow's clock there.
   *
   * @internal Used by the executor before the workflow runs
   */
  recordResolvedAt(resolvedAt: Record<string, number>): void {
    for (const [key, atMs] of Object.entries(resolvedAt)) {
      if (Number.isFinite(atMs)) {
        this.resolvedAt.set(key, atMs);
      }
    }
  }

  /** When each result was journaled; see `recordResolvedAt`. */
  private readonly resolvedAt = new Map<string, number>();

  /**
   * The workflow received what was journaled under `key`: its clock moves to
   * when that was journaled. A closure's result does not move it: the closure
   * ran inside the activation, which read the time before the result was
   * journaled, and a replay must read the same.
   */
  private observe(key: string): void {
    const atMs = this.resolvedAt.get(key);
    if (atMs !== undefined) {
      this._time.advanceTo(atMs);
    }
  }

  /**
   * Inject multiple step results for replay.
   *
   * @param results - Map of step ID to result
   *
   * @internal Used by the service/executor during replay
   */
  injectStepResults(results: Map<string, any> | Record<string, any>): void {
    if (results instanceof Map) {
      results.forEach((value, key) => {
        this.state.pendingTaskResults.set(key, value);
      });
    } else {
      Object.entries(results).forEach(([key, value]) => {
        this.state.pendingTaskResults.set(key, value);
      });
    }
  }

  /**
   * Set the replaying state. For tests.
   *
   * @param replaying - Whether the workflow is replaying
   *
   * @internal Used for testing replay behavior
   */
  setReplayingForTest(replaying: boolean): void {
    this.state.replaying = replaying;
  }

  /**
   * Get all commands without removing them from the internal state. For tests.
   *
   * @returns Array of commands
   *
   * @internal Used for testing
   */
  commandsForTest(): WorkflowCommand[] {
    return [...this.state.commands];
  }

  /**
   * Get a copy of all pending task results. For tests and debugging.
   *
   * @returns Map of step ID to cached result
   *
   * @internal Used for testing and debugging replay behavior
   */
  getPendingTaskResults(): Map<string, any> {
    return new Map(this.state.pendingTaskResults);
  }
}
