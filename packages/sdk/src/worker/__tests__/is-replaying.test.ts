/**
 * `isReplaying()` says whether the code is re-running what an earlier
 * activation of the run already ran: false throughout a run's first
 * activation, and in a later one false from where the code reaches work the
 * history has no outcome for. So each point in the code reads as new exactly
 * once, on the activation that first reaches it.
 */

import { Duration } from '../../workflow/types';
import { WorkflowContext } from '../../workflow/context';
import { FakeEngine, runToCompletion, runner, taskRef } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

describe('isReplaying', () => {
  it('reports each point as new exactly once', async () => {
    const readings: Array<[string, boolean]> = [];
    const activate = runner(async (ctx) => {
      readings.push(['start', ctx.isReplaying()]);
      await ctx.executeTask(taskRef('step_a'), 1);
      readings.push(['after task', ctx.isReplaying()]);
      await ctx.sleep(Duration.fromSeconds(60));
      readings.push(['after timer', ctx.isReplaying()]);
      await ctx.execute('closure_c', async () => 1);
      readings.push(['after closure', ctx.isReplaying()]);
      return true;
    });

    await runToCompletion(activate, new FakeEngine());

    // Activation 1 starts the run; 2 delivers the task's result; 3 the timer's.
    expect(readings).toEqual([
      ['start', false],
      ['start', true],
      ['after task', false],
      ['start', true],
      ['after task', true],
      ['after timer', false],
      ['after closure', false],
    ]);
  });

  const context = () =>
    new WorkflowContext(
      {
        workflowId: 'wf',
        runId: 'run',
        workflowType: 't',
        attempt: 1,
        namespace: 'ns',
        taskQueue: 'q',
      },
      false,
      '1.0.0',
      0
    );

  it('takes the newest unmarked outcome as the new one', () => {
    const ctx = context();
    ctx.noteOutcome(2, false);
    ctx.noteOutcome(5, false);
    expect(ctx.isReplaying()).toBe(true);
  });

  it('replays until the first outcome the activation marks as new', () => {
    const ctx = context();
    ctx.noteOutcome(1, true);
    ctx.noteOutcome(3, false);
    expect(ctx.isReplaying()).toBe(true);
  });

  it('replays throughout an activation with nothing new', () => {
    // An activation for a query: every outcome was seen before.
    const ctx = context();
    ctx.noteOutcome(1, true);
    ctx.noteOutcome(2, true);
    expect(ctx.isReplaying()).toBe(true);
  });

  it('lets a context built by hand say itself', () => {
    expect(context().isReplaying()).toBe(false);
  });
});
