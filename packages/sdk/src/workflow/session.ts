/**
 * Worker sessions, which pin a series of tasks to one worker.
 *
 * A session guarantees that related tasks run on the same worker. Use one when a
 * task leaves something behind on the worker that later tasks need:
 * - **GPU/ML workloads**: a model loaded into worker memory is reused by later inference tasks
 * - **File processing**: download, transform, and upload must run where the file is
 * - **Connection-heavy tasks**: the worker holds database connections or other local state
 *
 * @example
 * ```typescript
 * const session = await ctx.createSession({
 *   creationTimeout: 30_000,
 *   executionTimeout: 600_000,
 * });
 *
 * const model = await session.executeTask(loadModel, { name: 'bert-base' });
 * const result = await session.executeTask(runInference, { data: inputData });
 *
 * session.complete();
 * ```
 */

import type { WorkflowContext } from './context';
import { WorkflowCommandType, type ScheduleTaskCommand } from './context';
import type { TaskReference } from '../di/types';

/**
 * Internal task type names and the session queue separator. They must match the
 * values used by sdk-core and the other Orcher SDKs exactly.
 */
export const SESSION_CREATE_TASK = '__orcher_create_session';
export const SESSION_COMPLETE_TASK = '__orcher_complete_session';
export const SESSION_QUEUE_SEPARATOR = '__session__';

/** Configuration for creating a worker session. */
export interface SessionOptions {
  /** Maximum time (ms) to wait for a worker to accept the session. Default: 30000. */
  creationTimeout?: number;
  /** Total session lifetime (ms). Default: 600000. */
  executionTimeout?: number;
  /** Maximum concurrent tasks within the session. Default: 1. */
  maxConcurrentTasks?: number;
  /** Heartbeat interval (ms) for session liveness detection. Default: 5000. */
  heartbeatInterval?: number;
}

/** Session lifecycle state. */
export enum SessionState {
  OPEN = 'open',
  CLOSED = 'closed',
  FAILED = 'failed',
}

/** Metadata about an active session, returned by the session creation task. */
export interface SessionInfo {
  session_id: string;
  session_queue: string;
  worker_identity: string;
  state: string;
}

/** Input payload for the __orcher_create_session internal task. */
export interface CreateSessionInput {
  session_id: string;
  creation_timeout_ms: number;
  execution_timeout_ms: number;
  max_concurrent_tasks: number;
  heartbeat_interval_ms: number;
}

/** Input payload for the __orcher_complete_session internal task. */
export interface CompleteSessionInput {
  session_id: string;
}

/**
 * A context wrapper that routes all tasks to a session's worker-specific queue.
 *
 * Created by {@link WorkflowContext.createSession}. All `executeTask` calls
 * through this context override `taskQueue` to the session's exclusive queue,
 * guaranteeing execution on the same worker.
 */
export class SessionContext {
  private _info: SessionInfo & { state: SessionState };

  constructor(
    private readonly ctx: WorkflowContext,
    info: SessionInfo,
  ) {
    this._info = { ...info, state: SessionState.OPEN };
  }

  /**
   * Execute a registered task on the session's pinned worker.
   *
   * Behaves identically to {@link WorkflowContext.executeTask} except the task
   * is routed to the session's worker-specific queue.
   */
  async executeTask<I, O>(taskRef: TaskReference<I, O>, input: I): Promise<O> {
    if (this._info.state !== SessionState.OPEN) {
      throw new Error(
        `Cannot execute task on session '${this._info.session_id}': state is ${this._info.state}`,
      );
    }

    // Route the next executeTask to the session queue.
    (this.ctx as any).state.taskQueueOverride = this._info.session_queue;
    try {
      return await this.ctx.executeTask(taskRef, input);
    } finally {
      // executeTask clears the override when it schedules the task. Clearing it
      // here too covers the paths that return or throw before that point, such
      // as a cached result on replay.
      (this.ctx as any).state.taskQueueOverride = undefined;
    }
  }

  /** Mark the session as completed and release the worker's session slot. */
  complete(): void {
    if (this._info.state !== SessionState.OPEN) {
      console.warn(
        `Attempted to complete session '${this._info.session_id}' that is not open (state=${this._info.state})`,
      );
      return;
    }

    this._info.state = SessionState.CLOSED;

    const inputData: CompleteSessionInput = { session_id: this._info.session_id };

    // A step like any other: one number from the workflow's step counter.
    const sequence: number = (this.ctx as any).nextSequence();
    const taskId = `${SESSION_COMPLETE_TASK}_${sequence}`;
    this.ctx.reachStep(taskId);

    const command: ScheduleTaskCommand = {
      type: WorkflowCommandType.SCHEDULE_TASK,
      sequence,
      taskId,
      taskType: SESSION_COMPLETE_TASK,
      taskQueue: this._info.session_queue,
      input: inputData,
    };

    (this.ctx as any).addCommand(command);
  }

  /** Metadata for this session. */
  get info(): SessionInfo {
    return this._info;
  }

  /** Whether the session still accepts tasks. */
  get isOpen(): boolean {
    return this._info.state === SessionState.OPEN;
  }

  /** The session ID. */
  get sessionId(): string {
    return this._info.session_id;
  }

  /** Identity of the worker the session is pinned to. */
  get workerIdentity(): string {
    return this._info.worker_identity;
  }

  /** The worker-specific queue that the session's tasks are routed to. */
  get sessionQueue(): string {
    return this._info.session_queue;
  }
}

/** Build a session queue name from the original queue and worker resource ID. */
export function buildSessionQueue(originalQueue: string, workerResourceId: string): string {
  return `${originalQueue}${SESSION_QUEUE_SEPARATOR}${workerResourceId}`;
}

/** Check if a queue name is a session queue. */
export function isSessionQueue(queue: string): boolean {
  return queue.includes(SESSION_QUEUE_SEPARATOR);
}

/** Extract the original queue name from a session queue name. */
export function originalQueueFromSession(sessionQueue: string): string | undefined {
  return sessionQueue.split(SESSION_QUEUE_SEPARATOR)[0];
}
