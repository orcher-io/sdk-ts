/**
 * `handle.cancel({ cleanupTimeout })` hands the cleanup limit to the native
 * binding in milliseconds, and a plain `cancel()` sends none, so the engine
 * sets no limit.
 */

import { Client } from '../client';
import { ClientError } from '../../core/errors';
import { Duration } from '../../workflow/types';

import { done, sentCall } from './support/client-call';

const mockCall = jest.fn(async (_client: unknown, _call: Uint8Array) => done());

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    clientConnect: jest.fn(async () => ({})),
    clientCall: mockCall,
  })),
  isNativeAvailable: jest.fn(() => true),
}));

/** The cleanup limit the one cancel sent, in milliseconds; undefined for none. */
function sentCleanupMs(): number | undefined {
  const [, bytes] = mockCall.mock.calls[0]!;
  const call = sentCall(bytes).call;
  if (call.oneofKind !== 'cancel') {
    throw new Error(`expected a cancel, got ${call.oneofKind}`);
  }
  const limit = call.cancel.cleanupTimeout;
  return limit ? Number(limit.seconds) * 1000 + limit.nanos / 1_000_000 : undefined;
}

async function handle() {
  const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });
  await client.connect();
  return client.getWorkflowHandle({ workflowId: 'order-123' });
}

describe('WorkflowHandle.cancel', () => {
  beforeEach(() => mockCall.mockClear());

  it('sets no cleanup limit by default', async () => {
    await (await handle()).cancel();

    expect(sentCleanupMs()).toBeUndefined();
  });

  it('passes a Duration cleanup limit in milliseconds', async () => {
    await (await handle()).cancel({ cleanupTimeout: Duration.fromSeconds(90) });

    expect(sentCleanupMs()).toBe(90_000);
  });

  it('passes a bare number as milliseconds', async () => {
    await (await handle()).cancel({ cleanupTimeout: 1500 });

    expect(sentCleanupMs()).toBe(1500);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a cleanup limit of %p without calling the engine',
    async (cleanupTimeout) => {
      await expect((await handle()).cancel({ cleanupTimeout })).rejects.toThrow(ClientError);
      expect(mockCall).not.toHaveBeenCalled();
    }
  );
});
