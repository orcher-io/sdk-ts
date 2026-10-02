/**
 * Workflow time comes from the journal, so a replay reads the same time at
 * each point in the code as the run it replays.
 */

import { Duration } from '../../workflow/types';
import { WorkflowTime } from '../../workflow/time';
import { FakeEngine, completion, runToCompletion, runner, taskRef } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

describe('workflow time', () => {
  it('comes from the journal and is the same on every replay', async () => {
    const readings: Array<[string, number]> = [];
    const activate = runner(async (ctx) => {
      const read = (label: string, value: number) => {
        readings.push([label, value]);
        return value;
      };
      const started = read('started', ctx.time.now().getTime());
      await ctx.executeTask(taskRef('step_a'), 1);
      const afterTask = read('after task', ctx.time.now().getTime());
      await ctx.sleep(Duration.fromSeconds(60));
      const afterTimer = read('after timer', ctx.time.now().getTime());
      await ctx.execute('closure_c', async () => 1);
      const afterClosure = read('after closure', ctx.time.now().getTime());
      const elapsed = read('elapsed', ctx.time.elapsedSecs());
      return [started, afterTask, afterTimer, afterClosure, elapsed, ctx.time.startTimeMs()];
    });
    const engine = new FakeEngine();

    const { output } = await runToCompletion(activate, engine);

    // Journal entries: 0 started, 1 task scheduled, 2 task completed,
    // 3 timer started, 4 timer fired, 5 closure recorded.
    const started = engine.entryMs(0);
    const taskCompleted = engine.entryMs(2);
    const timerFired = engine.entryMs(4);
    // A closure runs inline, so it moves nothing: the activation that ran it
    // and the replays that read its journaled result must agree.
    const expected = [
      started,
      taskCompleted,
      timerFired,
      timerFired,
      (timerFired - started) / 1000,
      started,
    ];
    expect(output).toEqual(expected);

    // Every activation that got as far as a reading took the same one.
    expect(readings.length).toBeGreaterThan(5);
    for (const [label, value] of readings) {
      expect([label, value]).toEqual(readings.find(([l]) => l === label));
    }

    // Replayed later against the same journal, it reads the same times: the
    // wall clock has moved on and the workflow's clock has not.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(completion(await activate(engine))).toEqual(expected);
  });

  it('moves to the time an event was journaled when the workflow takes it', async () => {
    const activate = runner(async (ctx) => {
      await ctx.waitForEvent('go');
      return ctx.time.now().getTime();
    });
    const engine = new FakeEngine();
    engine.apply(await activate(engine));
    engine.deliverEvent('go', 1);

    const { output } = await runToCompletion(activate, engine);

    expect(output).toBe(engine.entryMs(1));
  });
});

describe('WorkflowTime', () => {
  it('moves forward only, and measures elapsed time on its own clock', () => {
    const time = new WorkflowTime(1_000_000);
    expect(time.now().getTime()).toBe(1_000_000);

    time.advanceTo(1_090_000);
    time.advanceTo(1_030_000); // received out of journal order: ignored

    expect(time.now().getTime()).toBe(1_090_000);
    expect(time.startedAt().getTime()).toBe(1_000_000);
    expect(time.elapsed()).toBe(90_000);
    expect(time.elapsedSecs()).toBe(90);
    expect(time.hasElapsed(90_000)).toBe(true);
    expect(time.hasElapsed(90_001)).toBe(false);
    expect(time.remainingMs(100_000)).toBe(10_000);
    expect(time.remainingSecs(60)).toBe(0);
  });
});
