# Contract harness

A live, engine-backed check that this SDK's worker produces correct durable
behavior. It catches the class of bug that unit tests, type-checks, and builds
cannot: a worker that silently does not run, mis-reports a task failure, or
swallows a control signal. Those only show up when a real worker runs against a
real engine, so this harness makes that check repeatable.

It is one part of a cross-SDK contract suite. `scenarios.json` is a shared,
language-agnostic contract, and the workflow catalog is named identically across
the TypeScript, Python, and Rust SDKs, so the same scenarios drive every worker.
The Python and Rust SDKs carry equivalent checks.

## Layout

- `scenarios.json`: the shared contract, kept byte-identical across the SDKs.
  Each scenario names a catalog workflow, an `input`, and the `expect`ed terminal
  `status` and returned `result`. Matching is structural: a scenario asserts only
  the fields it lists, so SDK-specific extras are ignored.
- `catalog.ts`: the shared workflow and task catalog this worker serves (the
  functional `task()` / `workflow()` API). Each workflow returns a JSON result
  describing the durable behavior it observed.
- `run.ts`: the driver. It starts the worker, runs every scenario against the
  engine, asserts the outcome, and exits non-zero on any failure.
- `run.sh`: checks that an engine is reachable, then runs `run.ts`.
- `long_wait.ts`: a separate long-running check, described below.
- `tsconfig.json`: config for `ts-node`.

## Scenario kinds

Beyond the default start-and-await shape, `scenarios.json` carries:

- `kind: "actor"`: invokes catalog actor operations (`steps`, `expect_each`).
- `kind: "reset"`: runs to completion, resets to `reset_to_event_id`, and asserts
  the successor run.
- `kind: "client_error"`: makes a failing client call (`client_call`) and asserts
  `expect.error_code`.
- `kind: "event"`: starts the workflow, waits until the catalog reports it parked
  (an in-process gauge, keyed by the `key` the driver injects into `input`), sends
  `event_name` with `event_payload` by workflow id alone, and asserts the result.
  `expect.result_at_most` gives upper bounds on numeric result fields; the event
  catalog reports its activation count there, so a parked workflow that the
  engine re-dispatches in a loop fails the bound.
- `kind: "engine_restart"`: runs `ORCHER_CONTRACT_RESTART_CMD`, waits, then
  starts a workflow and expects the untouched worker to pick it up. Reported as
  skipped when the variable is unset, because the harness cannot restart an
  engine it did not start. Point it at something that restarts the engine on
  `ORCHER_SERVER_URL` and blocks until it is healthy.
- `kind: "worker_crash"`: starts the workflow on its own queue, served by a worker
  process that the task kills, then starts a second worker and expects the task
  to be retried and the workflow to complete there.
- `kind: "workflow_id_reuse"`: starts a workflow, then starts it again under the
  same id and asserts the refusal (`expect.error_code`) and the reuse policies.

A scenario with `known_gap` describes behavior that is specified but not built
yet. It is expected to fail: it is reported as `XFAIL` and not counted against
the run. If it passes, the run fails with a note to remove the flag, so the suite
cannot quietly carry a stale expectation. `known_gap_sdks` narrows the gap to the
SDKs it lists (`typescript`, `rust`, `python`); when absent, it applies to all.
An SDK that builds the behavior removes itself from the list, and the flag goes
when the list is empty.

## Running

The suite runs in a namespace called `contract`, not `default`, because in
`default` a child workflow created in the wrong namespace cannot be told apart
from one created in its parent's. Create the namespace once per engine:

```bash
orcher namespace create contract
```

Set `ORCHER_NAMESPACE` to run somewhere else.

Start an Orcher engine with gRPC on `localhost:50051` (or set
`ORCHER_SERVER_URL`), with `ORCHER_DURABLE_TASK_FAILURE=true` in its
environment.

The worker-liveness scenarios (`task-outlives-heartbeat-timeout-without-heartbeat-code`,
`task-retried-after-its-worker-dies`) need the engine to time out a silent task
within seconds rather than after its default minute. Start the engine with
`ORCHER_DEFAULT_HEARTBEAT_TIMEOUT_SECS=3 ORCHER_TIMEOUT_WATCHER_POLL_INTERVAL_SECS=1
ORCHER_TIMEOUT_WATCHER_GRACE_SECS=1`. At the defaults the first fails and the
second takes a couple of minutes.

Build the SDK and its native module (`npm run build` in `packages/sdk`). Then,
from the repository root:

```bash
./contract/run.sh
# or directly:
npx ts-node --project contract/tsconfig.json contract/run.ts
```

### Writing catalog workflows

Inside a workflow, `ctx.executeTask()` pauses the workflow by throwing a
`WorkflowError` with `code: 'WORKFLOW_SUSPENDED'` until the task completes. A
`try/catch` around `executeTask` (or `executeChildWorkflow`) must re-throw that
signal and handle only real task failures (`WorkflowError.taskFailed`, whose
`details.taskType` names the task). Swallowing it breaks durability. See
`catch_task_failure` in `catalog.ts`.

The worker is started with `worker.run()`, which returns once it has connected
and registered; the pollers keep running in the background.

### Long-wait check

`long_wait.ts` checks that `handle.result()` can await a workflow that runs
longer than the server's 60s default result window. A result request without a
deadline gets that default, so the client must keep re-issuing its long-poll
until the workflow is terminal rather than failing while the workflow is still
healthy and running.

It is not part of `scenarios.json` because it has to outlive that window to prove
anything, so a real run takes over a minute:

```bash
# Exercises the check (the workflow must outlive the 60s default window)
npx ts-node --project contract/tsconfig.json contract/long_wait.ts --sleep-secs 75

# Fast check that the harness itself works. Reports SMOKE and does NOT
# claim anything about the default window.
npx ts-node --project contract/tsconfig.json contract/long_wait.ts --sleep-secs 5
```
