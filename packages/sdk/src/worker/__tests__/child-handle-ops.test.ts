/**
 * A parent sends events to, and cancels, a child through its handle, once
 * however often it replays; a child that ends without a result fails the
 * parent's wait instead of leaving it parked.
 */

import { Duration } from '../../workflow/types';
import { ChildWorkflowFailedError } from '../../workflow/child-handle';
import { isWorkflowSuspension } from '../../errors';
import { FakeEngine, bytes, runToCompletion, runner, type ChildOutcome } from './support/fake-engine';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

describe('child workflow handle', () => {
  const sendersOf = (engine: FakeEngine, kind: string) =>
    engine.sent.filter((c) => kind in c).map((c) => c[kind]);

  it('sends an event to the child once, however often the parent replays', async () => {
    const activate = runner(async (ctx) => {
      const child = await ctx.startChildWorkflow('receiver', {});
      await child.sendEvent('go', 'now');
      await ctx.sleep(Duration.fromSeconds(1));
      await ctx.sleep(Duration.fromSeconds(1));
      return 'sent';
    });
    const engine = new FakeEngine({}, { kind: 'running' });

    const { output } = await runToCompletion(activate, engine);

    expect(output).toBe('sent');
    expect(sendersOf(engine, 'SendEvent')).toEqual([
      {
        workflow_id: 'child_0',
        run_id: null,
        event_name: 'go',
        payload: { data: bytes('now'), metadata: {} },
        headers: [],
      },
    ]);
  });

  it('cancels the child once, however often the parent replays', async () => {
    const activate = runner(async (ctx) => {
      const child = await ctx.startChildWorkflow('sleeper', {});
      await ctx.sleep(Duration.fromSeconds(1));
      await child.cancel();
      await ctx.sleep(Duration.fromSeconds(1));
      return 'canceled';
    });
    const engine = new FakeEngine({}, { kind: 'running' });

    await runToCompletion(activate, engine);

    expect(sendersOf(engine, 'CancelChildWorkflow')).toEqual([
      { workflow_id: 'child_0', run_id: '' },
    ]);
  });

  it.each([
    ['canceled', { kind: 'canceled' } as ChildOutcome, /canceled/],
    ['terminated', { kind: 'terminated', reason: 'by hand' } as ChildOutcome, /terminated: by hand/],
    ['timed out', { kind: 'timed_out' } as ChildOutcome, /timed out/],
  ])('fails the result of a child that was %s', async (_label, outcome, message) => {
    const activate = runner(async (ctx) => {
      const child = await ctx.startChildWorkflow('sleeper', {});
      try {
        return await child.result();
      } catch (error) {
        if (isWorkflowSuspension(error)) throw error;
        expect(error).toBeInstanceOf(ChildWorkflowFailedError);
        return (error as Error).message;
      }
    });

    const { output } = await runToCompletion(activate, new FakeEngine({}, outcome));

    expect(output).toMatch(message);
  });
});
