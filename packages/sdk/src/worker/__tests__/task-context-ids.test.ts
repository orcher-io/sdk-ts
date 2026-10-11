/**
 * A task's context names the task, its workflow and its run, read from the
 * request the native worker hands over.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';
import type { TaskContext } from '../../task/context';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * A task as the native worker hands it over, in the fields and spelling of the
 * JSON `native/src/worker.rs` builds for each task: `execution_id` carries the
 * run id, and `input` the JSON bytes of the input.
 */
const handedOver = {
  task_id: 'reportIds_0',
  task_type: 'reportIds',
  task_token: Buffer.from('token').toString('base64'),
  workflow_id: 'order-42',
  execution_id: '0199d3c4-run-7',
  task_queue: 'q',
  input: Array.from(new TextEncoder().encode('null')),
  attempt: 1,
  heartbeat_timeout_ms: null,
};

describe('task context ids', () => {
  it('reads the task id, workflow id and run id the native worker sends', async () => {
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

    const completed: string[] = [];
    const nativeModule = {
      completeTask: jest.fn(async (_svc: unknown, _token: string, resultJson: string) => {
        completed.push(resultJson);
      }),
      failTask: jest.fn(async () => undefined),
      heartbeatTask: jest.fn(async () => JSON.stringify({ cancelRequested: false })),
      waitTaskCancelled: jest.fn(() => new Promise(() => {})),
    };
    (worker as any).nativeService = {};

    await (worker as any).handleTask(nativeModule, JSON.parse(JSON.stringify(handedOver)));

    expect(nativeModule.failTask).not.toHaveBeenCalled();
    expect(JSON.parse(completed[0]!)).toEqual({
      taskId: 'reportIds_0',
      workflowId: 'order-42',
      runId: '0199d3c4-run-7',
    });
  });
});
