/**
 * A caller that knows only the workflow id must still get a handle.
 *
 * `client.getWorkflowHandle({ workflowId }).sendEvent(...)` is the documented
 * way to signal a running workflow, so it must work without a run id and without
 * first listing executions to find the run. These tests pin what the native
 * layer is given.
 */

import { Client } from '../client';

import { answer, sentCall, WorkflowStatus } from './support/client-call';

const mockCall = jest.fn(async (_client: unknown, _call: Uint8Array) =>
  answer({ oneofKind: 'status', status: WorkflowStatus.RUNNING })
);

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    clientConnect: jest.fn(async () => ({})),
    clientCall: mockCall,
  })),
  isNativeAvailable: jest.fn(() => true),
}));

/** The workflow and run the one status call named. */
function sentWorkflow(): { workflowId: string; runId: string } | undefined {
  const [, bytes] = mockCall.mock.calls[0]!;
  const call = sentCall(bytes).call;
  return call.oneofKind === 'getStatus' ? call.getStatus.workflow : undefined;
}

async function connectedClient(): Promise<Client> {
  const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });
  await client.connect();
  return client;
}

describe('getWorkflowHandle', () => {
  beforeEach(() => mockCall.mockClear());

  it('addresses a workflow by id alone', async () => {
    const client = await connectedClient();

    const handle = client.getWorkflowHandle({ workflowId: 'order-fulfilment:abc' });

    expect(handle.workflowId).toBe('order-fulfilment:abc');
    expect(handle.runId).toBeUndefined();
    // An empty run id is the protocol's "latest run".
    await handle.status();
    expect(sentWorkflow()).toEqual({ workflowId: 'order-fulfilment:abc', runId: '' });
  });

  it('passes a run id through when the caller has one', async () => {
    const client = await connectedClient();

    const handle = client.getWorkflowHandle({ workflowId: 'order-123', runId: 'run-9' });

    expect(handle.runId).toBe('run-9');
    await handle.status();
    expect(sentWorkflow()).toEqual({ workflowId: 'order-123', runId: 'run-9' });
  });
});
