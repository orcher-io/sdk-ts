/**
 * Commands go out as the kernel protocol carries them; one it cannot carry is
 * refused with a protocol error, which hands the activation back rather than
 * failing the run.
 */

import { Duration } from '../../workflow/types';
import type { WorkflowContext } from '../../workflow/context';
import { FakeEngine, activation, bytes, runner, taskRef } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

describe('commands as the kernel protocol carries them', () => {
  const firstActivation = async (run: (ctx: WorkflowContext) => Promise<unknown>) =>
    runner(run)(new FakeEngine());

  it('sends a closure result as the JSON of its value', async () => {
    const commands = await firstActivation(async (ctx) => {
      await ctx.execute('fetch', async () => ({ id: 7 }));
      return ctx.executeTask(taskRef('next'), 0);
    });

    const recorded = commands.find((c) => c.what.oneofKind === 'recordValue')!;
    expect(recorded.stepId).toBe('fetch_0');
    expect((recorded.what as any).recordValue.outcome.result).toEqual({
      oneofKind: 'value',
      value: { data: bytes({ id: 7 }), metadata: {} },
    });
  });

  it.each([
    ['milliseconds', 90_000],
    ['a Duration', Duration.fromSeconds(90)],
  ])('refuses a restart with a timeout, given in %s', async (_label, timeout) => {
    const answered = await activation(async (ctx) => {
      ctx.restartFresh({ n: 1 }, { timeout });
      return null;
    })(new FakeEngine());

    expect(answered.answer.outcome.oneofKind).toBe('protocolError');
    expect(answered.error).toMatch(/restarted with a timeout/);
  });

  it('sends a child timeout as a Duration', async () => {
    const commands = await firstActivation(async (ctx) =>
      ctx.executeChildWorkflow('child_wf', {}, { timeout: Duration.fromMilliseconds(1_500) })
    );

    const started = commands.find((c) => c.what.oneofKind === 'startChild')!.what as any;
    expect(started.startChild.executionTimeout).toEqual({ seconds: '1', nanos: 500_000_000 });
  });
});
