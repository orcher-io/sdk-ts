/**
 * Workflow time, read from the journal.
 *
 * @packageDocumentation
 */

/**
 * Time helper for workflows, available as `ctx.time`.
 *
 * Workflows must make the same decisions when replayed after crashes or
 * restarts. `Date.now()` and `new Date()` return a different value on replay;
 * this clock is read from the workflow's journal instead. It starts at the
 * moment the engine journaled the workflow's start, and moves forward only
 * when the workflow receives something it waited for: a task's result, a fired
 * timer, a child's outcome or an event. It then reads as the moment the engine
 * journaled that, and never moves back.
 *
 * A closure run with `ctx.execute()` does not move it: the closure runs inside
 * the activation and its result is journaled only afterwards, so a replay
 * would read a later time after it than the run that executed it.
 *
 * Every value comes from the journal, so a replay reads the same time at each
 * point in the code as the original run, on any machine and however much
 * later, and the workflow may branch on it. Code that reads the time inside
 * one branch of a `Promise.all` may see a sibling branch's result move it,
 * depending on which branches had resolved.
 *
 * @example
 * Stamp records with the workflow's time, and escalate a slow payment:
 * ```typescript
 * // orderTasks = createTaskRefs(OrderTasks)
 * export const orderWorkflow = workflow({
 *   name: 'order-workflow',
 *   run: async (ctx: WorkflowContext, order: Order) => {
 *     const receivedAt = ctx.time.now();
 *
 *     await ctx.executeTask(orderTasks.processPayment, order);
 *     if (ctx.time.hasElapsed(5 * 60 * 1000)) {
 *       await ctx.executeTask(orderTasks.sendAlert, { message: 'Slow payment' });
 *     }
 *
 *     return { orderId: order.id, receivedAt: receivedAt.toISOString() };
 *   },
 * });
 * ```
 */
export class WorkflowTime {
  private readonly _startTimeMs: number;
  private _nowMs: number;

  /**
   * Creates a clock for a workflow that started at `startTimeMs`. It reads
   * `startTimeMs` until moved.
   *
   * @param startTimeMs - Workflow start time in milliseconds since the Unix epoch
   * @throws Error if `startTimeMs` is negative or not finite
   *
   * @internal
   * WorkflowContext creates this instance. Workflow code uses `ctx.time`.
   */
  constructor(startTimeMs: number) {
    if (!Number.isFinite(startTimeMs) || startTimeMs < 0) {
      throw new Error('WorkflowTime requires a valid start time in milliseconds');
    }
    this._startTimeMs = startTimeMs;
    this._nowMs = startTimeMs;
  }

  /**
   * Moves the clock forward to `atMs`. A time earlier than the clock's is
   * ignored, so results received out of journal order cannot move it back.
   *
   * @internal The workflow context calls this as the workflow receives results.
   */
  advanceTo(atMs: number): void {
    if (Number.isFinite(atMs) && atMs > this._nowMs) {
      this._nowMs = atMs;
    }
  }

  /**
   * Returns the workflow's current time.
   *
   * That is when the engine journaled the latest thing the workflow has waited
   * for and received, or its start before it has received anything. It does
   * not change while the workflow code runs between two such points, and it is
   * the same at this point in the code on every replay.
   *
   * @returns The workflow's current time
   *
   * @example
   * ```typescript
   * await ctx.executeTask(orderTasks.saveOrder, {
   *   ...order,
   *   createdAt: ctx.time.now().toISOString(),
   * });
   * ```
   */
  now(): Date {
    return new Date(this._nowMs);
  }

  /**
   * Returns when the workflow started. Unlike {@link now}, it never moves.
   *
   * @returns The workflow start time
   */
  startedAt(): Date {
    return new Date(this._startTimeMs);
  }

  /**
   * Returns the workflow start time in milliseconds since the Unix epoch.
   *
   * @returns Start time in milliseconds since the Unix epoch
   *
   * @example
   * Derive a deadline that is the same on every replay:
   * ```typescript
   * const deadline = new Date(ctx.time.startTimeMs() + 24 * 60 * 60 * 1000);
   * ```
   */
  startTimeMs(): number {
    return this._startTimeMs;
  }

  /**
   * Returns the workflow's current time as an ISO 8601 string.
   *
   * @returns ISO 8601 formatted timestamp of {@link now}
   */
  toISOString(): string {
    return this.now().toISOString();
  }

  /**
   * Returns the milliseconds from the workflow's start to its current time,
   * both read from the journal.
   *
   * @returns Elapsed milliseconds since workflow start
   *
   * @example
   * ```typescript
   * await ctx.executeTask(orderTasks.processPayment, order);
   * if (ctx.time.elapsed() > 4 * 60 * 1000) {
   *   await ctx.executeTask(orderTasks.sendWarning, { orderId: order.id });
   * }
   * ```
   */
  elapsed(): number {
    return this._nowMs - this._startTimeMs;
  }

  /**
   * Returns the whole seconds from the workflow's start to its current time.
   *
   * @returns Elapsed seconds since workflow start, rounded down
   */
  elapsedSecs(): number {
    return Math.floor(this.elapsed() / 1000);
  }

  /**
   * Returns whether at least `durationMs` has passed between the workflow's
   * start and its current time.
   *
   * @param durationMs - Duration to check in milliseconds
   * @returns True if the duration has elapsed
   * @throws Error if `durationMs` is negative or not finite
   */
  hasElapsed(durationMs: number): boolean {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('hasElapsed requires a non-negative duration in milliseconds');
    }
    return this.elapsed() >= durationMs;
  }

  /**
   * Returns the milliseconds left until `timeoutMs` after the workflow's start,
   * at its current time; 0 once that has passed.
   *
   * @param timeoutMs - Timeout duration in milliseconds
   * @returns Remaining milliseconds (0 if the timeout passed)
   * @throws Error if `timeoutMs` is negative or not finite
   */
  remainingMs(timeoutMs: number): number {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('remainingMs requires a non-negative timeout in milliseconds');
    }
    return Math.max(0, timeoutMs - this.elapsed());
  }

  /**
   * Returns the whole seconds left until `timeoutSecs` after the workflow's
   * start, at its current time; 0 once that has passed.
   *
   * @param timeoutSecs - Timeout duration in seconds
   * @returns Remaining seconds (0 if the timeout passed)
   * @throws Error if `timeoutSecs` is negative or not finite
   */
  remainingSecs(timeoutSecs: number): number {
    if (!Number.isFinite(timeoutSecs) || timeoutSecs < 0) {
      throw new Error('remainingSecs requires a non-negative timeout in seconds');
    }
    return Math.max(0, timeoutSecs - this.elapsedSecs());
  }
}
