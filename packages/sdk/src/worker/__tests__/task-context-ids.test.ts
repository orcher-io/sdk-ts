/**
 * A task's context names the task, its workflow and its run, read from the
 * assignment the worker host hands over.
 */

import { Worker } from '../worker';
import { getNativeModule } from '../../core/native';
import { HeartbeatAnswer, TaskAssignment, TaskOutcome } from '../../core/generated/host';
import type { Logger } from '../types';
import type { TaskContext } from '../../task/context';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A task as the worker host hands it over. */
const handedOver = TaskAssignment.toBinary(
  TaskAssignment.create({
    token: new TextEncoder().encode('token'),
    taskId: 'reportIds_0',
    taskType: 'reportIds',
    run: {
      workflowId: 'order-42',
      runId: '0199d3c4-run-7',
      workflowType: 'order',
      taskQueue: 'q',
      namespace: 'default',
    },
    input: [{ data: new TextEncoder().encode('null'), metadata: {} }],
    attempt: 1,
  })
);

describe('task context ids', () => {
  it('reads the task id, workflow id and run id the worker host sends', async () => {
    const reportIds = async (ctx: TaskContext) => ({
      taskId: ctx.taskId(),
      workflowId: ctx.workflowId(),
      runId: ctx.runId(),
    });
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      workflows: [],
      tasks: [Object.defineProperty(reportIds, 'name', { value: 'reportIds' })],
      logger: silent,
    });

    const outcomes: TaskOutcome[] = [];
    (getNativeModule as jest.Mock).mockReturnValue({
      hostCompleteTask: jest.fn(async (_host: unknown, outcome: Uint8Array) => {
        outcomes.push(TaskOutcome.fromBinary(outcome));
      }),
      hostHeartbeat: jest.fn(() => HeartbeatAnswer.toBinary({ cancelRequested: false })),
      hostTaskCancelled: jest.fn(() => new Promise(() => {})),
    });

    await (worker as any).handleTask({}, handedOver);

    expect(outcomes).toHaveLength(1);
    const result = outcomes[0]!.result;
    expect(result.oneofKind).toBe('value');
    const data = result.oneofKind === 'value' ? result.value.data : new Uint8Array();
    expect(JSON.parse(new TextDecoder().decode(data))).toEqual({
      taskId: 'reportIds_0',
      workflowId: 'order-42',
      runId: '0199d3c4-run-7',
    });
  });
});
