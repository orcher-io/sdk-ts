/**
 * Kernel-protocol equivalence: every recorded activation, run through the
 * worker's two paths, must produce the same result.
 *
 * - **Today's path**: the activation as the worker hands it to TypeScript (the
 *   jobs sdk-core derives from the journal), run by `executeWorkflowDirectBindings`,
 *   answered as the JSON result the worker sends sdk-core.
 * - **The kernel path**: the activation resolved by the kernel into a
 *   `RunActivation`, run by `Worker.runActivation`, its `RunActivationResult`
 *   turned back by the kernel into the result the workflow driver sends.
 *
 * Both results are read as sdk-core reads them and compared field for field.
 * One divergence is expected: a failed workflow's `reached_steps`, which today's
 * path sends empty and the kernel does not send; it is allowed only when empty.
 *
 * No engine is needed. Activations are read from a recording made with
 * `ORCHER_RECORD_ACTIVATIONS` (layout `<workflow>/<run>/<n>-activation.pb`, each
 * an encoded `orcher.v1.PollWorkflowExecutionResponse`), by default
 * `~/orcher-corpus/typescript`.
 *
 * Requires the built SDK and native module (`npm run build` in packages/sdk).
 *
 *   npx ts-node --project contract/tsconfig.json contract/kernel-equivalence.ts [dir]
 *
 * Exits non-zero if any activation differs or cannot be run.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';

import { Worker } from '@orcher/sdk';
import { getNativeModule } from '../packages/sdk/dist/core/native';
import { RunActivation, RunActivationResult } from '../packages/sdk/dist/core/generated/kernel';

// Registers the catalog's workflows with the global registry, which the
// worker collects when it is created.
import { activations } from './catalog';

const NAMESPACE = 'contract';

interface Recorded {
  file: string;
  bytes: Buffer;
}

/** Every recorded activation under `dir`, run by run, in the order they happened. */
function recordedActivations(dir: string): Recorded[] {
  const dirs = (path: string) =>
    readdirSync(path)
      .map((name) => join(path, name))
      .filter((p) => statSync(p).isDirectory())
      .sort();
  const out: Recorded[] = [];
  for (const workflowDir of dirs(dir)) {
    for (const runDir of dirs(workflowDir)) {
      for (const name of readdirSync(runDir).sort()) {
        if (name.endsWith('-activation.pb')) {
          const file = join(runDir, name);
          out.push({ file, bytes: readFileSync(file) });
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
 * children it schedules default to the worker's queue. */
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

/** The catalog's in-process activation counts, so each path sees the same. */
function snapshot(): () => void {
  const saved = new Map(activations);
  return () => {
    activations.clear();
    for (const [key, n] of saved) activations.set(key, n);
  };
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? join(homedir(), 'orcher-corpus', 'typescript');
  const native = getNativeModule() as any;
  for (const hook of [
    'kernelResolve',
    'legacyExecutionRequest',
    'kernelExecutionResult',
    'legacyExecutionResult',
  ]) {
    if (typeof native[hook] !== 'function') {
      throw new Error(`the native module has no ${hook}; rebuild it (npm run build)`);
    }
  }

  const recorded = recordedActivations(dir);
  let equal = 0;
  const differing: string[] = [];
  const byType = new Map<string, number>();
  const resolutionKinds = new Map<string, number>();
  for (const { file, bytes } of recorded) {
    const activation = RunActivation.fromBinary(native.kernelResolve(bytes, NAMESPACE));
    const worker = workerFor(activation.run?.taskQueue ?? '');
    const runId = activation.run?.runId ?? '';
    const workflowType = activation.run?.workflowType ?? '';
    // Both paths refuse a workflow they do not know the same way, which
    // would prove nothing.
    if (!worker.workflowMap.has(workflowType)) {
      differing.push(`${file}\n  ${workflowType} is not in the catalog`);
      continue;
    }
    byType.set(workflowType, (byType.get(workflowType) ?? 0) + 1);
    for (const resolution of activation.resolutions) {
      const kind = resolution.what.oneofKind ?? 'none';
      resolutionKinds.set(kind, (resolutionKinds.get(kind) ?? 0) + 1);
    }
    if (activation.queries.length > 0) {
      resolutionKinds.set('query', (resolutionKinds.get('query') ?? 0) + activation.queries.length);
    }
    const restore = snapshot();

    // Today's path.
    const request = JSON.parse(native.legacyExecutionRequest(bytes));
    const legacyJson = JSON.stringify(await worker.executeWorkflowDirectBindings(request));
    const legacy = JSON.parse(native.legacyExecutionResult(legacyJson));

    // The kernel path, from the same state.
    restore();
    const answer = await worker.runActivation(activation);
    let kernel: any;
    try {
      kernel = JSON.parse(
        native.kernelExecutionResult(runId, Buffer.from(RunActivationResult.toBinary(answer)))
      );
    } catch (error) {
      differing.push(`${file}\n  the kernel refused the answer: ${String(error)}`);
      continue;
    }

    // A failed workflow: today's path sends the steps it reached, the kernel
    // none. Allowed only when there were none.
    if (
      legacy.successful === false &&
      Array.isArray(legacy.reached_steps) &&
      legacy.reached_steps.length === 0 &&
      kernel.reached_steps == null
    ) {
      kernel.reached_steps = legacy.reached_steps;
    }

    if (isDeepStrictEqual(legacy, kernel)) {
      equal++;
    } else {
      differing.push(
        `${file} (${activation.run?.workflowType})\n` +
          `  today:  ${JSON.stringify(legacy)}\n` +
          `  kernel: ${JSON.stringify(kernel)}`
      );
    }
  }

  console.log(`workflows: ${[...byType].map(([type, n]) => `${type} ${n}`).join(', ')}`);
  console.log(`resolutions: ${[...resolutionKinds].map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  for (const difference of differing) {
    console.log(`DIFFERS ${difference}`);
  }
  console.log(
    `${recorded.length} recorded activations: ${equal} equal, ${differing.length} differing`
  );
  if (recorded.length === 0 || differing.length > 0) {
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
