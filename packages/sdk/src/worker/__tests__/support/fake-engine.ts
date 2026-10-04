/**
 * A fake engine for driving workflows through the worker as the native layer
 * drives them.
 *
 * A small in-memory engine journals what each activation asks for, resolves
 * it, and hands the grown journal to the next activation as sdk-core would:
 * the jobs derived from the journal, and the times the journal recorded. Every
 * activation runs the workflow from the start against that journal, so a step
 * id or a clock reading that depends on how far the run had got shows up as a
 * difference between activations.
 *
 * A test using it mocks `core/native`, so constructing the worker connects to
 * nothing.
 */

import { Worker } from '../../worker';
import type { Logger } from '../../types';
import type { WorkflowContext } from '../../../workflow/context';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Where the fake engine's clock starts: 2020-09-13, nowhere near the wall
 * clock, so a reading taken from the wall clock cannot pass for it. */
const ENGINE_EPOCH_MS = 1_600_000_000_000;
/** How far the fake engine's clock moves between two journal entries. */
const ENTRY_GAP_MS = 7_000;

export const bytes = (value: unknown): number[] =>
  Array.from(new TextEncoder().encode(JSON.stringify(value)));

/** A task reference by name, as `@Task` would generate. */
export const taskRef = (taskName: string): any => ({
  taskName,
  handlerClass: class {},
  methodName: 'run',
});

interface Entry {
  atMs: number;
  /** The job sdk-core derives from the entry, if any. */
  job?: Record<string, unknown>;
  /** What the native layer reads the entry's time under, if anything. */
  resolves?: string;
  event?: string;
  started?: true;
}

export type ChildOutcome =
  | { kind: 'completed' }
  | { kind: 'running' }
  | { kind: 'canceled' }
  | { kind: 'terminated'; reason: string }
  | { kind: 'timed_out' };

/** An engine that journals and resolves whatever an activation asks for. */
export class FakeEngine {
  readonly journal: Entry[] = [];
  /** Every command an activation sent, in order. */
  readonly sent: Array<Record<string, any>> = [];
  private clockMs = ENGINE_EPOCH_MS;

  constructor(
    private readonly input: unknown = {},
    private readonly child: ChildOutcome = { kind: 'completed' }
  ) {
    this.append({ started: true });
  }

  private append(entry: Omit<Entry, 'atMs'>): void {
    this.journal.push({ ...entry, atMs: this.clockMs });
    this.clockMs += ENTRY_GAP_MS;
  }

  /** When the entry at `index` was recorded, in ms. */
  entryMs(index: number): number {
    return this.journal[index]!.atMs;
  }

  /** Deliver an event, as a client's SendEvent would. */
  deliverEvent(name: string, payload: unknown): void {
    this.append({
      event: name,
      job: {
        HandleEvent: {
          sequence: this.journal.length,
          event_name: name,
          payload: { data: bytes(payload), metadata: {} },
          headers: [],
          event_id: String(this.journal.length + 1),
        },
      },
    });
  }

  /** The request the native layer hands the worker for the journal as it is. */
  request(): Record<string, unknown> {
    const resolvedAt: Record<string, number> = {};
    const events: Record<string, number[]> = {};
    let startedAtMs: number | null = null;
    for (const entry of this.journal) {
      if (entry.started && startedAtMs === null) startedAtMs = entry.atMs;
      if (entry.resolves && !(entry.resolves in resolvedAt)) {
        resolvedAt[entry.resolves] = entry.atMs;
      }
      if (entry.event) (events[entry.event] ??= []).push(entry.atMs);
    }
    return {
      run_id: 'run-replay',
      execution: { workflow_id: 'wf-replay', run_id: 'run-replay' },
      jobs: [
        {
          StartWorkflow: {
            workflow_type: 'under_test',
            workflow_id: 'wf-replay',
            task_queue: 'replay',
            input: this.input,
          },
        },
        ...this.journal.filter((e) => e.job).map((e) => e.job),
      ],
      journal_length: this.journal.length,
      is_replaying: this.journal.length > 1,
      journal_times: { started_at_ms: startedAtMs, resolved_at: resolvedAt, events },
    };
  }

  /** Journal and resolve what an activation asked for. A task's result is its
   * own step id and a child's is its workflow id, so a workflow handed another
   * step's result says so in its output. Timers of a minute or less fire at
   * once. */
  apply(commands: Array<Record<string, any>>): void {
    for (const command of commands) {
      this.sent.push(command);
      const [kind, cmd] = Object.entries(command)[0]!;
      switch (kind) {
        case 'ScheduleTask':
          this.append({});
          this.append({
            resolves: cmd.task_id,
            job: {
              CompleteStep: {
                step_name: cmd.task_id,
                step_type: 1,
                result: bytes(cmd.task_id),
                failure: null,
                execution_attempt: 1,
              },
            },
          });
          break;
        case 'StartTimer':
          this.append({});
          // A timer of a minute or less fires at once; a longer one stays
          // pending, so an event can arrive before it.
          if (cmd.duration.secs * 1000 + cmd.duration.nanos / 1e6 > 60_000) break;
          this.append({
            resolves: `timer:${cmd.timer_id}`,
            job: { FireTimer: { sequence: this.journal.length, timer_id: cmd.timer_id } },
          });
          break;
        case 'StartChildWorkflow':
          this.applyChild(cmd);
          break;
        case 'RecordStepResult': {
          // Lenient about the result's shape: the bridge shape has its own test.
          const result = Array.isArray(cmd.result) ? cmd.result : bytes(cmd.result);
          this.append({
            resolves: cmd.step_name,
            job: {
              CompleteStep: {
                step_name: cmd.step_name,
                step_type: cmd.step_type,
                result,
                failure: null,
                execution_attempt: 1,
              },
            },
          });
          break;
        }
        default:
          break;
      }
    }
  }

  private applyChild(cmd: any): void {
    const id = cmd.workflow_id;
    this.append({
      job: {
        ChildWorkflowStarted: {
          workflow_id: id,
          execution_id: `run-${id}`,
          workflow_type: cmd.workflow_type,
          namespace: 'default',
        },
      },
    });
    const resolves = `child:${id}`;
    const ids = { workflow_id: id, execution_id: `run-${id}` };
    switch (this.child.kind) {
      case 'running':
        return;
      case 'completed':
        this.append({
          resolves,
          job: { ChildWorkflowCompleted: { ...ids, result: { data: bytes(id), metadata: {} } } },
        });
        return;
      case 'canceled':
        this.append({ resolves, job: { ChildWorkflowCanceled: { ...ids, details: null } } });
        return;
      case 'terminated':
        this.append({
          resolves,
          job: {
            ChildWorkflowTerminated: { ...ids, reason: this.child.reason, details: null },
          },
        });
        return;
      case 'timed_out':
        this.append({
          resolves,
          job: { ChildWorkflowTimedOut: { ...ids, timeout_type: 'Execution' } },
        });
        return;
    }
  }
}

/** A step an activation issued: its kind, its id, and the work it names. */
export type Issued = [string, string, string];

export function issuedSteps(commands: Array<Record<string, any>>): Issued[] {
  const issued: Issued[] = [];
  for (const command of commands) {
    const [kind, cmd] = Object.entries(command)[0]!;
    if (kind === 'ScheduleTask') issued.push(['task', cmd.task_id, cmd.task_type]);
    if (kind === 'StartTimer') issued.push(['timer', cmd.timer_id, '']);
    if (kind === 'StartChildWorkflow') issued.push(['child', cmd.workflow_id, cmd.workflow_type]);
    if (kind === 'RecordStepResult') issued.push(['closure', cmd.step_name, '']);
  }
  return issued;
}

export function completion(commands: Array<Record<string, any>>): unknown {
  const complete = commands.find((c) => 'CompleteWorkflow' in c);
  if (!complete) return undefined;
  const data: number[] = complete['CompleteWorkflow'].result.data;
  return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
}

/** Run one activation of `run` against the journal as it is, and return
 * the result the worker hands sdk-core, unchecked. */
export function activation(run: (ctx: WorkflowContext, input: any) => Promise<unknown>) {
  const workflow = async (ctx: WorkflowContext, input: any) => run(ctx, input);
  Object.defineProperty(workflow, 'name', { value: 'under_test' });
  const worker = new Worker({
    serverUrl: 'http://localhost:1',
    namespace: 'default',
    taskQueue: 'replay',
    workflows: [workflow],
    tasks: [],
    logger: silent,
  });
  return async (engine: FakeEngine): Promise<Record<string, any>> =>
    (worker as any).executeWorkflowDirectBindings(engine.request());
}

export function runner(run: (ctx: WorkflowContext, input: any) => Promise<unknown>) {
  const activate = activation(run);
  return async (engine: FakeEngine): Promise<Array<Record<string, any>>> => {
    const result = await activate(engine);
    if (!result.successful) {
      throw new Error(`the activation failed: ${result.error?.message}`);
    }
    // What the core checks before sending: no step id the journal recorded
    // reissued for other work.
    const journaled = new Set(engine.sent.flatMap((c) => issuedSteps([c]).map((s) => s.join('|'))));
    for (const step of issuedSteps(result.commands)) {
      const sameId = [...journaled].find((j) => j.split('|')[1] === step[1]);
      if (sameId && sameId !== step.join('|')) {
        throw new Error(`step ${step[1]} reissued for other work: ${sameId} -> ${step.join('|')}`);
      }
    }
    // And that it reached every step the journal recorded, if it issues new
    // work or ends the workflow: the rule sdk-core holds an activation to,
    // using the steps the activation reports it reached.
    leftBehind(engine, result);
    return result.commands;
  };
}

/** Throw as sdk-core would refuse the activation: a step the journal
 * recorded that the code did not reach, while it issues new work or ends the
 * workflow. */
export function leftBehind(engine: FakeEngine, result: Record<string, any>): void {
  if (!Array.isArray(result.reached_steps)) {
    throw new Error('the activation does not report the steps it reached');
  }
  const recorded = [
    ...new Set(
      engine.sent
        .flatMap((c) => issuedSteps([c]))
        .filter(([kind]) => kind !== 'closure')
        .map(([, id]) => id)
    ),
  ];
  const issued = issuedSteps(result.commands).filter(([kind]) => kind !== 'closure');
  const reached = new Set<string>([...result.reached_steps, ...issued.map(([, id]) => id)]);
  const newWork = issued.find(([, id]) => !recorded.includes(id));
  const ends = result.commands.find(
    (c: Record<string, unknown>) =>
      'CompleteWorkflow' in c || 'FailWorkflow' in c || 'RestartFresh' in c
  );
  const left = recorded.filter((id) => !reached.has(id));
  if ((newWork || ends || !result.successful) && left.length > 0) {
    throw new Error(
      `non-deterministic: recorded ${left.join(', ')} not reached, and the code ${
        newWork ? `issued ${newWork.join(' ')}` : ends ? 'ended the workflow' : 'failed'
      }`
    );
  }
}

/** Drive a workflow to completion, one activation per journal state. */
export async function runToCompletion(
  activate: (engine: FakeEngine) => Promise<Array<Record<string, any>>>,
  engine: FakeEngine,
  { maxActivations = 16 } = {}
): Promise<{ issued: Issued[]; output: unknown }> {
  const issued: Issued[] = [];
  for (let i = 0; i < maxActivations; i++) {
    const commands = await activate(engine);
    issued.push(...issuedSteps(commands));
    engine.apply(commands);
    const output = completion(commands);
    if (output !== undefined) return { issued, output };
  }
  throw new Error(`the workflow did not complete; it issued ${JSON.stringify(issued)}`);
}
