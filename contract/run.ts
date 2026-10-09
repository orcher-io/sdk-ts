/**
 * Cross-SDK contract harness: the TypeScript worker and driver.
 *
 * Starts a worker serving the shared contract catalog, then replays every
 * scenario in `scenarios.json` against a live engine and asserts the terminal
 * status and returned result match `expect`. Every assertion is purely
 * client-observable (terminal state + returned JSON), so the same `scenarios.json`
 * drives the Rust and Python workers identically.
 *
 * Usage (against an already-running engine on :50051):
 *   npx ts-node --project contract/tsconfig.json contract/run.ts
 *
 * Exits non-zero if any scenario fails.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { Client, Worker, WorkflowIdReusePolicy } from '@orcher/sdk';

// The catalog is imported for its named exports below. Importing it also
// self-registers its task()/workflow() handlers with the global
// registry, which the worker collects at start.
import {
  alwaysFail,
  alwaysFailRetried,
  catchTaskFailure,
  closeAccount,
  contractChild,
  declineCard,
  echo,
  echoTask,
  failingChild,
  parentCatchesChildFailure,
  parentStartsChild,
  parentTwoChildrenParallel,
  restartOnce,
  sleepOnce,
  taskInputRoundtrip,
  taskNonRetryableListed,
  taskNonRetryableMarked,
  taskRetriesExhausted,
  taskTimeoutsEcho,
  taskUnlistedRetried,
  throttle,
  timeoutsEchoTask,
  typedFailure,
  waitForEventEcho,
  waitForEventTimeout,
  parkedWorkflows,
  activations,
  sleepPastHeartbeatTimeout,
  outliveHeartbeatTimeout,
  exitIfWorkerDoomed,
  crashMidTask,
  cancelSleep,
  cancelCleanupWorkflow,
  cancelSaga,
  cancelCleanup,
  cancelReserve,
  cancelRelease,
} from './catalog';
import { execSync, spawn, type ChildProcess } from 'child_process';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural match: every field in `expected` must be present and deep-equal in
 * `actual`. Extra fields in `actual` are ignored, so a scenario asserts only the
 * fields it lists. */
function jsonMatches(expected: unknown, actual: unknown): boolean {
  if (isObject(expected) && isObject(actual)) {
    return Object.entries(expected).every(([k, v]) => k in actual && jsonMatches(v, actual[k]));
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return expected.length === actual.length && expected.every((e, i) => jsonMatches(e, actual[i]));
  }
  return expected === actual;
}

interface Scenario {
  id: string;
  /** Absent/"workflow" starts a workflow; "actor" invokes catalog actor
   * operations; "reset" runs a workflow, resets it, and asserts the successor;
   * "client_error" makes a failing client call and asserts the error code;
   * "event", "engine_restart", "worker_crash" and "workflow_id_reuse" are
   * handled by the runners of the same name below. */
  kind?: string;
  workflow?: string;
  input?: unknown;
  expect?: {
    status?: string;
    result?: unknown;
    error_code?: string;
    /** Substring the surfaced failure must contain, for `status: "failed"`.
     * Without it any failure passes, including a workflow whose failure could
     * not be reported at all. */
    error_contains?: string;
    /** Wall-clock bounds on the whole run, for scenarios whose duration is part
     * of the contract: a durable timer must actually wait, and must not wait
     * far longer than it was asked to. */
    min_elapsed_ms?: number;
    max_elapsed_ms?: number;
    /** Upper bounds on numeric result fields, for behavior that is a count
     * rather than a value: a parked workflow is activated a few times, and
     * "a few" is the contract, not an exact number. */
    result_at_most?: Record<string, number>;
  };
  /** Named client call to make, for `kind: "client_error"`. */
  client_call?: string;
  actor?: string;
  steps?: ActorStep[];
  /** Journal event to reset to (inclusive), for `kind: "reset"`. */
  reset_to_event_id?: number;
  /** Event to send once the workflow has parked, for `kind: "event"`. */
  event_name?: string;
  event_payload?: unknown;
  /** Set when the behavior is specified but not yet built. The scenario is
   * expected to fail; it is reported as such and does not fail the run, and
   * an unexpected pass is reported so the flag gets removed. */
  known_gap?: string;
  /** SDKs the gap still applies to; absent means all of them. Lets one SDK
   * close a gap while the shared file keeps it open for the others. */
  known_gap_sdks?: string[];
}

/** This runner's name in `known_gap_sdks`. */
const THIS_SDK = 'typescript';

function gapApplies(sc: Scenario): boolean {
  return Boolean(sc.known_gap) && (!sc.known_gap_sdks || sc.known_gap_sdks.includes(THIS_SDK));
}

/** One step of an actor scenario: `parallel` concurrent invocations of
 * `operation`, each asserted against `expect_each`. */
interface ActorStep {
  operation: string;
  input?: unknown;
  parallel?: number;
  expect_each?: unknown;
}

/** Makes the named failing client call.
 *
 * Each call is a plain client operation whose failure every SDK is expected to
 * report identically. Kept to operations that need no worker, so the assertion
 * is about the client's error contract and nothing else. */
async function performClientCall(client: Client, call: string): Promise<void> {
  switch (call) {
    case 'status_of_missing_workflow': {
      // A run id is required on this path in direct-bindings mode; the id pair
      // is fabricated, so the lookup is guaranteed to miss.
      const handle = client.getWorkflowHandle({
        workflowId: `contract-missing-${process.pid}-${Date.now()}`,
        runId: 'contract-missing-run',
      });
      await handle.status();
      return;
    }
    default:
      throw new Error(`unknown client_call: ${call}`);
  }
}

/** Runs one client-error scenario: makes the call, requires it to fail, and
 * asserts the reported code.
 *
 * The assertion is on the code rather than the class name because the SDKs
 * legitimately differ there (one reports a client-error variant where the
 * others report a workflow error), while the code is the contract a user reads
 * across languages. Checking it keeps the same condition from being reported
 * under different codes in different SDKs. */
async function runClientErrorScenario(client: Client, sc: Scenario): Promise<[boolean, string]> {
  const expected = sc.expect?.error_code;
  if (!expected) return [false, 'client_error scenario missing `expect.error_code`'];
  if (!sc.client_call) return [false, 'client_error scenario missing `client_call`'];

  let caught: unknown;
  try {
    await performClientCall(client, sc.client_call);
  } catch (e) {
    caught = e;
  }

  if (caught === undefined) {
    return [false, `expected the call to fail with ${expected}, but it succeeded`];
  }

  const actual = (caught as { code?: unknown }).code;
  if (actual !== expected) {
    const cls = (caught as object)?.constructor?.name ?? typeof caught;
    return [false, `expected error code ${expected}, got ${String(actual)} (${cls}: ${caught})`];
  }
  return [true, ''];
}

/** Runs one workflow-id reuse scenario: starts the workflow under a fresh id,
 * then again under the same id while it runs, which must be refused with
 * `expect.error_code`, naming the open run. Once it completes, a start that
 * reuses an id only after a failure is refused the same way, and a plain start
 * runs the workflow again. Guards against the engine accepting the duplicate
 * and recording a second run. */
async function runWorkflowIdReuseScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect) {
    return [false, 'workflow_id_reuse scenario missing `workflow`/`expect`'];
  }
  const expect = sc.expect;
  const expected = expect.error_code;
  if (!expected) return [false, 'workflow_id_reuse scenario missing `expect.error_code`'];
  const workflowId = `conf-reuse-${randomUUID()}`;

  const start = (workflowIdReusePolicy?: WorkflowIdReusePolicy) =>
    client.startWorkflow({
      workflowType: sc.workflow as string,
      workflowId,
      taskQueue,
      args: [sc.input ?? {}],
      workflowIdReusePolicy,
    });

  const refused = async (
    policy: WorkflowIdReusePolicy | undefined,
    inTheWay: string,
    when: string
  ): Promise<string | null> => {
    let handle;
    try {
      handle = await start(policy);
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      if (code !== expected) {
        return `${when}: expected ${expected}, got ${String(code)} (${e})`;
      }
      const runId = (e as { details?: { runId?: string } }).details?.runId;
      if (runId !== inTheWay) {
        return `${when}: the refusal does not name run ${inTheWay}: runId=${String(runId)}`;
      }
      return null;
    }
    return `${when}: the start was accepted as run ${handle.runId}`;
  };

  const completes = async (
    handle: { resultWithTimeout(ms: number): Promise<unknown> },
    which: string
  ): Promise<string | null> => {
    let result: unknown;
    try {
      result = await handle.resultWithTimeout(timeoutMs);
    } catch (e) {
      return `the ${which} run did not complete: ${e}`;
    }
    if (!jsonMatches(expect.result ?? {}, result)) {
      return `the ${which} run's result\n    expected: ${JSON.stringify(expect.result)}\n    actual:   ${JSON.stringify(result)}`;
    }
    return null;
  };

  const first = await start();
  if (!first.runId) return [false, 'the first start returned no run id'];

  const problem =
    (await refused(undefined, first.runId, 'a second start while it runs')) ??
    (await completes(first, 'first')) ??
    (await refused(
      WorkflowIdReusePolicy.AllowDuplicateFailedOnly,
      first.runId,
      'reusing only after a failure, once it completed'
    ));
  if (problem) return [false, problem];

  const again = await start(WorkflowIdReusePolicy.AllowDuplicate);
  if (again.runId === first.runId) return [false, "the new start reported the first run's id"];
  const last = await completes(again, 'second');
  return last ? [false, last] : [true, ''];
}

/** Runs one actor scenario: for each step, fires `parallel` concurrent
 * invocations against a fresh per-run key and asserts every invocation's
 * result against `expect_each`. */
async function runActorScenario(client: Client, sc: Scenario): Promise<[boolean, string]> {
  if (!sc.actor) return [false, 'actor scenario missing `actor`'];
  const key = `conf-${randomUUID()}`;

  for (const step of sc.steps ?? []) {
    const n = step.parallel ?? 1;
    const outcomes = await Promise.allSettled(
      Array.from({ length: n }, () =>
        client.invokeActor(sc.actor as string, key, step.operation, step.input ?? {})
      )
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        return [false, `operation ${step.operation} raised: ${outcome.reason}`];
      }
      if (!jsonMatches(step.expect_each ?? {}, outcome.value)) {
        return [
          false,
          `result mismatch on ${step.operation}\n    expected: ${JSON.stringify(step.expect_each)}\n    actual:   ${JSON.stringify(outcome.value)}`,
        ];
      }
    }
  }
  return [true, ''];
}

async function runScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect) return [false, 'workflow scenario missing `workflow`/`expect`'];
  const expect = sc.expect;

  const startedAt = Date.now();
  const handle = await client.startWorkflow({
    workflowType: sc.workflow,
    workflowId: `conf-${randomUUID()}`,
    taskQueue,
    args: [sc.input ?? {}],
  });

  let result: unknown;
  try {
    result = await handle.resultWithTimeout(timeoutMs);
  } catch (e) {
    if (expect.status === 'failed') {
      if (expect.error_contains && !String(e).includes(expect.error_contains)) {
        return [
          false,
          `failed as expected, but the message did not survive\n    wanted substring: ${expect.error_contains}\n    surfaced:         ${e}`,
        ];
      }
      return [true, ''];
    }
    return [false, `expected completion but workflow failed: ${e}`];
  }

  if (result === null) return [false, 'timed out waiting for a terminal state'];
  if (expect.status === 'failed') {
    return [false, `expected failure but workflow completed with: ${JSON.stringify(result)}`];
  }
  // Duration is part of the contract for timer scenarios. Asserting only the
  // result would let a 1s timer take 30s without failing.
  const elapsedMs = Date.now() - startedAt;
  if (expect.min_elapsed_ms !== undefined && elapsedMs < expect.min_elapsed_ms) {
    return [
      false,
      `completed too fast: ${elapsedMs}ms < ${expect.min_elapsed_ms}ms (the wait did not happen)`,
    ];
  }
  if (expect.max_elapsed_ms !== undefined && elapsedMs > expect.max_elapsed_ms) {
    return [
      false,
      `took too long: ${elapsedMs}ms > ${expect.max_elapsed_ms}ms (waited far longer than asked)`,
    ];
  }

  if (jsonMatches(expect.result ?? {}, result)) return [true, ''];
  return [
    false,
    `result mismatch\n    expected: ${JSON.stringify(expect.result)}\n    actual:   ${JSON.stringify(result)}`,
  ];
}

/** Runs a workflow to completion, resets it to `reset_to_event_id`, then asserts
 * the successor run replays the copied prefix and reaches `expect`.
 *
 * Covers the whole reset path, not just the client binding: the engine reads the
 * journal by the execution row's internal id (not the user-facing workflow id),
 * must seed the successor's journal before the run becomes dispatchable, and must
 * be able to persist the `reset` status on the original. */
async function runResetScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect) return [false, 'reset scenario missing `workflow`/`expect`'];
  if (sc.reset_to_event_id === undefined) {
    return [false, 'reset scenario missing `reset_to_event_id`'];
  }
  if (sc.expect.status !== 'completed') {
    return [false, "reset scenarios only support an expected status of 'completed'"];
  }

  const workflowId = `conf-reset-${randomUUID()}`;
  const handle = await client.startWorkflow({
    workflowType: sc.workflow,
    workflowId,
    taskQueue,
    args: [sc.input ?? {}],
  });

  try {
    const original = await handle.resultWithTimeout(timeoutMs);
    if (original === null) return [false, 'original run timed out'];
  } catch (e) {
    return [false, `original run did not complete: ${e}`];
  }

  let newExecutionId: string;
  try {
    newExecutionId = await handle.reset(sc.reset_to_event_id, 'contract reset');
  } catch (e) {
    return [false, `reset rejected: ${e}`];
  }
  if (!newExecutionId) {
    return [false, 'reset returned an empty execution id (success without resetting)'];
  }

  const successor = await client.getWorkflowHandle({ workflowId, runId: newExecutionId });
  let result: unknown;
  try {
    result = await successor.resultWithTimeout(timeoutMs);
  } catch (e) {
    return [false, `successor run ${newExecutionId} did not complete: ${e}`];
  }
  if (result === null) return [false, `successor run ${newExecutionId} timed out`];

  if (jsonMatches(sc.expect.result ?? {}, result)) return [true, ''];
  return [
    false,
    `successor result mismatch\n    expected: ${JSON.stringify(sc.expect.result)}\n    actual:   ${JSON.stringify(result)}`,
  ];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Numeric upper bounds: every listed field must be present in `actual` and
 * no greater than the bound. */
function withinBounds(bounds: Record<string, number>, actual: unknown): string | null {
  if (!isObject(actual)) return 'result is not an object';
  for (const [field, max] of Object.entries(bounds)) {
    const value = actual[field];
    if (typeof value !== 'number') return `${field} is missing or not a number`;
    if (value > max) return `${field} = ${value}, expected at most ${max}`;
  }
  return null;
}

/** Waits until the catalog reports the keyed workflow parked, or gives up. The
 * worker runs in this process, so "parked" is observed directly rather than
 * inferred from a status the engine reports as RUNNING either way. */
async function waitUntilParked(key: string, deadlineMs: number): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (parkedWorkflows.has(key)) return true;
    await sleep(50);
  }
  return false;
}

/** Runs one event scenario: starts the workflow, waits for it to park, wakes it
 * with the named event by workflow id alone, and asserts the result.
 *
 * Each step checks a separate guarantee: the parking activation is accepted,
 * the wake can be addressed without a run id (which the SDK does not expose),
 * and the parked workflow is not re-dispatched continuously. The activation
 * count in the result catches the last one, through `expect.result_at_most`. */
async function runEventScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect) return [false, 'event scenario missing `workflow`/`expect`'];
  if (!sc.event_name) return [false, 'event scenario missing `event_name`'];

  const key = `conf-${randomUUID()}`;
  const workflowId = `conf-event-${key}`;
  const input = { ...(isObject(sc.input) ? sc.input : {}), key };

  const handle = await client.startWorkflow({
    workflowType: sc.workflow,
    workflowId,
    taskQueue,
    args: [input],
  });

  if (!(await waitUntilParked(key, timeoutMs))) {
    return [
      false,
      'the workflow never parked (the wait was not reached, or the activation failed)',
    ];
  }
  // A parked workflow holds its claim; give the engine a moment to record the
  // parking completion before the event arrives, so the wake is a real wake
  // and not an event consumed by the first activation.
  await sleep(500);

  // By workflow id alone: a caller holding a business key has no run id.
  await client.getWorkflowHandle({ workflowId }).sendEvent(sc.event_name, sc.event_payload ?? {});

  let result: unknown;
  try {
    result = await handle.resultWithTimeout(timeoutMs);
  } catch (e) {
    return [false, `expected completion after the event but the workflow failed: ${e}`];
  }
  if (result === null) {
    // Do not leave a parked run behind on every execution of the suite; a
    // scenario whose wake never lands would otherwise strand one per run.
    await handle.cancel().catch(() => undefined);
    return [false, 'timed out after the event was sent'];
  }

  if (!jsonMatches(sc.expect.result ?? {}, result)) {
    return [
      false,
      `result mismatch\n    expected: ${JSON.stringify(sc.expect.result)}\n    actual:   ${JSON.stringify(result)}`,
    ];
  }
  if (sc.expect.result_at_most) {
    const problem = withinBounds(sc.expect.result_at_most, result);
    if (problem) return [false, `${problem} (activations so far: ${activations.get(key)})`];
  }
  return [true, ''];
}

/** Runs one cancellation scenario: starts the workflow, cancels it once it has
 * parked, and asserts how it ended. `expect.status` is `cancelled` for a
 * workflow that lets the cancellation it is told of end it, and `completed`,
 * with `expect.result`, for one that cleans up and returns. */
async function runCancelScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect) return [false, 'cancel scenario missing `workflow`/`expect`'];

  const key = `conf-${randomUUID()}`;
  const input = { ...(isObject(sc.input) ? sc.input : {}), key };
  const handle = await client.startWorkflow({ workflowType: sc.workflow, taskQueue, args: [input] });

  if (!(await waitUntilParked(key, timeoutMs))) {
    await handle.cancel().catch(() => undefined);
    return [false, 'the workflow never parked'];
  }
  // As for an event: let the engine record the parking activation, so the
  // cancellation wakes a parked workflow rather than racing its first run.
  await sleep(500);
  await handle.cancel();

  if (sc.expect.status === 'cancelled') {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = String(await handle.status());
      if (status === 'CANCELLED') return [true, ''];
      if (status !== 'RUNNING' || Date.now() >= deadline) {
        return [false, `expected the workflow cancelled, it is ${status}`];
      }
      await sleep(200);
    }
  }
  if (sc.expect.status === 'completed') {
    let result: unknown;
    try {
      result = await handle.resultWithTimeout(timeoutMs);
    } catch (e) {
      return [false, `expected completion after cleanup but the workflow failed: ${e}`];
    }
    if (result === null) return [false, 'timed out waiting for the workflow to finish cleaning up'];
    if (!jsonMatches(sc.expect.result ?? {}, result)) {
      return [
        false,
        `result mismatch\n    expected: ${JSON.stringify(sc.expect.result)}\n    actual:   ${JSON.stringify(result)}`,
      ];
    }
    return [true, ''];
  }
  return [false, `unknown expected status '${sc.expect.status}' for a cancel scenario`];
}

/** Runs one engine-restart scenario: restarts the engine with the command in
 * `ORCHER_CONTRACT_RESTART_CMD`, then starts a workflow and expects the worker,
 * untouched, to pick it up and complete it.
 *
 * Skipped (reported, not failed) when the variable is unset: the harness has
 * no general way to restart an engine it did not start. Guards that workflow
 * pollers recover after an engine restart; a worker whose pollers stay down
 * still heartbeats and looks healthy. */
async function runEngineRestartScenario(
  client: Client,
  taskQueue: string,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean | null, string]> {
  const cmd = process.env.ORCHER_CONTRACT_RESTART_CMD;
  // null, not true: a scenario that did not run asserts nothing, so it must
  // not be counted as a pass.
  if (!cmd) return [null, 'ORCHER_CONTRACT_RESTART_CMD is not set'];
  if (!sc.workflow || !sc.expect)
    return [false, 'engine_restart scenario missing `workflow`/`expect`'];

  try {
    execSync(cmd, { stdio: 'inherit', timeout: 120_000 });
  } catch (e) {
    return [false, `restart command failed: ${e}`];
  }
  // Let the worker notice and recover on its own. Recovery is the assertion,
  // so nothing here reconnects or restarts the worker.
  await sleep(5_000);

  const handle = await client.startWorkflow({
    workflowType: sc.workflow,
    workflowId: `conf-restart-${randomUUID()}`,
    taskQueue,
    args: [sc.input ?? {}],
  });
  let result: unknown;
  try {
    result = await handle.resultWithTimeout(timeoutMs);
  } catch (e) {
    return [false, `workflow failed after the engine restart: ${e}`];
  }
  if (result === null) {
    return [false, 'the worker never picked the workflow up after the engine restart'];
  }
  if (jsonMatches(sc.expect.result ?? {}, result)) return [true, ''];
  return [
    false,
    `result mismatch\n    expected: ${JSON.stringify(sc.expect.result)}\n    actual:   ${JSON.stringify(result)}`,
  ];
}

/**
 * Turn "namespace does not exist" into something actionable.
 *
 * The suite needs a namespace that is not `default`, and the server will not
 * create one on demand, so the first run on a fresh engine fails here. Saying
 * how to fix it beats a NOT_FOUND from a poller.
 */
function namespaceHint(error: unknown, namespace: string): unknown {
  const text = String((error as { message?: string })?.message ?? error);
  if (!/namespace/i.test(text) || !/not exist|not found|NOT_FOUND/i.test(text)) {
    return error;
  }
  return new Error(
    `namespace '${namespace}' does not exist on this engine.\n` +
      `    Create it once:  orcher namespace create ${namespace}\n` +
      `    Or point the suite elsewhere:  ORCHER_NAMESPACE=<name> ...\n` +
      `    Original error: ${text}`
  );
}

/** Spawns a worker process of this harness that serves `taskQueue` alone.
 * When `doomed`, its `exit_if_worker_doomed` task takes the process down. */
function spawnWorker(taskQueue: string, doomed: boolean): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, ORCHER_CONTRACT_WORKER_ONLY: taskQueue };
  delete env.ORCHER_CONTRACT_DOOMED_WORKER;
  if (doomed) env.ORCHER_CONTRACT_DOOMED_WORKER = '1';
  // Through ts-node, as run.sh starts this script: the process running it has
  // no loader for TypeScript in its arguments to pass on.
  const tsNode = require.resolve('ts-node/dist/bin.js');
  const args = [tsNode, '--project', join(__dirname, 'tsconfig.json'), join(__dirname, 'run.ts')];
  return spawn(process.execPath, args, {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/** Resolves with the process's exit code once it has exited. */
function exited(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

/**
 * Starts the workflow on a queue of its own, served by a worker process its
 * task kills; once that process is gone, starts another, and expects the
 * workflow to complete on it.
 *
 * The task sets no timeouts, so only the engine's default heartbeat timeout,
 * given because the worker heartbeats on its own, recovers the attempt that
 * died with its worker. The wait allows for an engine at its defaults: a
 * minute's timeout and a thirty-second sweep.
 */
async function runWorkerCrashScenario(
  client: Client,
  timeoutMs: number,
  sc: Scenario
): Promise<[boolean, string]> {
  if (!sc.workflow || !sc.expect)
    return [false, 'worker_crash scenario missing `workflow`/`expect`'];
  const taskQueue = `contract-crash-${randomUUID()}`;
  const doomed = spawnWorker(taskQueue, true);
  const handle = await client.startWorkflow({
    workflowType: sc.workflow,
    workflowId: `conf-crash-${randomUUID()}`,
    taskQueue,
    args: [sc.input ?? {}],
  });
  const code = await Promise.race([exited(doomed), sleep(60_000).then(() => 'timeout' as const)]);
  if (code === 'timeout') {
    doomed.kill('SIGKILL');
    return [false, 'the task never took its worker down'];
  }
  if (code === 0) return [false, 'the first worker exited cleanly, not mid-task'];

  const survivor = spawnWorker(taskQueue, false);
  let result: unknown;
  try {
    result = await handle.resultWithTimeout(timeoutMs + 120_000);
  } catch (e) {
    return [false, `the task was never retried after its worker died: ${e}`];
  } finally {
    survivor.kill('SIGKILL');
    await exited(survivor);
  }
  if (result === null) return [false, 'the task was never retried after its worker died'];
  if (jsonMatches(sc.expect.result ?? {}, result)) return [true, ''];
  return [
    false,
    `result mismatch\n    expected: ${JSON.stringify(sc.expect.result)}\n    actual:   ${JSON.stringify(result)}`,
  ];
}

async function main(): Promise<void> {
  const serverUrl = process.env.ORCHER_SERVER_URL ?? 'http://localhost:50051';
  // A real namespace, not `default`. In `default`, a child workflow created in
  // the wrong namespace would be indistinguishable from one created in its
  // parent's, so the child-workflow scenarios could not catch it.
  //
  // Create it once: `orcher namespace create contract`.
  const namespace = process.env.ORCHER_NAMESPACE ?? 'contract';
  // Set when the harness started this process to serve one queue alone, for a
  // `worker_crash` scenario whose task takes its worker process down.
  const workerOnly = process.env.ORCHER_CONTRACT_WORKER_ONLY;
  const taskQueue = workerOnly ?? 'contract';
  const timeoutMs = 30_000;
  const scenariosPath = process.env.ORCHER_SCENARIOS ?? join(__dirname, 'scenarios.json');

  const spec = JSON.parse(readFileSync(scenariosPath, 'utf8')) as { scenarios: Scenario[] };
  console.log(
    `ORCHER contract — TypeScript worker | ${spec.scenarios.length} scenarios | server ${serverUrl}`
  );

  // Register explicitly rather than relying on self-registration. Both paths
  // are public, and this one is what `validateOptions` steers users toward by
  // warning when the arrays are empty, so the suite drives the path users are
  // told to use. long_wait.ts covers self-registration.
  const worker = new Worker({
    serverUrl,
    namespace,
    taskQueue,
    workflows: [
      echo,
      catchTaskFailure,
      taskRetriesExhausted,
      taskNonRetryableListed,
      taskNonRetryableMarked,
      taskUnlistedRetried,
      taskInputRoundtrip,
      contractChild,
      parentStartsChild,
      failingChild,
      parentCatchesChildFailure,
      parentTwoChildrenParallel,
      restartOnce,
      sleepOnce,
      taskTimeoutsEcho,
      typedFailure,
      waitForEventEcho,
      waitForEventTimeout,
      outliveHeartbeatTimeout,
      crashMidTask,
      cancelSleep,
      cancelCleanupWorkflow,
      cancelSaga,
    ],
    tasks: [
      alwaysFail,
      alwaysFailRetried,
      declineCard,
      throttle,
      closeAccount,
      echoTask,
      timeoutsEchoTask,
      sleepPastHeartbeatTimeout,
      exitIfWorkerDoomed,
      cancelCleanup,
      cancelReserve,
      cancelRelease,
    ],
  });
  try {
    await worker.run(); // connects + registers; pollers run in the background
  } catch (e) {
    throw namespaceHint(e, namespace);
  }
  if (workerOnly) {
    // Serve until killed.
    await new Promise(() => undefined);
  }
  await new Promise((r) => setTimeout(r, 2000)); // let pollers warm up

  const client = new Client({ serverUrl, namespace });
  await client.connect();

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const sc of spec.scenarios) {
    const isActor = sc.kind === 'actor';
    const label = isActor ? sc.actor : (sc.workflow ?? sc.client_call);
    let ok: boolean | null;
    let msg: string;
    if (isActor) {
      [ok, msg] = await runActorScenario(client, sc);
    } else if (sc.kind === 'client_error') {
      [ok, msg] = await runClientErrorScenario(client, sc);
    } else if (sc.kind === 'reset') {
      [ok, msg] = await runResetScenario(client, taskQueue, timeoutMs, sc);
    } else if (sc.kind === 'event') {
      [ok, msg] = await runEventScenario(client, taskQueue, timeoutMs, sc);
    } else if (sc.kind === 'cancel') {
      [ok, msg] = await runCancelScenario(client, taskQueue, timeoutMs, sc);
    } else if (sc.kind === 'engine_restart') {
      [ok, msg] = await runEngineRestartScenario(client, taskQueue, timeoutMs, sc);
    } else if (sc.kind === 'worker_crash') {
      [ok, msg] = await runWorkerCrashScenario(client, timeoutMs, sc);
    } else if (sc.kind === 'workflow_id_reuse') {
      [ok, msg] = await runWorkflowIdReuseScenario(client, taskQueue, timeoutMs, sc);
    } else {
      [ok, msg] = await runScenario(client, taskQueue, timeoutMs, sc);
    }
    if (ok === null) {
      console.log(`  SKIP  ${sc.id} (${label}): ${msg}`);
      skipped += 1;
    } else if (gapApplies(sc)) {
      // Specified but not built: a failure is the expected state and does not
      // fail the run; a pass means the gap closed and the flag should go.
      if (ok) {
        console.log(
          `  FAIL  ${sc.id} (${label}): passed but is marked known_gap — remove the flag: ${sc.known_gap}`
        );
        failed += 1;
      } else {
        console.log(`  XFAIL ${sc.id} (${label}): known gap — ${sc.known_gap}`);
        passed += 1;
      }
    } else if (ok) {
      console.log(`  PASS  ${sc.id} (${label})${msg ? `: ${msg}` : ''}`);
      passed += 1;
    } else {
      console.log(`  FAIL  ${sc.id} (${label}): ${msg}`);
      failed += 1;
    }
  }

  await worker.shutdown().catch(() => undefined);
  console.log(
    `\n${passed} passed, ${failed} failed, ${skipped} skipped, ${spec.scenarios.length} total`
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
