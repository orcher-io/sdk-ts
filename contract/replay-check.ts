/**
 * Replays recorded workflow activations and checks the SDK still answers each
 * the way it did when the expected results were recorded.
 *
 * `contract/replay/<corpus>/` holds activations recorded from this catalog
 * with `ORCHER_RECORD_ACTIVATIONS` (layout `<workflow>/<run>/<n>-activation.pb`,
 * each an encoded `orcher.v1.PollWorkflowExecutionResponse`), and
 * `expected.json` beside them what the SDK answered each with: the commands,
 * the steps reached, the query and update answers, or the failure, as the
 * kernel turns the SDK's `RunActivationResult` into what goes to the engine.
 *
 * Each activation is resolved by the kernel into a `RunActivation`, answered
 * by `Worker.runActivation`, and the answer turned back by the kernel, as the
 * worker host does on a live worker.
 *
 * No engine is needed. Requires the built SDK and native module
 * (`npm run build` in packages/sdk).
 *
 *   npx ts-node --project contract/tsconfig.json contract/replay-check.ts [--bless]
 *
 * `--bless` rewrites `expected.json` from what the SDK answers now, for a
 * change meant to alter what it sends. Exits non-zero if any activation
 * differs from its expected result or cannot be run.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';

import { Worker } from '@orcher/sdk';
import { getNativeModule } from '../packages/sdk/dist/core/native';
import { RunActivation, RunActivationResult } from '../packages/sdk/dist/core/generated/kernel';

// Registers the catalog's workflows with the global registry, which the
// worker collects when it is created.
import { activations } from './catalog';

const NAMESPACE = 'contract';
const ROOT = join(__dirname, 'replay');

/** Every corpus under `contract/replay`, in order. */
function corpora(): string[] {
  return readdirSync(ROOT)
    .map((name) => join(ROOT, name))
    .filter((p) => statSync(p).isDirectory())
    .sort();
}

/** Every recorded activation in a corpus, keyed `<workflow>/<run>/<file>`, run by run. */
function recordedActivations(corpus: string): Array<[string, Buffer]> {
  const dirs = (path: string) =>
    readdirSync(path)
      .filter((name) => statSync(join(path, name)).isDirectory())
      .sort();
  const out: Array<[string, Buffer]> = [];
  for (const workflow of dirs(corpus)) {
    for (const run of dirs(join(corpus, workflow))) {
      const runDir = join(corpus, workflow, run);
      for (const name of readdirSync(runDir).sort()) {
        if (name.endsWith('-activation.pb')) {
          out.push([`${workflow}/${run}/${name}`, readFileSync(join(runDir, name))]);
        }
      }
    }
  }
  return out;
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };

// The worker starts polling the engine when it is created; this check runs
// without one.
(Worker.prototype as any).initializeEagerPolling = () => undefined;

const workers = new Map<string, Worker>();
/** A worker for the task queue an activation was recorded on: tasks and
 * children it schedules default to the worker's queue. It is never run, so
 * it connects to nothing. */
function workerFor(taskQueue: string): any {
  let worker = workers.get(taskQueue);
  if (!worker) {
    worker = new Worker({
      serverUrl: 'http://127.0.0.1:1',
      namespace: NAMESPACE,
      taskQueue,
      logger: silent,
    });
    workers.set(taskQueue, worker);
  }
  return worker;
}

async function main(): Promise<void> {
  const bless = process.argv.includes('--bless');
  const native = getNativeModule() as any;
  for (const hook of ['kernelResolve', 'kernelExecutionResult']) {
    if (typeof native[hook] !== 'function') {
      throw new Error(`the native module has no ${hook}; rebuild it (npm run build)`);
    }
  }
  // While the worker still has its journal-reading path, blessing also holds
  // the two paths equal: the expected results are the ones both produce.
  const legacy =
    typeof native.legacyExecutionRequest === 'function' &&
    typeof native.legacyExecutionResult === 'function';

  let checked = 0;
  const problems: string[] = [];
  for (const corpus of corpora()) {
    const expectedPath = join(corpus, 'expected.json');
    const expected: Record<string, unknown> = bless
      ? {}
      : JSON.parse(readFileSync(expectedPath, 'utf8'));
    const answered: Record<string, unknown> = {};
    for (const [key, bytes] of recordedActivations(corpus)) {
      checked++;
      const activation = RunActivation.fromBinary(native.kernelResolve(bytes, NAMESPACE));
      const run = activation.run;
      const worker = workerFor(run?.taskQueue ?? '');
      if (!worker.workflowMap.has(run?.workflowType ?? '')) {
        problems.push(`${key}: ${run?.workflowType} is not in the catalog`);
        continue;
      }
      // Some catalog workflows count their activations in the process; each
      // activation is answered as if it were the run's first in this process.
      activations.clear();
      const answer = await worker.runActivation(activation);
      let result: unknown;
      try {
        result = JSON.parse(
          native.kernelExecutionResult(
            run?.runId ?? '',
            Buffer.from(RunActivationResult.toBinary(answer))
          )
        );
      } catch (error) {
        problems.push(`${key} (${run?.workflowType}): the kernel refused the answer: ${error}`);
        continue;
      }
      answered[key] = result;

      if (bless && legacy) {
        activations.clear();
        const request = JSON.parse(native.legacyExecutionRequest(bytes));
        const old = JSON.parse(
          native.legacyExecutionResult(
            JSON.stringify(await worker.executeWorkflowDirectBindings(request))
          )
        );
        // A failed workflow: the journal path sends the steps it reached, the
        // kernel none. Equal when there were none.
        const kernel = { ...(result as any) };
        if (
          old.successful === false &&
          Array.isArray(old.reached_steps) &&
          old.reached_steps.length === 0 &&
          kernel.reached_steps == null
        ) {
          kernel.reached_steps = old.reached_steps;
        }
        if (!isDeepStrictEqual(old, kernel)) {
          problems.push(
            `${key} (${run?.workflowType}): the journal path answers differently\n` +
              `  journal: ${JSON.stringify(old)}\n  kernel:  ${JSON.stringify(result)}`
          );
        }
      } else if (!bless) {
        if (!(key in expected)) {
          problems.push(`${key}: no expected result`);
        } else if (!isDeepStrictEqual(expected[key], result)) {
          problems.push(
            `${key} (${run?.workflowType}):\n` +
              `  expected: ${JSON.stringify(expected[key])}\n  answered: ${JSON.stringify(result)}`
          );
        }
      }
    }
    if (bless) {
      if (problems.length === 0) {
        writeFileSync(expectedPath, JSON.stringify(answered, null, 2) + '\n');
        console.log(`blessed ${expectedPath} (${Object.keys(answered).length} activations)`);
      }
    } else {
      for (const key of Object.keys(expected)) {
        if (!(key in answered)) problems.push(`${key}: expected, but not in the corpus`);
      }
    }
  }

  for (const problem of problems) {
    console.log(`DIFFERS ${problem}\n`);
  }
  console.log(`${checked} recorded activations replayed, ${problems.length} differ`);
  if (checked === 0 || problems.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Nothing is left running, but the native runtime keeps the process alive.
    process.exit();
  });
