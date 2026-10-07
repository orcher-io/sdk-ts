/**
 * `task({ heartbeatTimeout })` reaches the schedule command.
 *
 * The option was declared on the definition and then dropped, so a task that
 * declared heartbeat supervision ran without it.
 */

import { task } from '../task';
import { WorkflowContext, WorkflowCommandType } from '../../workflow/context';
import { Duration } from '../../workflow/types';
import { globalRegistry } from '../../di/registry';
import { ErrorCode } from '../../errors';
import type { TaskReference } from '../../di/types';
import type { TaskExecuteOptions } from '../../workflow/context';

const execution = {
  workflowId: 'wf-1',
  runId: 'run-1',
  workflowType: 'test-workflow',
  attempt: 1,
  namespace: 'default',
  taskQueue: 'test-queue',
};

/** Schedule the task and return the SCHEDULE_TASK command it emitted. */
async function schedule(ref: TaskReference<any, any>, options?: TaskExecuteOptions) {
  const ctx = new WorkflowContext(execution, false, '1.0.0', Date.now());
  await expect(ctx.executeTask(ref, {}, options)).rejects.toMatchObject({
    code: ErrorCode.WORKFLOW_SUSPENDED,
  });
  const [command] = ctx.takeCommands() as any[];
  expect(command.type).toBe(WorkflowCommandType.SCHEDULE_TASK);
  return command;
}

describe('task({ heartbeatTimeout })', () => {
  afterEach(() => globalRegistry.clear());

  it('is carried on the reference and sent with the task', async () => {
    const ref = task({
      name: 'long-export',
      heartbeatTimeout: 30_000,
      execute: async () => 'done',
    });

    expect(ref.heartbeatTimeout).toBe(30_000);
    expect((await schedule(ref)).heartbeatTimeoutMs).toBe(30_000);
  });

  it('gives way to a heartbeat timeout passed for one call', async () => {
    const ref = task({
      name: 'long-export',
      heartbeatTimeout: 30_000,
      execute: async () => 'done',
    });

    const command = await schedule(ref, { heartbeatTimeout: Duration.fromSeconds(5) });
    expect(command.heartbeatTimeoutMs).toBe(5_000);
  });

  it('leaves supervision off when neither declares one', async () => {
    const ref = task({ name: 'quick', execute: async () => 'done' });

    expect((await schedule(ref)).heartbeatTimeoutMs).toBeUndefined();
  });
});
