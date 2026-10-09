/**
 * The contract workflow/task catalog (TypeScript).
 *
 * Mirrors the Rust/Python catalogs: the same workflow and task names, and the
 * same JSON result shapes, so one `scenarios.json` drives every SDK's worker.
 * Each workflow returns a JSON-able result describing the durable behavior it
 * observed; the harness asserts only on that client-observable outcome.
 */
import {
  Actor,
  Duration,
  ExecutionErrorCode,
  Operation,
  Saga,
  WorkflowError,
  isWorkflowCancellation,
  task,
  workflow,
  type ActorContext,
  type TaskContext,
  type WorkflowContext,
} from '@orcher/sdk';

/** A task that always fails once (no retries). */
export const alwaysFail = task<Record<string, never>, unknown>({
  name: 'always_fail',
  retryPolicy: { maxAttempts: 1 },
  execute: async (_ctx: TaskContext): Promise<unknown> => {
    throw new Error('intentional contract failure');
  },
});

/** Always fails, declared with three attempts so the engine retries to exhaustion. */
export const alwaysFailRetried = task<Record<string, never>, unknown>({
  name: 'always_fail_retried',
  retryPolicy: { maxAttempts: 3 },
  execute: async (_ctx: TaskContext): Promise<unknown> => {
    throw new Error('intentional contract failure (retried)');
  },
});

/** A failure the retry policies below name as non-retryable. */
class CardDeclined extends Error {}

/** A failure no retry policy here names. */
class Throttled extends Error {}

/** A failure raised as non-retryable, whatever the policy lists. */
class AccountClosed extends Error {
  readonly nonRetryable = true;
}

const listsCardDeclined = { maxAttempts: 3, nonRetryableErrorTypes: ['CardDeclined'] };

/** Fails with a type its retry policy lists as non-retryable, so it runs once. */
export const declineCard = task<Record<string, never>, unknown>({
  name: 'decline_card',
  retryPolicy: listsCardDeclined,
  execute: async (_ctx: TaskContext): Promise<unknown> => {
    throw new CardDeclined('card declined');
  },
});

/** Fails with a type its policy does not list, so it is retried to exhaustion. */
export const throttle = task<Record<string, never>, unknown>({
  name: 'throttle',
  retryPolicy: listsCardDeclined,
  execute: async (_ctx: TaskContext): Promise<unknown> => {
    throw new Throttled('slow down');
  },
});

/** Fails marked non-retryable under an unlisted type: the mark alone decides. */
export const closeAccount = task<Record<string, never>, unknown>({
  name: 'close_account',
  retryPolicy: { maxAttempts: 3 },
  execute: async (_ctx: TaskContext): Promise<unknown> => {
    throw new AccountClosed('account closed');
  },
});

/** Runs `t` to its durable outcome; reports whether it failed and after how many attempts. */
async function attemptsUntilFailure(
  ctx: WorkflowContext,
  t: Parameters<WorkflowContext['executeTask']>[0]
): Promise<unknown> {
  try {
    await ctx.executeTask(t, {});
  } catch (e) {
    const err = e as { code?: string; details?: { taskType?: string; attempts?: number } };
    // Suspension is the durable-execution control signal: re-throw it, never handle it.
    if (err?.code === 'WORKFLOW_SUSPENDED') {
      throw e;
    }
    return {
      caught: true,
      task_type: err?.details?.taskType ?? '',
      attempts: err?.details?.attempts ?? 0,
    };
  }
  return { caught: false, task_type: '', attempts: 0 };
}

/** A failure whose type the policy lists as non-retryable is not retried. */
export const taskNonRetryableListed = workflow<unknown, unknown>({
  name: 'task_non_retryable_listed',
  run: (ctx: WorkflowContext) => attemptsUntilFailure(ctx, declineCard),
});

/** A failure raised as non-retryable is not retried. */
export const taskNonRetryableMarked = workflow<unknown, unknown>({
  name: 'task_non_retryable_marked',
  run: (ctx: WorkflowContext) => attemptsUntilFailure(ctx, closeAccount),
});

/** A failure whose type the policy does not list is retried as usual. */
export const taskUnlistedRetried = workflow<unknown, unknown>({
  name: 'task_unlisted_retried',
  run: (ctx: WorkflowContext) => attemptsUntilFailure(ctx, throttle),
});

/** Trivial round-trip: returns its input unchanged. */
export const echo = workflow<unknown, unknown>({
  name: 'echo',
  run: async (_ctx: WorkflowContext, input: unknown): Promise<unknown> => input,
});

/** Runs a task that fails, catches the durable task failure, reports what it observed. */
export const catchTaskFailure = workflow<unknown, unknown>({
  name: 'catch_task_failure',
  run: async (ctx: WorkflowContext): Promise<unknown> => {
    try {
      await ctx.executeTask(alwaysFail, {});
    } catch (e) {
      const err = e as { code?: string; details?: { taskType?: string } };
      // `ctx.executeTask` throws a WORKFLOW_SUSPENDED signal (a WorkflowError) to
      // pause the workflow until the task completes. It must be re-thrown, not
      // handled, or durability breaks. Only a real task failure is caught below.
      if (err?.code === 'WORKFLOW_SUSPENDED') {
        throw e;
      }
      // WorkflowError.taskFailed carries { taskType, attempts, reason } in `details`.
      return { caught: true, task_type: err?.details?.taskType ?? '' };
    }
    // The task unexpectedly succeeded. Return an observable result so the harness
    // assertion (which expects caught=true) flags it, rather than failing the workflow.
    return { caught: false, task_type: '' };
  },
});

/**
 * Runs a task until its retries are exhausted and reports how many attempts the
 * failure says it took. Guards the attempt count specifically: a worker that drops
 * it still reports a failure, and every other assertion in this suite still passes.
 */
export const taskRetriesExhausted = workflow<unknown, unknown>({
  name: 'task_retries_exhausted',
  run: async (ctx: WorkflowContext): Promise<unknown> => {
    try {
      await ctx.executeTask(alwaysFailRetried, {});
    } catch (e) {
      const err = e as { code?: string; details?: { taskType?: string; attempts?: number } };
      // Suspension is the durable-execution control signal: re-throw it, never handle it.
      if (err?.code === 'WORKFLOW_SUSPENDED') {
        throw e;
      }
      return {
        caught: true,
        task_type: err?.details?.taskType ?? '',
        attempts: err?.details?.attempts ?? 0,
      };
    }
    return { caught: false, task_type: '', attempts: 0 };
  },
});

/** Returns its input value under `echoed`. Exercises task-input round-tripping. */
export const echoTask = task<{ value: unknown }, unknown>({
  name: 'echo_task',
  execute: async (_ctx: TaskContext, input: { value: unknown }): Promise<unknown> => ({
    echoed: input.value,
  }),
});

/** Passes a value through a task and back. Guards that a task receives its input. */
export const taskInputRoundtrip = workflow<{ value: unknown }, unknown>({
  name: 'task_input_roundtrip',
  run: async (ctx: WorkflowContext, input: { value: unknown }): Promise<unknown> =>
    ctx.executeTask(echoTask, { value: input.value }),
});

/** A child workflow: echoes what it received and doubles it. */
export const contractChild = workflow<{ n: number }, unknown>({
  name: 'contract_child',
  run: async (_ctx: WorkflowContext, input: { n: number }): Promise<unknown> => {
    const n = typeof input === 'object' && input !== null ? input.n : (input as unknown as number);
    return { child_saw: n, doubled: n * 2 };
  },
});

/**
 * Starts a child workflow, waits for its result, and returns it. Guards the
 * full child-workflow round trip: StartChildWorkflow emission, child execution,
 * and the completion decode that resumes the parent. The child must run exactly
 * once; a parent replay must correlate with the existing child, not start it
 * again. An explicit workflowId keeps the child's correlation id stable.
 */
export const parentStartsChild = workflow<{ n: number }, unknown>({
  name: 'parent_starts_child',
  run: async (ctx: WorkflowContext, input: { n: number }): Promise<unknown> =>
    ctx.executeChildWorkflow('contract_child', input),
});

/** A child workflow that always fails. Exercises child-failure propagation. */
export const failingChild = workflow<unknown, unknown>({
  name: 'failing_child',
  run: async (): Promise<unknown> => {
    throw new Error('intentional child failure');
  },
});

/** Starts a failing child, catches the child failure, and reports it. */
export const parentCatchesChildFailure = workflow<unknown, unknown>({
  name: 'parent_catches_child_failure',
  run: async (ctx: WorkflowContext): Promise<unknown> => {
    try {
      await ctx.executeChildWorkflow('failing_child', {});
    } catch (e) {
      const err = e as { code?: string; name?: string };
      // executeChildWorkflow throws a WORKFLOW_SUSPENDED signal on first
      // execution to pause the parent. It must be re-thrown, not handled.
      if (err?.code === 'WORKFLOW_SUSPENDED') {
        throw e;
      }
      // Any other error here is the decoded child failure.
      return { child_failed: true };
    }
    return { child_failed: false };
  },
});

/**
 * Starts two child workflows in parallel, then awaits both. Both
 * StartChildWorkflow commands are emitted before either result is awaited,
 * because startChildWorkflow does not suspend. Guards the handle path
 * (startChildWorkflow + handle.result) and the engine's idempotent child start.
 */
export const parentTwoChildrenParallel = workflow<unknown, unknown>({
  name: 'parent_two_children_parallel',
  run: async (ctx: WorkflowContext): Promise<unknown> => {
    const a = await ctx.startChildWorkflow('contract_child', { n: 10 });
    const b = await ctx.startChildWorkflow('contract_child', { n: 20 });
    const first = (await a.result()) as { doubled: number };
    const second = (await b.result()) as { doubled: number };
    return { first: first.doubled, second: second.doubled };
  },
});

/**
 * Restarts fresh once (a new execution with new input and an empty history),
 * then completes. Guards restart-fresh persistence and that the client
 * following the original execution receives the continued execution's result.
 * `restartFresh` records a terminal RestartFresh command and returns void; the
 * trailing return value is discarded once the restart command is emitted.
 */
export const restartOnce = workflow<{ count?: number }, unknown>({
  name: 'restart_once',
  run: async (ctx: WorkflowContext, input: { count?: number }): Promise<unknown> => {
    const count = input?.count ?? 0;
    if (count === 0) {
      ctx.restartFresh({ count: 1 });
      return { restarted: true, count: 0 };
    }
    return { restarted: true, count };
  },
});

/**
 * Sleeps on a durable timer, then completes. Guards the durable-timer round trip:
 * StartTimer emission, the engine firing the timer, and the FireTimer correlation
 * that resumes the workflow by the business timer id on replay.
 */
export const sleepOnce = workflow<unknown, unknown>({
  name: 'sleep_once',
  run: async (ctx: WorkflowContext): Promise<unknown> => {
    await ctx.sleep(Duration.fromSeconds(1));
    return { slept: true };
  },
});

/** Echoes back the heartbeat timeout the task was actually given.
 *
 * Guards the whole declaration loop: the workflow declares a limit, the engine
 * records it, and the worker hands it back to the handler. If any layer drops
 * the value, the task still runs, so without this check a declared heartbeat
 * timeout could silently become none. */
export const timeoutsEchoTask = task<Record<string, never>, unknown>({
  name: 'timeouts_echo_task',
  execute: async (ctx: TaskContext): Promise<unknown> => {
    const hb = ctx.heartbeatTimeout();
    return { heartbeat_secs: hb === undefined ? null : Math.round(hb / 1000) };
  },
});

export const taskTimeoutsEcho = workflow<unknown, unknown>({
  name: 'task_timeouts_echo',
  run: async (ctx: WorkflowContext): Promise<unknown> =>
    ctx.executeTask(timeoutsEchoTask, {}, { heartbeatTimeout: Duration.fromSeconds(15) }),
});

/** Throws the SDK's typed workflow error.
 *
 * The assertion is that the message survives the trip. If the engine cannot
 * parse the failure kind, it rejects the whole completion and the caller is
 * told about an enum variant instead of what went wrong. A plain "expect a
 * failure" assertion would still pass in that case, so the message is checked. */
export const typedFailure = workflow<unknown, unknown>({
  name: 'typed_failure',
  run: async (): Promise<unknown> => {
    throw new WorkflowError(
      'deliberate contract failure',
      ExecutionErrorCode.WORKFLOW_EXECUTION_FAILED
    );
  },
});

// --- Event catalog -----------------------------------------------------------
//
// These cover the wait-for-event path end to end: the activation that parks
// must be accepted, a client must be able to address the parked workflow to
// wake it, and the engine must not re-dispatch the parked workflow while it
// waits for the event.
//
// Observation is in-process, like the actor gauges: the driver runs the worker,
// so the catalog can tell it when a workflow has actually parked and how many
// times the engine activated it. Both are keyed by the `key` the scenario
// passes as input, because the engine hands the worker its own internal id as
// the workflow id, which the driver never sees.

/** Set when the workflow has issued its wait and is about to suspend. */
export const parkedWorkflows = new Set<string>();

/** Activations per key: every time the engine ran the workflow function,
 * replays included. A parked workflow should be activated a handful of times
 * (park, wake, complete), not hundreds. */
export const activations = new Map<string, number>();

function recordActivation(key: string): number {
  const n = (activations.get(key) ?? 0) + 1;
  activations.set(key, n);
  return n;
}

/**
 * Parks on `contract_event`, then returns the payload it received together
 * with how many times it was activated to get there.
 *
 * Guards the whole event round trip: the parking activation is accepted by
 * the engine, the parked workflow stays parked (one activation, not a storm),
 * a client can wake it by workflow id alone, and the replay consumes the
 * journaled event and completes.
 */
export const waitForEventEcho = workflow<{ key: string }, unknown>({
  name: 'wait_for_event_echo',
  run: async (ctx: WorkflowContext, input: { key: string }): Promise<unknown> => {
    const count = recordActivation(input.key);
    parkedWorkflows.add(input.key);
    const received = await ctx.waitForEvent<unknown>('contract_event');
    return { received, activations: count };
  },
});

/**
 * Parks on `contract_event` with a two-second timeout that nobody satisfies,
 * and reports whether the timeout fired.
 *
 * The deadline is a durable timer the SDK starts beside the wait and races
 * against the event on replay, so the engine fires it even while no worker
 * holds the workflow.
 */
export const waitForEventTimeout = workflow<{ key: string }, unknown>({
  name: 'wait_for_event_timeout',
  run: async (ctx: WorkflowContext, input: { key: string }): Promise<unknown> => {
    recordActivation(input.key);
    parkedWorkflows.add(input.key);
    const received = await ctx.waitForEventWithTimeout<unknown>(
      'contract_event',
      Duration.fromSeconds(2)
    );
    return { received, timed_out: received === null };
  },
});

// --- Actor catalog -----------------------------------------------------------
//
// `contract_probe` verifies the shared/exclusive scheduling contract
// end-to-end: declared mode -> handler registration -> engine resolution ->
// dispatch. Concurrency is observed via in-process gauges (module state): the
// engine dispatches both operations to this same worker process, so a gauge
// crossing 2 proves true overlap. Gauges are transient by design: durable
// actor state can't hold them because shared operations must stay read-only
// (the engine rejects their writes; that rejection is itself a scenario).

let exclusiveInFlight = 0;

// Monotonic count of rendezvous entries per actor key. Monotonic (rather than
// an in-flight gauge) so the first entrant still observes the second even if
// the second checks, returns, and exits between the first's polls.
const rendezvousEntered = new Map<string, number>();

const RENDEZVOUS_DEADLINE_MS = 5_000;
const RENDEZVOUS_POLL_MS = 25;
const EXCLUSIVE_HOLD_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Probe actor observing the scheduler's shared/exclusive behavior. */
@Actor({ name: 'contract_probe' })
export class ContractProbe {
  /**
   * Waits until a second shared invocation has entered on this worker.
   *
   * If shared operations dispatch concurrently (correct), the second
   * invocation enters while the first is still waiting, so both observe an
   * entry count of 2 and return `observed_concurrent: true`. If the scheduler
   * wrongly serializes them, the first invocation exhausts the deadline
   * before the second can enter and reports false.
   */
  @Operation({ name: 'shared_rendezvous', mode: 'shared' })
  async sharedRendezvous(ctx: ActorContext): Promise<unknown> {
    const key = ctx.key;
    rendezvousEntered.set(key, (rendezvousEntered.get(key) ?? 0) + 1);

    let waited = 0;
    let observed = (rendezvousEntered.get(key) ?? 0) >= 2;
    while (!observed && waited < RENDEZVOUS_DEADLINE_MS) {
      await sleep(RENDEZVOUS_POLL_MS);
      waited += RENDEZVOUS_POLL_MS;
      observed = (rendezvousEntered.get(key) ?? 0) >= 2;
    }
    return { observed_concurrent: observed };
  }

  /** Holds the key briefly and reports whether any peer overlapped. */
  @Operation({ name: 'exclusive_probe', mode: 'exclusive' })
  async exclusiveProbe(_ctx: ActorContext): Promise<unknown> {
    exclusiveInFlight += 1;
    try {
      let alone = exclusiveInFlight === 1;
      await sleep(EXCLUSIVE_HOLD_MS);
      alone = alone && exclusiveInFlight === 1;
      return { alone };
    } finally {
      exclusiveInFlight -= 1;
    }
  }

  /** Attempts a state write from a read-only operation; expects rejection. */
  @Operation({ name: 'shared_write_attempt', mode: 'shared' })
  async sharedWriteAttempt(ctx: ActorContext): Promise<unknown> {
    try {
      await ctx.state.set('probe', 'should-be-rejected');
      return { write_rejected: false };
    } catch (e) {
      // The engine rejects writes during a shared window (FAILED_PRECONDITION).
      return { write_rejected: true, error: String(e).slice(0, 200) };
    }
  }

  /** Control: exclusive writes must succeed and round-trip. */
  @Operation({ name: 'exclusive_write_roundtrip', mode: 'exclusive' })
  async exclusiveWriteRoundtrip(ctx: ActorContext, input: { value: string }): Promise<unknown> {
    await ctx.state.set('value', input.value);
    const read = await ctx.state.get<string>('value');
    return { write_ok: read === input.value, value: read ?? '' };
  }
}

// --- Worker liveness ---------------------------------------------------------

/** How many times this worker process has started the task, by workflow id:
 * a task timed out and retried here runs twice. */
const runs = new Map<string, number>();

/** Sleeps `sleep_secs` with no heartbeat code of its own, and says how many
 * times it has run for its workflow and whether the sleep outlasted the
 * heartbeat timeout it was held to. Only the worker's own heartbeats keep it
 * alive meanwhile. */
export const sleepPastHeartbeatTimeout = task<{ sleep_secs: number }, unknown>({
  name: 'sleep_past_heartbeat_timeout',
  execute: async (ctx: TaskContext, input: { sleep_secs: number }): Promise<unknown> => {
    const run = (runs.get(ctx.workflowId()) ?? 0) + 1;
    runs.set(ctx.workflowId(), run);
    await new Promise((r) => setTimeout(r, input.sleep_secs * 1000));
    const hb = ctx.heartbeatTimeout();
    return {
      runs: run,
      heartbeat_timeout_given: hb !== undefined,
      outlived_heartbeat_timeout: hb !== undefined && input.sleep_secs * 1000 > hb,
    };
  },
});

/** Runs a task that declares no timeouts for longer than its heartbeat timeout. */
export const outliveHeartbeatTimeout = workflow<{ sleep_secs: number }, unknown>({
  name: 'outlive_heartbeat_timeout',
  run: async (ctx: WorkflowContext, input: { sleep_secs: number }): Promise<unknown> =>
    ctx.executeTask(sleepPastHeartbeatTimeout, { sleep_secs: input.sleep_secs }),
});

/** Takes its worker process down when run by a worker started with
 * `ORCHER_CONTRACT_DOOMED_WORKER` set, as a worker dying mid-task would;
 * completes on any other. */
export const exitIfWorkerDoomed = task<Record<string, never>, unknown>({
  name: 'exit_if_worker_doomed',
  retryPolicy: { maxAttempts: 3 },
  execute: async (): Promise<unknown> => {
    if (process.env.ORCHER_CONTRACT_DOOMED_WORKER) {
      process.stderr.write('contract: exit_if_worker_doomed is taking its worker down\n');
      process.exit(3);
    }
    return { survived_worker_death: true };
  },
});

/** Runs a task that takes a doomed worker down with it; completes once the
 * task has run to the end on another. */
export const crashMidTask = workflow<unknown, unknown>({
  name: 'crash_mid_task',
  run: async (ctx: WorkflowContext): Promise<unknown> => ctx.executeTask(exitIfWorkerDoomed, {}),
});

// ---------------------------------------------------------------------------
// Cancellation: a cancelled workflow is told, once, and may clean up.
// ---------------------------------------------------------------------------

/** Cleanup long enough to be heartbeated. Reports whether it was told to stop:
 * work started after a cancellation request is cleanup, and the engine must let
 * it finish. */
export const cancelCleanup = task<Record<string, never>, string>({
  name: 'cancel_cleanup',
  retryPolicy: { maxAttempts: 1 },
  execute: async (ctx: TaskContext): Promise<string> => {
    const started = Date.now();
    while (Date.now() - started < 2_500) {
      if (ctx.isCancelled()) return 'interrupted';
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return 'cleaned';
  },
});

/** A step a saga can undo. */
export const cancelReserve = task<Record<string, never>, string>({
  name: 'cancel_reserve',
  retryPolicy: { maxAttempts: 1 },
  execute: async (): Promise<string> => 'reserved',
});

/** Undoes `cancel_reserve`. */
export const cancelRelease = task<Record<string, never>, string>({
  name: 'cancel_release',
  retryPolicy: { maxAttempts: 1 },
  execute: async (): Promise<string> => 'released',
});

/** Parks on a long sleep and lets the cancellation it is told of end it. */
export const cancelSleep = workflow<{ key: string }, string>({
  name: 'cancel_sleep',
  run: async (ctx: WorkflowContext, input: { key: string }): Promise<string> => {
    parkedWorkflows.add(input.key);
    await ctx.sleep(Duration.fromMinutes(10));
    return 'slept';
  },
});

/** Parks on a long sleep; when told it is cancelled, runs cleanup and returns,
 * which ends it completed. */
export const cancelCleanupWorkflow = workflow<{ key: string }, unknown>({
  name: 'cancel_cleanup',
  run: async (ctx: WorkflowContext, input: { key: string }): Promise<unknown> => {
    parkedWorkflows.add(input.key);
    try {
      await ctx.sleep(Duration.fromMinutes(10));
    } catch (e) {
      if (!isWorkflowCancellation(e)) throw e;
      const cleanup = await ctx.executeTask(cancelCleanup, {});
      return { told: ctx.isCancelRequested(), cleanup };
    }
    throw new Error('the sleep finished; the cancellation never arrived');
  },
});

/** Reserves, then parks; when told it is cancelled, compensates the
 * reservation and reports how many compensations ran. */
export const cancelSaga = workflow<{ key: string }, unknown>({
  name: 'cancel_saga',
  run: async (ctx: WorkflowContext, input: { key: string }): Promise<unknown> => {
    const saga = new Saga();
    await saga.addStep(
      () => ctx.executeTask(cancelReserve, {}),
      () => ctx.executeTask(cancelRelease, {})
    );
    parkedWorkflows.add(input.key);
    try {
      await ctx.sleep(Duration.fromMinutes(10));
    } catch (e) {
      // Only the cancellation: suspension and anything else pass through, so
      // the compensation runs because of the request and nothing else.
      if (!isWorkflowCancellation(e)) throw e;
      const compensated = await saga.compensate();
      return { compensated };
    }
    throw new Error('the sleep finished; the cancellation never arrived');
  },
});
