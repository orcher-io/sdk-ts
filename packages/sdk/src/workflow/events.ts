/**
 * Event handling for workflows.
 *
 * Events are asynchronous, named messages that external callers send to a
 * running workflow. This module buffers events that arrive before the workflow
 * waits for them, delivers them to waiters in order, and validates event names.
 *
 * @packageDocumentation
 */

import { WorkflowCommandType } from './context';
import { hasValidNameCharacters, NAME_RULE } from '../core/names';

/**
 * Command emitted when a workflow waits for an event.
 */
export interface WaitForEventCommand {
  type: WorkflowCommandType.WAIT_FOR_EVENT;
  sequence: number;
  eventName: string;
  timeoutMs?: number;
}

/**
 * Command emitted when a workflow sends an event to another workflow.
 */
export interface SendEventCommand {
  type: WorkflowCommandType.SEND_EVENT;
  sequence: number;
  targetWorkflowId: string;
  eventName: string;
  payload: any;
}

/**
 * A received event with its arrival time.
 */
export interface EventData {
  /** Event name */
  name: string;

  /** Event payload */
  payload: any;

  /** Timestamp when event was received */
  timestamp: number;
}

/**
 * Per-name FIFO queues of events that no waiter has consumed yet.
 */
export class EventBuffer {
  private buffer: Map<string, any[]> = new Map();

  /**
   * Add an event to the buffer
   *
   * @param eventName - Name of the event
   * @param payload - Event payload
   */
  add(eventName: string, payload: any): void {
    if (!this.buffer.has(eventName)) {
      this.buffer.set(eventName, []);
    }
    this.buffer.get(eventName)!.push(payload);
  }

  /**
   * Removes and returns the oldest buffered event with this name
   *
   * @param eventName - Name of the event
   * @returns Event payload or undefined if not found
   */
  pop(eventName: string): any | undefined {
    const events = this.buffer.get(eventName);
    if (!events || events.length === 0) {
      return undefined;
    }
    return events.shift();
  }

  /**
   * Returns whether an event with this name is buffered
   *
   * @param eventName - Name of the event
   * @returns True if event is buffered
   */
  has(eventName: string): boolean {
    const events = this.buffer.get(eventName);
    return events !== undefined && events.length > 0;
  }

  /**
   * Returns the buffered events for a name without removing them
   *
   * @param eventName - Name of the event
   * @returns Array of event payloads
   */
  peek(eventName: string): any[] {
    return this.buffer.get(eventName) || [];
  }

  /**
   * Returns the number of buffered events for a name
   *
   * @param eventName - Name of the event
   * @returns Count of buffered events
   */
  count(eventName: string): number {
    const events = this.buffer.get(eventName);
    return events ? events.length : 0;
  }

  /**
   * Removes all buffered events for a name
   *
   * @param eventName - Name of the event
   */
  clear(eventName: string): void {
    this.buffer.delete(eventName);
  }

  /**
   * Removes all buffered events
   */
  clearAll(): void {
    this.buffer.clear();
  }

  /**
   * Returns the names that have at least one buffered event
   *
   * @returns Array of event names
   */
  getEventNames(): string[] {
    return Array.from(this.buffer.keys()).filter(
      (name) => this.buffer.get(name)!.length > 0
    );
  }

  /**
   * Returns the number of buffered events across all names
   *
   * @returns Total count
   */
  totalCount(): number {
    let total = 0;
    for (const events of this.buffer.values()) {
      total += events.length;
    }
    return total;
  }
}

/**
 * Matches incoming events to waiting callers, buffering those nobody waits for.
 *
 * Each event goes to exactly one consumer: the oldest waiter for its name if
 * there is one, otherwise the buffer.
 */
export class EventManager {
  private buffer: EventBuffer;
  private waitingHandlers: Map<string, Array<(payload: any) => void>> = new Map();

  constructor() {
    this.buffer = new EventBuffer();
  }

  /**
   * Delivers an incoming event, or buffers it if nobody is waiting.
   *
   * If a caller is waiting for this name, the oldest one receives the event
   * immediately. Otherwise the event is buffered for a later wait.
   *
   * @param eventName - Name of the event
   * @param payload - Event payload
   */
  bufferEvent(eventName: string, payload: any): void {
    const handlers = this.waitingHandlers.get(eventName);
    if (handlers && handlers.length > 0) {
      // Oldest waiter first.
      const handler = handlers.shift()!;

      if (handlers.length === 0) {
        this.waitingHandlers.delete(eventName);
      }

      handler(payload);
    } else {
      this.buffer.add(eventName, payload);
    }
  }

  /**
   * Waits for the next event with this name.
   *
   * Consumes the oldest buffered event if there is one. Otherwise registers a
   * waiter that the next matching event resolves.
   *
   * @param eventName - Name of the event
   * @returns Promise that resolves with the event payload
   */
  async waitForEvent<T = any>(eventName: string): Promise<T> {
    if (this.buffer.has(eventName)) {
      return this.buffer.pop(eventName) as T;
    }

    return new Promise<T>((resolve) => {
      if (!this.waitingHandlers.has(eventName)) {
        this.waitingHandlers.set(eventName, []);
      }
      this.waitingHandlers.get(eventName)!.push(resolve);
    });
  }

  /**
   * Waits for the next event with this name, giving up after a timeout.
   *
   * The timeout is an in-process `setTimeout`, not a durable timer. On timeout
   * the waiter stays registered, so the next event with this name resolves the
   * abandoned wait and is neither buffered nor returned to a later caller.
   *
   * @param eventName - Name of the event
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise that resolves with the event payload, or null on timeout
   */
  async waitForEventWithTimeout<T = any>(
    eventName: string,
    timeoutMs: number
  ): Promise<T | null> {
    if (this.buffer.has(eventName)) {
      return this.buffer.pop(eventName) as T;
    }

    return Promise.race([
      this.waitForEvent<T>(eventName),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  /**
   * Returns the underlying event buffer
   *
   * @returns Event buffer
   */
  getBuffer(): EventBuffer {
    return this.buffer;
  }

  /**
   * Returns counts of buffered events and of names with waiters
   *
   * @returns Buffered event total, number of names with waiters, and the names
   *   that have buffered events
   */
  getStats(): {
    bufferedEvents: number;
    waitingHandlers: number;
    eventNames: string[];
  } {
    return {
      bufferedEvents: this.buffer.totalCount(),
      waitingHandlers: this.waitingHandlers.size,
      eventNames: this.buffer.getEventNames(),
    };
  }

  /**
   * Drops all buffered events and waiters. For tests.
   */
  clear(): void {
    this.buffer.clearAll();
    this.waitingHandlers.clear();
  }
}

/**
 * Helpers for event payloads and names.
 */
export class EventHelpers {
  /**
   * Parses a JSON string payload; returns any other value unchanged
   *
   * @param payload - Raw payload (JSON string or object)
   * @returns Deserialized payload
   */
  static deserialize<T>(payload: any): T {
    if (typeof payload === 'string') {
      return JSON.parse(payload) as T;
    }
    return payload as T;
  }

  /**
   * Serializes a payload to JSON; returns strings unchanged
   *
   * @param payload - Payload to serialize
   * @returns Serialized payload
   */
  static serialize(payload: any): string {
    if (typeof payload === 'string') {
      return payload;
    }
    return JSON.stringify(payload);
  }

  /**
   * Validates an event name
   *
   * @param eventName - Event name to validate
   * @throws Error if the name is empty, longer than 255 characters, or contains
   *   characters outside the allowed set
   */
  static validateEventName(eventName: string): void {
    if (!eventName || eventName.trim().length === 0) {
      throw new Error('Event name must be a non-empty string');
    }

    if (eventName.length > 255) {
      throw new Error('Event name must not exceed 255 characters');
    }

    if (!hasValidNameCharacters(eventName)) {
      throw new Error(
        `Event name must contain only ${NAME_RULE}`
      );
    }
  }

  /**
   * Builds an {@link EventData} stamped with the current wall-clock time
   *
   * @param name - Event name
   * @param payload - Event payload
   * @returns Event data
   */
  static createEventData(name: string, payload: any): EventData {
    return {
      name,
      payload,
      timestamp: Date.now(),
    };
  }
}
