/**
 * The steps an activation reports it reached, which sdk-core checks against
 * the steps the journal recorded to tell code that no longer replays a run.
 *
 * The fake engine's runner applies sdk-core's rule to every activation: a
 * recorded step the code did not reach, in an activation that issues new
 * work or ends the workflow, is refused as non-deterministic.
 */

import type { WorkflowContext } from '../../workflow/context';
import {
  FakeEngine,
  activation,
  completion,
  issuedSteps,
  runner,
  taskRef,
} from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

/** A status watch: wait for a `status` event with a deadline, apply what
 * came (or nothing) with a task, and escalate after `quietCap` rounds in a
 * row with no event. A deadline of a minute or less fires at once in the
 * fake engine; a longer one stays pending until an event arrives. */
const statusWatch =
  (quietCap: number, deadlineMs = 4_000) =>
  async (ctx: WorkflowContext) => {
    let quiet = 0;
    for (let round = 1; ; round++) {
      const ev = await ctx.waitForEventWithTimeout<{ state: string }>('status', deadlineMs);
      const applied = await ctx.executeTask<unknown, string>(taskRef('applyStatus'), { round, ev });
      if (ev?.state === 'paid') return `paid at round ${round} (${applied})`;
      quiet = ev ? 0 : quiet + 1;
      if (quiet >= quietCap) {
        await ctx.executeTask(taskRef('escalate'), round);
        return `escalated at round ${round}`;
      }
    }
  };

/** Run `activate` `times` times against `engine`, journaling what each asks. */
async function advance(
  activate: (engine: FakeEngine) => Promise<Array<Record<string, any>>>,
  engine: FakeEngine,
  times: number
): Promise<void> {
  for (let i = 0; i < times; i++) engine.apply(await activate(engine));
}

describe('reached steps', () => {
  it('reports every step reached, from the journal or issued, in order', async () => {
    const engine = new FakeEngine();
    // Three quiet rounds journaled; the fourth wait is issued.
    await advance(runner(statusWatch(5)), engine, 6);

    const result = await activation(statusWatch(5))(engine);
    expect(issuedSteps(result.commands)).toEqual([['timer', 'event_timeout_status_4', '']]);
    expect(result.reached_steps).toEqual([
      'event_timeout_status_1',
      'applyStatus_0',
      'event_timeout_status_2',
      'applyStatus_1',
      'event_timeout_status_3',
      'applyStatus_2',
      'event_timeout_status_4',
    ]);
  });

  it('refuses a loop cut short where the journal goes on', async () => {
    const engine = new FakeEngine();
    // The old code gives up after five quiet rounds; three are journaled.
    await advance(runner(statusWatch(5)), engine, 6);

    // The new code gives up after one. Replaying, it takes round one from
    // the journal and schedules the escalation where the journal holds
    // round two: what used to complete silently down the new path.
    await expect(runner(statusWatch(1))(engine)).rejects.toThrow(
      'non-deterministic: recorded event_timeout_status_2, applyStatus_1, ' +
        'event_timeout_status_3, applyStatus_2 not reached, and the code issued task escalate_1 escalate'
    );

    // The old code carries the same run on.
    const commands = await runner(statusWatch(5))(engine);
    expect(issuedSteps(commands)).toEqual([['timer', 'event_timeout_status_4', '']]);
  });

  it('lets a compatible change replay: the cap raised past the recorded rounds', async () => {
    const engine = new FakeEngine();
    await advance(runner(statusWatch(3)), engine, 4);
    let output: unknown;
    const raised = runner(statusWatch(6));
    for (let i = 0; i < 16 && output === undefined; i++) {
      const commands = await raised(engine);
      engine.apply(commands);
      output = completion(commands);
    }
    expect(output).toBe('escalated at round 6');
  });

  it('does not count events left unread, or deadlines the event beat', async () => {
    const engine = new FakeEngine();
    // A deadline long enough to stay pending: each round is decided by an
    // event, and the deadline timer it started is left unread.
    const watch = runner(statusWatch(1, 10 * 60_000));
    engine.apply(await watch(engine));
    engine.deliverEvent('status', { state: 'pending' });
    // Events beyond what the code will ever wait for stay buffered.
    engine.deliverEvent('status', { state: 'pending' });
    engine.deliverEvent('other', { anything: true });
    engine.apply(await watch(engine));
    engine.deliverEvent('status', { state: 'paid' });
    engine.deliverEvent('status', { state: 'late' });

    let output: unknown;
    for (let i = 0; i < 8 && output === undefined; i++) {
      const commands = await watch(engine);
      engine.apply(commands);
      output = completion(commands);
    }
    expect(output).toBe('paid at round 3 (applyStatus_2)');
  });
});
