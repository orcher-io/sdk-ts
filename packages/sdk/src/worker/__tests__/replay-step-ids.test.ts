/**
 * Step ids on replay: every step draws one number from one counter, on the
 * first run and on every replay alike.
 */

import { Duration } from '../../workflow/types';
import type { WorkflowContext } from '../../workflow/context';
import { FakeEngine, completion, issuedSteps, runToCompletion, runner, taskRef } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

describe('replay determinism', () => {
  it('issues every step under the id it first had, on every activation', async () => {
    const activate = runner(async (ctx) => {
      // A task and a timer in flight together, then a child, a closure and
      // another task, each after the one before it has finished.
      const [a] = await Promise.all([
        ctx.executeTask(taskRef('step_a'), 1),
        ctx.sleep(Duration.fromSeconds(5)),
      ]);
      const child = await ctx.executeChildWorkflow('child_wf', {});
      const closure = await ctx.execute('closure_c', async () => 'closure ran');
      const b = await ctx.executeTask(taskRef('step_b'), 2);
      return [a, child, closure, b];
    });
    const engine = new FakeEngine();

    const { issued, output } = await runToCompletion(activate, engine);

    // One counter for every kind of step, each id drawn once, whatever the
    // activation: the first run and every replay agree on all of them.
    expect(issued).toEqual([
      ['task', 'step_a_0', 'step_a'],
      ['timer', 'timer_1', ''],
      ['child', 'child_2', 'child_wf'],
      // Issued in one activation: the closure ran before the task was issued.
      ['closure', 'closure_c_3', ''],
      ['task', 'step_b_4', 'step_b'],
    ]);
    // Each step got its own result back.
    expect(output).toEqual(['step_a_0', 'child_2', 'closure ran', 'step_b_4']);

    // Replayed from the finished journal, as a worker that never saw the run
    // does: nothing is issued again, and the result is the same.
    const replay = await activate(engine);
    expect(issuedSteps(replay)).toEqual([]);
    expect(completion(replay)).toEqual(output);
  });

  it('gives each run of a closure in a loop its own step', async () => {
    let runs = 0;
    const activate = runner(async (ctx) => {
      const seen: number[] = [];
      for (let i = 0; i < 3; i++) {
        seen.push(await ctx.execute('tick', async () => ++runs));
        await ctx.sleep(Duration.fromSeconds(1));
      }
      return seen;
    });

    const { output } = await runToCompletion(activate, new FakeEngine());

    expect(output).toEqual([1, 2, 3]);
    expect(runs).toBe(3);
  });

  it.each([
    [
      'an event wait',
      async (ctx: WorkflowContext) => {
        const [go, a] = await Promise.all([
          ctx.waitForEvent<string>('go'),
          ctx.executeTask<number, string>(taskRef('step_a'), 1),
        ]);
        return [go, a, await ctx.executeTask(taskRef('step_b'), 2)];
      },
    ],
    [
      'an event wait with a timeout',
      async (ctx: WorkflowContext) => {
        const [go, a] = await Promise.all([
          ctx.waitForEventWithTimeout<string>('go', Duration.fromMinutes(5)),
          ctx.executeTask<number, string>(taskRef('step_a'), 1),
        ]);
        return [go, a, await ctx.executeTask(taskRef('step_b'), 2)];
      },
    ],
  ])('takes no step id for %s, parked or not', async (_label, run) => {
    const activate = runner(run);
    const engine = new FakeEngine();

    // Parks on the event; the task beside it runs.
    const first = await activate(engine);
    engine.apply(first);
    engine.deliverEvent('go', 'now');

    const { issued, output } = await runToCompletion(activate, engine);

    expect(issuedSteps(first).filter(([kind]) => kind === 'task')).toEqual([
      ['task', 'step_a_0', 'step_a'],
    ]);
    expect(issued.filter(([kind]) => kind === 'task')).toEqual([['task', 'step_b_1', 'step_b']]);
    expect(output).toEqual(['now', 'step_a_0', 'step_b_1']);
  });
});
