/**
 * Commands reach sdk-core in the shape it deserializes: a command it cannot
 * parse fails the whole activation.
 */

import { Duration } from '../../workflow/types';
import type { WorkflowContext } from '../../workflow/context';
import { FakeEngine, bytes, runner, taskRef } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

describe('commands as sdk-core deserializes them', () => {
  const firstActivation = async (run: (ctx: WorkflowContext) => Promise<unknown>) =>
    runner(run)(new FakeEngine());

  it('sends a closure result as bytes, with its attempt', async () => {
    const commands = await firstActivation(async (ctx) => {
      await ctx.execute('fetch', async () => ({ id: 7 }));
      return ctx.executeTask(taskRef('next'), 0);
    });

    expect(commands.find((c) => 'RecordStepResult' in c)).toEqual({
      RecordStepResult: {
        step_name: 'fetch_0',
        step_type: 2,
        result: bytes({ id: 7 }),
        failure: null,
        execution_attempt: 1,
      },
    });
  });

  it.each([
    ['milliseconds', 90_000],
    ['a Duration', Duration.fromSeconds(90)],
  ])('sends a restart timeout given in %s as a Duration', async (_label, timeout) => {
    const commands = await firstActivation(async (ctx) => {
      ctx.restartFresh({ n: 1 }, { timeout });
      return null;
    });

    expect(commands.find((c) => 'RestartFresh' in c)!['RestartFresh'].timeout).toEqual({
      secs: 90,
      nanos: 0,
    });
  });

  it('sends a child timeout as a Duration', async () => {
    const commands = await firstActivation(async (ctx) =>
      ctx.executeChildWorkflow('child_wf', {}, { timeout: Duration.fromMilliseconds(1_500) })
    );

    expect(commands.find((c) => 'StartChildWorkflow' in c)!['StartChildWorkflow'].timeout).toEqual(
      { secs: 1, nanos: 500_000_000 }
    );
  });
});
