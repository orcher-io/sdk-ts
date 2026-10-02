/**
 * Test clock for deterministic workflow tests.
 *
 * @module @orcher/sdk/testing/time/controller
 */

import type { MockTimer, TimeAdvanceOptions } from '../types';

/**
 * Test clock that only moves when the test moves it.
 *
 * Timers created on it, including every workflow `sleep` and delayed task mock, fire only when
 * `advance()` or `advanceTo()` passes their due time, so time-dependent workflows run
 * deterministically and without real waiting.
 *
 * @example
 * ```typescript
 * const controller = new TimeController();
 *
 * // Start at specific time
 * controller.setTime(new Date('2025-01-01T00:00:00Z'));
 *
 * // Fast-forward time
 * await controller.advance(5000); // 5 seconds
 *
 * // Get current time
 * console.log(controller.now()); // 2025-01-01T00:00:05Z
 * ```
 */
export class TimeController {
  private currentTime: Date;
  private readonly timers: Map<string, MockTimer> = new Map();
  private timerIdCounter: number = 0;
  private readonly pendingTimers: Set<string> = new Set();

  constructor(initialTime?: Date) {
    this.currentTime = initialTime ?? new Date();
  }

  /**
   * Get current time.
   *
   * @returns Current time in test environment
   *
   * @example
   * ```typescript
   * const now = controller.now();
   * console.log(now.toISOString());
   * ```
   */
  now(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Set current time to specific value.
   *
   * No timers fire, even ones whose due time the new value passes.
   *
   * @param time - New current time
   *
   * @example
   * ```typescript
   * controller.setTime(new Date('2025-01-01T12:00:00Z'));
   * ```
   */
  setTime(time: Date): void {
    this.currentTime = new Date(time);
  }

  /**
   * Advance time by specified milliseconds.
   *
   * Fires every timer that falls due during the advance, in due order. With `runAllTimers`,
   * timers still pending afterwards also fire, without moving the clock further. With
   * `runNextTimer`, the clock jumps to the next pending timer and fires it.
   *
   * @param ms - Milliseconds to advance
   * @param options - Advance options
   *
   * @example
   * ```typescript
   * // Advance 5 seconds
   * await controller.advance(5000);
   *
   * // Advance and run all timers
   * await controller.advance(10000, { runAllTimers: true });
   * ```
   */
  async advance(ms: number, options: TimeAdvanceOptions = {}): Promise<void> {
    const targetTime = new Date(this.currentTime.getTime() + ms);

    await this.advanceIncremental(targetTime);

    if (options.runAllTimers) {
      await this.runAllPendingTimers();
    } else if (options.runNextTimer) {
      await this.runNextTimer();
    }
  }

  /**
   * Advance time to specific date.
   *
   * @param targetTime - Target time
   * @param options - Advance options, as for `advance()`
   * @throws {Error} If `targetTime` is before the current time
   *
   * @example
   * ```typescript
   * await controller.advanceTo(new Date('2025-01-01T00:00:00Z'));
   * ```
   */
  async advanceTo(targetTime: Date, options: TimeAdvanceOptions = {}): Promise<void> {
    const ms = targetTime.getTime() - this.currentTime.getTime();
    if (ms < 0) {
      throw new Error('Cannot advance to a time in the past');
    }
    await this.advance(ms, options);
  }

  /**
   * Walk the clock forward to `targetTime`, firing timers in due order.
   *
   * The clock stops at each timer's due time before firing it, and the code the
   * timer wakes gets to run before the next timer is considered. A workflow
   * that sleeps in a loop therefore sees every wake-up it would see against a
   * real clock: the timer it sets after waking is due inside the same advance
   * and fires in turn. Jumping straight to the target would fire only the
   * timers that existed beforehand, all at the target time, so a loop would
   * wake once and then wait on a timer the advance had already passed.
   */
  private async advanceIncremental(targetTime: Date): Promise<void> {
    // Let code started before the advance reach its first timer.
    await flushPendingWork();

    for (;;) {
      const nextTimer = this.getNextTimer();
      if (!nextTimer || nextTimer.fireAt > targetTime) {
        break;
      }
      if (nextTimer.fireAt > this.currentTime) {
        this.currentTime = new Date(nextTimer.fireAt);
      }
      await this.fireTimer(nextTimer.id);
      await flushPendingWork();
    }

    if (targetTime > this.currentTime) {
      this.currentTime = targetTime;
    }
  }

  /**
   * Create a timer that fires after specified duration.
   *
   * @param durationMs - Duration in milliseconds
   * @param callback - Callback to execute when timer fires
   * @returns Timer ID
   *
   * @example
   * ```typescript
   * const timerId = controller.createTimer(5000, () => {
   *   console.log('Timer fired!');
   * });
   * ```
   */
  createTimer(durationMs: number, callback: () => void | Promise<void>): string {
    const id = this.generateTimerId();
    const fireAt = new Date(this.currentTime.getTime() + durationMs);

    const timer: MockTimer = {
      id,
      callback,
      fireAt,
      fired: false,
      cancelled: false,
    };

    this.timers.set(id, timer);
    this.pendingTimers.add(id);

    return id;
  }

  /**
   * Cancel a timer. Has no effect on a timer that already fired.
   *
   * @param timerId - Timer ID to cancel
   *
   * @example
   * ```typescript
   * const timerId = controller.createTimer(5000, callback);
   * controller.cancelTimer(timerId);
   * ```
   */
  cancelTimer(timerId: string): void {
    const timer = this.timers.get(timerId);
    if (timer && !timer.fired) {
      timer.cancelled = true;
      this.pendingTimers.delete(timerId);
    }
  }

  /**
   * Fire a timer unless it already fired or was canceled. An error from the callback is logged
   * and rethrown.
   */
  private async fireTimer(timerId: string): Promise<void> {
    const timer = this.timers.get(timerId);
    if (!timer || timer.fired || timer.cancelled) {
      return;
    }

    timer.fired = true;
    this.pendingTimers.delete(timerId);

    try {
      await timer.callback();
    } catch (error) {
      console.error(`Error firing timer ${timerId}:`, error);
      throw error;
    }
  }

  /**
   * Fire all pending timers regardless of their due time, without moving the clock.
   */
  private async runAllPendingTimers(): Promise<void> {
    const pending = Array.from(this.pendingTimers);
    for (const timerId of pending) {
      await this.fireTimer(timerId);
    }
  }

  /**
   * Move the clock to the next pending timer and fire it.
   */
  private async runNextTimer(): Promise<void> {
    const nextTimer = this.getNextTimer();
    if (nextTimer) {
      this.currentTime = new Date(nextTimer.fireAt);
      await this.fireTimer(nextTimer.id);
    }
  }

  /**
   * Get the pending timer with the earliest due time.
   */
  private getNextTimer(): MockTimer | undefined {
    const pending = Array.from(this.pendingTimers)
      .map((id) => this.timers.get(id))
      .filter((timer): timer is MockTimer => timer !== undefined && !timer.cancelled);

    if (pending.length === 0) {
      return undefined;
    }

    return pending.reduce((earliest, timer) =>
      timer.fireAt < earliest.fireAt ? timer : earliest
    );
  }

  /**
   * Wait for a duration of test time.
   *
   * The promise resolves when an advance passes the due time. A workflow's `ctx.sleep` in the
   * test environment waits here.
   *
   * @param ms - Duration in milliseconds
   *
   * @example
   * ```typescript
   * const done = controller.sleep(5000);
   * await controller.advance(5000);
   * await done;
   * ```
   */
  async sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.createTimer(ms, resolve);
    });
  }

  /**
   * Get count of pending timers.
   *
   * @returns Number of pending timers
   *
   * @example
   * ```typescript
   * console.log(`Pending timers: ${controller.getPendingTimerCount()}`);
   * ```
   */
  getPendingTimerCount(): number {
    return this.pendingTimers.size;
  }

  /**
   * Get all pending timers.
   *
   * @returns Array of pending timers
   *
   * @example
   * ```typescript
   * const pending = controller.getPendingTimers();
   * pending.forEach(timer => {
   *   console.log(`Timer ${timer.id} fires at ${timer.fireAt}`);
   * });
   * ```
   */
  getPendingTimers(): MockTimer[] {
    return Array.from(this.pendingTimers)
      .map((id) => this.timers.get(id))
      .filter((timer): timer is MockTimer => timer !== undefined);
  }

  /**
   * Get all timers (pending and fired).
   *
   * @returns Array of all timers
   */
  getAllTimers(): MockTimer[] {
    return Array.from(this.timers.values());
  }

  /**
   * Clear all timers. Code waiting on a cleared timer never resumes.
   *
   * @example
   * ```typescript
   * controller.clearTimers();
   * ```
   */
  clearTimers(): void {
    this.timers.clear();
    this.pendingTimers.clear();
  }

  /**
   * Reset the clock and clear all timers.
   *
   * @param initialTime - Time to reset to (defaults to the current wall-clock time)
   *
   * @example
   * ```typescript
   * controller.reset();
   * ```
   */
  reset(initialTime?: Date): void {
    this.currentTime = initialTime ?? new Date();
    this.clearTimers();
    this.timerIdCounter = 0;
  }

  /**
   * Generate a timer ID of the form `timer-<counter>`.
   */
  private generateTimerId(): string {
    this.timerIdCounter++;
    return `timer-${this.timerIdCounter}`;
  }

  /**
   * Get summary of time controller state.
   *
   * @returns Human-readable summary
   *
   * @example
   * ```typescript
   * console.log(controller.getSummary());
   * // Current Time: 2025-01-01T12:00:00.000Z
   * // Pending Timers: 3
   * // Total Timers: 10
   * ```
   */
  getSummary(): string {
    return [
      `Current Time: ${this.currentTime.toISOString()}`,
      `Pending Timers: ${this.pendingTimers.size}`,
      `Total Timers: ${this.timers.size}`,
    ].join('\n');
  }
}

/**
 * Create a new time controller.
 *
 * @param initialTime - Optional initial time (defaults to the current time)
 * @returns New time controller instance
 *
 * @example
 * ```typescript
 * const controller = createTimeController(new Date('2025-01-01T00:00:00Z'));
 * ```
 */
export function createTimeController(initialTime?: Date): TimeController {
  return new TimeController(initialTime);
}

/**
 * Resolve once everything already queued has run: promise continuations and
 * the macrotasks ahead of this one. That is how long code woken by a timer
 * needs to reach its next await on the test clock.
 */
function flushPendingWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
