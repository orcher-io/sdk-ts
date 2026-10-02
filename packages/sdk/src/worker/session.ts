/**
 * Worker-side session management.
 *
 * The `SessionManager` runs on each worker and handles:
 * - Slot-based session capacity management (prevents resource exhaustion)
 * - Session queue registration (tells the TaskDriver to poll new queues)
 * - Built-in task handlers for `__orcher_create_session` and `__orcher_complete_session`
 */

import { randomUUID } from 'crypto';
import {
  type SessionInfo,
  type CreateSessionInput,
  SessionState,
  buildSessionQueue,
} from '../workflow/session';

/** Metadata for an active session on this worker. */
interface SessionEntry {
  sessionId: string;
  sessionQueue: string;
  originalQueue: string;
}

/** Configuration for the worker's session manager. */
export interface SessionManagerOptions {
  /** Maximum concurrent sessions this worker can host. Default: 10. */
  maxSessions?: number;
}

/**
 * Worker-side session manager.
 *
 * Each worker has one `SessionManager` that controls how many concurrent
 * sessions it can host.
 */
export class SessionManager {
  private readonly resourceId: string;
  private readonly maxSessions: number;
  private availableSlots: number;
  private readonly activeSessions = new Map<string, SessionEntry>();

  /** Native module functions for session queue management. */
  private readonly addSessionQueueFn: (serviceHandle: any, queueName: string) => void;
  private readonly removeSessionQueueFn: (serviceHandle: any, queueName: string) => void;
  private readonly serviceHandle: any;

  constructor(
    serviceHandle: any,
    nativeModule: { addSessionQueue: Function; removeSessionQueue: Function },
    options: SessionManagerOptions = {},
  ) {
    this.resourceId = randomUUID();
    this.maxSessions = options.maxSessions ?? 10;
    this.availableSlots = this.maxSessions;
    this.serviceHandle = serviceHandle;
    this.addSessionQueueFn = nativeModule.addSessionQueue as any;
    this.removeSessionQueueFn = nativeModule.removeSessionQueue as any;

    console.log(
      `[SessionManager] Created: resourceId=${this.resourceId}, maxSessions=${this.maxSessions}`,
    );
  }

  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  get slotsAvailable(): number {
    return this.availableSlots;
  }

  /**
   * Handle the `__orcher_create_session` internal task.
   *
   * Takes a slot and starts polling a queue that only this worker serves.
   * Returns a `SessionInfo` object, serialized to JSON back to the workflow.
   *
   * @throws Error if every session slot is in use.
   */
  async handleCreateSession(rawInput: any, taskQueue: string): Promise<SessionInfo> {
    const inp: CreateSessionInput = {
      session_id: rawInput?.session_id ?? '',
      creation_timeout_ms: rawInput?.creation_timeout_ms ?? 30000,
      execution_timeout_ms: rawInput?.execution_timeout_ms ?? 600000,
      max_concurrent_tasks: rawInput?.max_concurrent_tasks ?? 1,
      heartbeat_interval_ms: rawInput?.heartbeat_interval_ms ?? 5000,
    };

    if (this.availableSlots <= 0) {
      throw new Error(
        `No session slots available (${this.maxSessions}/${this.maxSessions} in use)`,
      );
    }

    this.availableSlots--;
    const sessionQueue = buildSessionQueue(taskQueue, this.resourceId);

    const entry: SessionEntry = {
      sessionId: inp.session_id,
      sessionQueue,
      originalQueue: taskQueue,
    };
    this.activeSessions.set(inp.session_id, entry);

    // Notify TaskDriver to start polling the session queue
    this.addSessionQueueFn(this.serviceHandle, sessionQueue);

    console.log(
      `[SessionManager] Session created: sessionId=${inp.session_id}, queue=${sessionQueue}, availableSlots=${this.availableSlots}`,
    );

    return {
      session_id: inp.session_id,
      session_queue: sessionQueue,
      worker_identity: this.resourceId,
      state: SessionState.OPEN,
    };
  }

  /** Handle the `__orcher_complete_session` internal task. */
  async handleCompleteSession(rawInput: any): Promise<Record<string, never>> {
    const sessionId: string = rawInput?.session_id ?? '';

    const entry = this.activeSessions.get(sessionId);
    if (entry) {
      this.activeSessions.delete(sessionId);
      this.availableSlots++;

      // Notify TaskDriver to stop polling the session queue
      this.removeSessionQueueFn(this.serviceHandle, entry.sessionQueue);

      console.log(
        `[SessionManager] Session completed: sessionId=${sessionId}, queue=${entry.sessionQueue}, availableSlots=${this.availableSlots}`,
      );
    } else {
      console.warn(`[SessionManager] Attempted to complete unknown session: ${sessionId}`);
    }

    return {};
  }

  /** Force-close all active sessions (e.g., during worker shutdown). */
  closeAll(): void {
    const sessions = Array.from(this.activeSessions.values());
    for (const entry of sessions) {
      try {
        this.removeSessionQueueFn(this.serviceHandle, entry.sessionQueue);
      } catch {
        // Best effort: the worker is shutting down, so a queue that fails to
        // stop polling here is not actionable.
      }
    }

    const count = sessions.length;
    this.activeSessions.clear();
    this.availableSlots = this.maxSessions;

    if (count > 0) {
      console.log(`[SessionManager] Force-closed ${count} active sessions during shutdown`);
    }
  }
}
