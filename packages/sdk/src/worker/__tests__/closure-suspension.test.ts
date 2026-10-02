/**
 * A closure's result is reported with the activation that ran it, whether the
 * workflow completes or suspends, so later activations do not run it again.
 */

import { FakeEngine, runToCompletion, runner, taskRef } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

describe('closures', () => {
  it('runs a closure once when the activation that ran it suspends', async () => {
    let runs = 0;
    const activate = runner(async (ctx) => {
      // The task suspends at once; the closure beside it is still running.
      const [a, side] = await Promise.all([
        ctx.executeTask<number, string>(taskRef('step_a'), 1),
        ctx.execute('side', async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          runs += 1;
          return 'once';
        }),
      ]);
      return [a, side];
    });
    const engine = new FakeEngine();

    const { issued, output } = await runToCompletion(activate, engine);

    expect(output).toEqual(['step_a_0', 'once']);
    expect(runs).toBe(1);
    // Reported in the activation that ran it, ahead of that activation's
    // other commands.
    expect(issued).toEqual([
      ['closure', 'side_1', ''],
      ['task', 'step_a_0', 'step_a'],
    ]);
  });

  it('reports a closure that ran before the workflow suspended with that activation', async () => {
    let runs = 0;
    const activate = runner(async (ctx) => {
      const side = await ctx.execute('side', async () => ++runs);
      const a = await ctx.executeTask(taskRef('step_a'), 1);
      return [side, a];
    });

    const { output } = await runToCompletion(activate, new FakeEngine());

    expect(output).toEqual([1, 'step_a_1']);
    expect(runs).toBe(1);
  });
});
