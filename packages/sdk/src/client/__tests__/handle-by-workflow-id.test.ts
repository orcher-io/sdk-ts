/**
 * A caller that knows only the workflow id must still get a handle.
 *
 * `client.getWorkflowHandle({ workflowId }).sendEvent(...)` is the documented
 * way to signal a running workflow, so it must work without a run id and without
 * first listing executions to find the run. These tests pin what the native
 * layer is given.
 */

import { Client } from '../client';

const mockGetWorkflowHandle = jest.fn(() => ({}));

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    clientConnect: jest.fn(async () => ({})),
    clientGetWorkflowHandle: mockGetWorkflowHandle,
  })),
  isNativeAvailable: jest.fn(() => true),
}));

async function connectedClient(): Promise<Client> {
  const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });
  await client.connect();
  return client;
}

describe('getWorkflowHandle', () => {
  beforeEach(() => mockGetWorkflowHandle.mockClear());

  it('addresses a workflow by id alone', async () => {
    const client = await connectedClient();

    const handle = client.getWorkflowHandle({ workflowId: 'order-fulfilment:abc' });

    expect(handle.workflowId).toBe('order-fulfilment:abc');
    expect(handle.runId).toBeUndefined();
    expect(mockGetWorkflowHandle).toHaveBeenCalledWith(
      expect.anything(),
      'order-fulfilment:abc',
      undefined
    );
  });

  it('passes a run id through when the caller has one', async () => {
    const client = await connectedClient();

    const handle = client.getWorkflowHandle({ workflowId: 'order-123', runId: 'run-9' });

    expect(handle.runId).toBe('run-9');
    expect(mockGetWorkflowHandle).toHaveBeenCalledWith(expect.anything(), 'order-123', 'run-9');
  });
});
