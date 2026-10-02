/**
 * The executor bounds a workflow activation with a timer, and must not leave it
 * running once the activation has finished: an hour-long timer per activation
 * keeps the process alive and adds up on a busy worker.
 */

import { WorkflowExecutor } from '../workflow-executor';
import type { ExecutionRequest, Logger } from '../types';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const request: ExecutionRequest = {
  executionId: 'run-1',
  type: 'wf',
  input: {},
  metadata: { workflowId: 'wf-1', runId: 'run-1', attempt: 1, taskQueue: 'q', namespace: 'test' },
};

describe('workflow activation timeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([
    ['completes', async () => 'done'],
    [
      'fails',
      async () => {
        throw new Error('boom');
      },
    ],
  ])('leaves no timer behind when the workflow %s', async (_label, run) => {
    const workflow = async () => run();
    Object.defineProperty(workflow, 'name', { value: 'wf' });

    await new WorkflowExecutor({ logger }).execute(workflow, request);

    expect(jest.getTimerCount()).toBe(0);
  });
});
