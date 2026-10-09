/**
 * A request to cancel a workflow reaches its code once, at the right wait.
 *
 * The first wait whose result the journal did not record before the request
 * throws the cancellation; waits after it run normally, so cleanup is scheduled
 * and completes. Which wait is decided by the journal's recorded times, so a
 * replay delivers it at the same place as the original run.
 */

import { WorkflowContext } from '../context';
import { Duration } from '../types';
import { WorkflowError, ErrorCode, isWorkflowCancellation } from '../../errors';
import type { TaskReference } from '../../di/types';

const execution = {
  workflowId: 'wf',
  runId: 'run',
  workflowType: 'T',
  attempt: 1,
  namespace: 'default',
  taskQueue: 'q',
};

const ref = (taskName: string) =>
  ({ taskName, handlerClass: class {}, methodName: 'run' }) as unknown as TaskReference<number, number>;
const work = ref('work');
const refund = ref('refund');

function replaying(): WorkflowContext {
  return new WorkflowContext(execution as any, true, '1.0.0', 0);
}

/** `work_0` completed at 1000 ms; the request came at 2000 ms. */
function askedToCancel(): WorkflowContext {
  const ctx = replaying();
  ctx.injectStepResult('work_0', 1);
  ctx.recordResolvedAt({ work_0: 1_000 });
  ctx.noteCancelRequested(2_000);
  return ctx;
}

async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (e) {
    return e;
  }
}

const isCancellation = (e: unknown) => e instanceof WorkflowError && isWorkflowCancellation(e);
const isSuspension = (e: unknown) =>
  e instanceof WorkflowError && e.code === ErrorCode.WORKFLOW_SUSPENDED;

describe('cancellation requests', () => {
  it('receives a result recorded before the request', async () => {
    const ctx = askedToCancel();
    expect(await ctx.executeTask(work, 0)).toBe(1);
    expect(ctx.isCancelRequested()).toBe(false);
  });

  it('tells the first wait without an earlier result, once', async () => {
    const ctx = askedToCancel();
    await ctx.executeTask(work, 0);

    expect(isCancellation(await outcome(() => ctx.executeTask(work, 1)))).toBe(true);
    expect(ctx.isCancelRequested()).toBe(true);

    // Cleanup: the next wait is scheduled as usual, not cancelled again.
    expect(isSuspension(await outcome(() => ctx.executeTask(refund, 2)))).toBe(true);
  });

  it('tells the same wait on every replay', async () => {
    // The interrupted step may have a result by now, recorded after the request.
    const ctx = askedToCancel();
    ctx.injectStepResult('work_1', 2);
    ctx.recordResolvedAt({ work_1: 3_000 });
    await ctx.executeTask(work, 0);

    expect(isCancellation(await outcome(() => ctx.executeTask(work, 1)))).toBe(true);
  });

  it('receives a result recorded with the request', async () => {
    const ctx = replaying();
    ctx.injectStepResult('work_0', 1);
    ctx.recordResolvedAt({ work_0: 2_000 });
    ctx.noteCancelRequested(2_000);
    expect(await ctx.executeTask(work, 0)).toBe(1);
  });

  it('cancels nothing without a request', async () => {
    const ctx = replaying();
    expect(isSuspension(await outcome(() => ctx.executeTask(work, 0)))).toBe(true);
    expect(ctx.isCancelRequested()).toBe(false);
  });

  it('tells a sleep whose timer had not fired', async () => {
    const ctx = replaying();
    ctx.noteCancelRequested(2_000);
    expect(isCancellation(await outcome(() => ctx.sleep(Duration.fromMinutes(10))))).toBe(true);
  });

  it('receives an event recorded before the request, then tells the next wait', async () => {
    const ctx = replaying();
    ctx.bufferEvent('go', 7, 0, 1_000);
    ctx.noteCancelRequested(2_000);
    expect(await ctx.waitForEvent('go')).toBe(7);
    expect(isCancellation(await outcome(() => ctx.waitForEvent('go')))).toBe(true);
  });
});
