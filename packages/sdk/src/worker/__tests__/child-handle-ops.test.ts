/**
 * A parent sends events to, and cancels, a child through its handle, once
 * however often it replays; a child that ends without a result fails the
 * parent's wait instead of leaving it parked.
 */

import { Duration } from '../../workflow/types';
import { ChildWorkflowFailedError } from '../../workflow/child-handle';
import { isWorkflowSuspension } from '../../errors';
import {
  FakeEngine,
  bytes,
  runToCompletion,
  runner,
  type ChildOutcome,
} from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

describe('child workflow handle', () => {
  const sentOf = (engine: FakeEngine, kind: string) =>
    engine.sent
      .map((c) => c.what as Record<string, any>)
      .filter((what) => what.oneofKind === kind)
      .map((what) => what[kind]);

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
    // Any run of the child receives it.
    expect(sentOf(engine, 'sendEvent')).toEqual([
      {
        workflowId: 'child_0',
        runId: '',
        name: 'go',
        payload: { data: bytes('now'), metadata: {} },
        headers: {},
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

    expect(sentOf(engine, 'cancelChild')).toEqual([{ stepId: 'child_0' }]);
  });

  it.each([
    ['canceled', { kind: 'canceled' } as ChildOutcome, /canceled/],
    // The kernel does not carry the reason a child was terminated for.
    ['terminated', { kind: 'terminated', reason: 'by hand' } as ChildOutcome, /terminated/],
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
