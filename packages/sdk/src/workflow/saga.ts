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
 * If a compensation fails, the others still run and a
 * {@link SagaCompensationError} is thrown once they have.
 *
 * @packageDocumentation
 */

import { ErrorCode, WorkflowError, isWorkflowSuspension } from '../errors';

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

/**
 * A saga's compensations ran, and at least one of them failed.
 *
 * Every compensation still runs when one fails; this reports the ones that
 * failed once all have run. Thrown by {@link Saga.compensate}, and by a failed
 * saga step whose compensating failed, which then carries the step's own
 * failure as `stepFailure` (and as `cause`).
 */
export class SagaCompensationError extends WorkflowError {
  /** The names of the compensations that failed, in the order they ran. */
  readonly failed: string[];
  /** The first failed compensation's error, as text. */
  readonly reason: string;
  /**
   * The failure of the saga step that started the compensating, or
   * `undefined` when the workflow compensated the saga itself.
   */
  readonly stepFailure: unknown;

  constructor(failed: string[], reason: string, stepFailure?: unknown) {
    const first = failed[0] ?? 'unknown';
    let message =
      failed.length > 1
        ? `Saga compensation failed: ${failed.length} compensations failed, the first '${first}': ${reason}`
        : `Saga compensation failed: compensation '${first}' failed: ${reason}`;
    if (stepFailure !== undefined) {
      message += `; the compensating followed a failed step: ${describe(stepFailure)}`;
    }
    super(message, ErrorCode.WORKFLOW_INVALID_STATE, { failed: [...failed], reason });
    this.name = 'SagaCompensationError';
    Object.setPrototypeOf(this, SagaCompensationError.prototype);
    this.failed = [...failed];
    this.reason = reason;
    this.stepFailure = stepFailure;
    if (stepFailure !== undefined) {
      (this as { cause?: unknown }).cause = stepFailure;
    }
  }
}

/** A thrown value as text, for an error message. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
   * error is re-thrown. If a compensation fails too, all of them still run and
   * a {@link SagaCompensationError} is thrown instead, carrying the action's
   * error as `stepFailure`: an undo left half done must not read as a clean
   * one.
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
      try {
        await this.compensate();
      } catch (compensationErr) {
        if (compensationErr instanceof SagaCompensationError) {
          throw new SagaCompensationError(compensationErr.failed, compensationErr.reason, err);
        }
        throw compensationErr;
      }
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
   * A compensation that throws does not stop the others: every one runs, and
   * then a {@link SagaCompensationError} is thrown, naming the ones that
   * failed and the first failure. Idempotent — once the saga has completed
   * (committed or compensated) this is a no-op, so it is safe to call from a
   * `catch`/`finally` even if a step already triggered it.
   *
   * Durable suspension is re-thrown so the executor can schedule the
   * compensation task and replay.
   *
   * @returns The number of compensations that ran, when none failed.
   * @throws {SagaCompensationError} If a compensation failed.
   */
  async compensate(): Promise<number> {
    if (this.completed) return 0;
    this.completed = true;

    let count = 0;
    const failed: string[] = [];
    let firstFailure: unknown;
    for (let i = this.compensations.length - 1; i >= 0; i--) {
      const step = this.compensations[i]!;
      try {
        await step.run();
        count++;
      } catch (err) {
        if (isSuspend(err)) throw err;
        console.warn(`[orcher:saga] Compensation failed for step '${step.name}':`, err);
        if (failed.length === 0) firstFailure = err;
        failed.push(step.name);
      }
    }
    if (failed.length > 0) {
      throw new SagaCompensationError(failed, describe(firstFailure));
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
