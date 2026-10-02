/**
 * Regression check: awaiting a workflow that outlives the server's default
 * result window must succeed.
 *
 * A result request that carries no deadline gets the server's 60s default. The
 * client therefore re-issues the bounded long-poll until the workflow is
 * terminal, so a wait of any length works. Without that, the await would fail
 * even though the workflow was healthy and still running.
 *
 * TypeScript reaches the same sdk-core `WorkflowHandle::result()` as the Rust and
 * Python SDKs, so it shares that behavior by construction; this check observes it.
 *
 * Kept out of scenarios.json deliberately: it has to outlive the server's default
 * window to prove anything, so it cannot share a catalog with scenarios that
 * finish in milliseconds.
 *
 * Usage (against a running engine):
 *   npx ts-node --project contract/tsconfig.json contract/long_wait.ts --sleep-secs 75
 */
import { Client, Worker, task, workflow, type TaskContext, type WorkflowContext } from '@orcher/sdk';

/**
 * The server substitutes this when a result request carries no deadline of its
 * own. A run only exercises the regression if the workflow outlives it.
 */
const SERVER_DEFAULT_RESULT_WINDOW_SECS = 60;

interface LongInput {
  sleepSecs: number;
}

/** Sleeps inside the task, so the workflow genuinely stays running past the
 * default window rather than merely being slow to dispatch. */
const tsLongTask = task<LongInput, unknown>({
  name: 'ts_long_task',
  execute: async (_ctx: TaskContext, input: LongInput): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, input.sleepSecs * 1000));
    return { slept_secs: input.sleepSecs };
  },
});

const tsLongWorkflow = workflow<LongInput, unknown>({
  name: 'ts_long_workflow',
  run: async (ctx: WorkflowContext, input: LongInput): Promise<unknown> =>
    ctx.executeTask(tsLongTask, input),
});

function parseSleepSecs(argv: string[]): number {
  const i = argv.indexOf('--sleep-secs');
  // Must exceed SERVER_DEFAULT_RESULT_WINDOW_SECS to be a real check.
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : 75;
}

async function main(): Promise<void> {
  const serverUrl = process.env.ORCHER_SERVER_URL ?? 'http://localhost:50051';
  const namespace = process.env.ORCHER_NAMESPACE ?? 'default';
  const taskQueue = 'ts-long-wait';
  const sleepSecs = parseSleepSecs(process.argv);

  const exercisesRegression = sleepSecs > SERVER_DEFAULT_RESULT_WINDOW_SECS;
  const mode = exercisesRegression ? 'REGRESSION' : 'SMOKE';
  console.log(
    `ts long-wait check [${mode}] | workflow sleeps ${sleepSecs}s ` +
      `(server default result window is ${SERVER_DEFAULT_RESULT_WINDOW_SECS}s)`
  );
  if (!exercisesRegression) {
    console.log(
      '  note: sleep does not exceed the default window, so this only checks the ' +
        'harness — it does NOT prove the cap is gone.'
    );
  }

  // No explicit `workflows`/`tasks` arrays: the factories above register
  // themselves on import, so the worker discovers them. This keeps the
  // self-registration path exercised; run.ts covers explicit registration.
  const worker = new Worker({ serverUrl, namespace, taskQueue });
  await worker.run();
  await new Promise((r) => setTimeout(r, 2000)); // let pollers warm up

  const client = new Client({ serverUrl, namespace });
  await client.connect();

  const started = Date.now();
  const handle = await client.startWorkflow({
    workflowType: 'ts_long_workflow',
    taskQueue,
    args: [{ sleepSecs }],
  });

  // The assertion: NO explicit timeout, so this must wait as long as the workflow
  // runs instead of being cut off at the server's default window.
  const result = (await handle.result()) as { slept_secs?: number } | null;
  const elapsedSecs = (Date.now() - started) / 1000;

  await worker.shutdown();
  await client.close();

  console.log(`  result reported : ${JSON.stringify(result)}`);
  console.log(`  wall clock      : ${elapsedSecs.toFixed(1)}s`);

  if (result?.slept_secs !== sleepSecs) {
    throw new Error(`unexpected result payload: ${JSON.stringify(result)}`);
  }
  if (elapsedSecs < sleepSecs) {
    throw new Error(
      `returned too early (${elapsedSecs.toFixed(1)}s) — the workflow cannot have completed`
    );
  }

  if (exercisesRegression) {
    console.log(
      `\nTS LONG-WAIT: PASS — awaited a ${sleepSecs}s workflow past the ` +
        `${SERVER_DEFAULT_RESULT_WINDOW_SECS}s default window`
    );
  } else {
    console.log(
      `\nTS LONG-WAIT: SMOKE PASS — harness works. Re-run with --sleep-secs ` +
        `greater than ${SERVER_DEFAULT_RESULT_WINDOW_SECS} to exercise the regression.`
    );
  }
}

main()
  .then(() => {
    // The worker's polling loops keep the event loop alive even after
    // shutdown(), so exit explicitly rather than hanging on a passed run.
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\nTS LONG-WAIT: FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
