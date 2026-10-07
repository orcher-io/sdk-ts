/**
 * Saga pattern support for the Orcher TypeScript SDK.
 *
 * Provides {@link Saga}, an imperative, register-as-you-go helper for
 * compensating transactions, with the same shape as the Rust and Python SDKs.
 * Each step has an *action* and a *compensation*; if a later step fails, the
 * compensations for the steps that already completed run in reverse order (LIFO).
 *
 * There are two ways to register a step, and the difference matters:
 *
 * - {@link Saga.addStep} runs the action and registers its compensation in a
 *   single call. Use it when the compensation does **not** need the action's
 *   result.
 * - {@link Saga.addCompensation} registers a compensation for an action you
 *   ran yourself. Use it when the compensation needs data the action produced
 *   (an id, a token) — run the action, then register a compensation that
 *   closes over the result.
 *
 * @example
 * ```ts
 * import { Saga, isWorkflowSuspension } from '@orcher/sdk';
 *
 * // bookingTasks = createTaskRefs(BookingTasks), paymentTasks = createTaskRefs(PaymentTasks)
 * const saga = new Saga();
 * try {
 *   // Fluent: the compensation is static (doesn't need the result).
 *   const hotel = await saga.addStep(
 *     () => ctx.executeTask(bookingTasks.bookHotel, req),
 *     () => ctx.executeTask(bookingTasks.cancelHotel, req),
 *   );
 *
 *   // Manual: the compensation needs the action's output.
 *   const charge = await ctx.executeTask(paymentTasks.charge, { amount: 100 });
 *   saga.addCompensation(() => ctx.executeTask(paymentTasks.refund, { chargeId: charge.id }));
 *
 *   saga.commit();
 * } catch (err) {
 *   // `ctx.executeTask` suspends the workflow by throwing, and this `catch`
 *   // sees that too. It is not a failure: re-throw it before compensating,
 *   // or a healthy workflow undoes its own steps.
 *   if (isWorkflowSuspension(err)) throw err;
 *   await saga.compensate();
 *   throw err;
 * }
 * ```
 *
 * @packageDocumentation
 */

import { isWorkflowSuspension } from '../errors';

/**
 * Whether a thrown value is the durable *suspension* signal rather than a real
 * error. Suspension is control flow: `ctx.executeTask`/`ctx.execute`/timers
 * throw `WorkflowError.suspended()` to hand control back to the executor so it
 * can schedule work and replay the workflow. Combinators that catch errors
 * (sagas, races, retries) MUST re-throw this untouched — never treat it as a
 * failed step.
 *
 * Matched by code, as {@link isWorkflowSuspension} does, not by class: a
 * signal from a second copy of the SDK (a CommonJS and an ES module build
 * loaded side by side) is not an `instanceof` this copy's `WorkflowError`,
 * and taking it for a failure would compensate a healthy workflow.
 */
const isSuspend = isWorkflowSuspension;

/** A registered compensation for a completed saga step. */
interface Compensation {
  name: string;
  run: () => Promise<unknown>;
}

/**
 * Manages compensating transactions for a workflow.
 *
 * The saga tracks completed steps and their compensations. If a step fails,
 * the compensations registered so far run in reverse order. State lives only
 * in memory for the current execution — because compensations are ordinary
 * tasks (`ctx.executeTask(...)`), replay rebuilds the saga and any already-run
 * compensations return their journaled results.
 */
export class Saga {
  private compensations: Compensation[] = [];
  private completed = false;
  private stepsRegistered = 0;

  /**
   * Run `action` and, on success, register `compensation`.
   *
   * Returns the action's result. If the action throws a genuine error, all
   * compensations registered so far run in reverse order and the original
   * error is re-thrown.
   *
   * Durable suspension is control flow, not a failure: it is re-thrown
   * untouched so the executor can schedule the task and replay. Compensating on
   * suspension would undo prior successful steps on a healthy workflow.
   *
   * @param action - Async function performing the forward action.
   * @param compensation - Async function that undoes the action. Omit for
   *   read-only steps that need no compensation.
   * @param opts - Optional `{ name }` for logging.
   * @returns The action's result.
   */
  async addStep<T>(
    action: () => Promise<T>,
    compensation?: () => Promise<unknown>,
    opts?: { name?: string }
  ): Promise<T> {
    const stepName = opts?.name ?? `step_${this.stepsRegistered + 1}`;
    let result: T;
    try {
      result = await action();
    } catch (err) {
      if (isSuspend(err)) throw err;
      await this.compensate();
      throw err;
    }
    this.stepsRegistered += 1;
    if (compensation) {
      this.compensations.push({ name: stepName, run: compensation });
    }
    return result;
  }

  /**
   * Register a compensation for an action you executed yourself.
   *
   * Use this when the compensation needs data produced by the action — an id,
   * a booking reference, a token — that only exists after it runs:
   *
   * ```ts
   * // paymentTasks = createTaskRefs(PaymentTasks)
   * const charge = await ctx.executeTask(paymentTasks.charge, { amount: 100 });
   * saga.addCompensation(() => ctx.executeTask(paymentTasks.refund, { chargeId: charge.id }));
   * ```
   */
  addCompensation(compensation: () => Promise<unknown>, opts?: { name?: string }): void {
    this.stepsRegistered += 1;
    const stepName = opts?.name ?? `step_${this.stepsRegistered}`;
    this.compensations.push({ name: stepName, run: compensation });
  }

  /**
   * Run all registered compensations in reverse order (LIFO).
   *
   * Best-effort: if a compensation throws a real error it is logged and the
   * remaining compensations still run. Idempotent — once the saga has completed
   * (committed or compensated) this is a no-op, so it is safe to call from a
   * `catch`/`finally` even if a step already triggered it.
   *
   * Durable suspension is re-thrown so the executor can schedule the
   * compensation task and replay.
   *
   * @returns The number of compensations that ran successfully.
   */
  async compensate(): Promise<number> {
    if (this.completed) return 0;
    this.completed = true;

    let count = 0;
    for (let i = this.compensations.length - 1; i >= 0; i--) {
      const step = this.compensations[i]!;
      try {
        await step.run();
        count++;
      } catch (err) {
        if (isSuspend(err)) throw err;
        console.warn(`[orcher:saga] Compensation failed for step '${step.name}':`, err);
      }
    }
    return count;
  }

  /** Mark the saga as successfully completed so no compensations run. */
  commit(): void {
    this.completed = true;
  }

  /** Whether the saga has completed (committed or compensated). */
  get isCompleted(): boolean {
    return this.completed;
  }

  /** Number of steps registered on this saga. */
  get stepsExecuted(): number {
    return this.stepsRegistered;
  }

  /** Number of compensations that would run if the saga fails now. */
  get pendingCompensations(): number {
    return this.compensations.length;
  }
}

/**
 * Alias of {@link Saga}, so code importing `SagaBuilder` gets the same class.
 * Prefer `Saga`.
 */
export const SagaBuilder = Saga;
export type SagaBuilder = Saga;
