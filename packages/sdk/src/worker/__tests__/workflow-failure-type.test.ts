/**
 * What a failed workflow tells the core about its error.
 *
 * The core fails an execution whose SDK reports `NonDeterminism` as a
 * non-retryable `NonDeterminismError`; any other kind is reported as workflow
 * code.
 */

import { WorkflowExecutor } from '../workflow-executor';
import type { ExecutionRequest, Logger } from '../types';
import { WorkflowError } from '../../errors';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const request: ExecutionRequest = {
  executionId: 'run-1',
  type: 'wf',
  input: {},
  metadata: {
    workflowId: 'wf-1',
    runId: 'run-1',
    attempt: 1,
    taskQueue: 'default',
    namespace: 'test',
  },
};

async function failureType(error: Error): Promise<unknown> {
  const workflow = async () => {
    throw error;
  };
  Object.defineProperty(workflow, 'name', { value: 'wf' });
  const result = await new WorkflowExecutor({ logger }).execute(workflow, request);
  expect(result.success).toBe(false);
  return result.error?.type;
}

describe('workflow failure kind', () => {
  it('reports non-determinism as NonDeterminism', async () => {
    expect(await failureType(WorkflowError.nonDeterministic('step 3 changed'))).toBe(
      'NonDeterminism'
    );
  });

  it('reports any other workflow error as it did before', async () => {
    expect(await failureType(WorkflowError.invalidState('boom'))).toBe('WorkflowError');
  });
});
