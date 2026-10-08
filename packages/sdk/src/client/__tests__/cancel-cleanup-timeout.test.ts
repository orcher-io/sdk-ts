/**
 * `handle.cancel({ cleanupTimeout })` hands the cleanup limit to the native
 * binding in milliseconds, and a plain `cancel()` sends none, so the engine
 * sets no limit.
 */

import { Client } from '../client';
import { ClientError } from '../../core/errors';
import { Duration } from '../../workflow/types';

const mockCancel = jest.fn(async () => undefined);

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    clientConnect: jest.fn(async () => ({})),
    clientGetWorkflowHandle: jest.fn(() => ({})),
    workflowHandleCancel: mockCancel,
  })),
  isNativeAvailable: jest.fn(() => true),
}));

async function handle() {
  const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });
  await client.connect();
  return client.getWorkflowHandle({ workflowId: 'order-123' });
}

describe('WorkflowHandle.cancel', () => {
  beforeEach(() => mockCancel.mockClear());

  it('sets no cleanup limit by default', async () => {
    await (await handle()).cancel();

    expect(mockCancel).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('passes a Duration cleanup limit in milliseconds', async () => {
    await (await handle()).cancel({ cleanupTimeout: Duration.fromSeconds(90) });

    expect(mockCancel).toHaveBeenCalledWith(expect.anything(), { cleanupTimeout: 90_000 });
  });

  it('passes a bare number as milliseconds', async () => {
    await (await handle()).cancel({ cleanupTimeout: 1500 });

    expect(mockCancel).toHaveBeenCalledWith(expect.anything(), { cleanupTimeout: 1500 });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a cleanup limit of %p without calling the engine',
    async (cleanupTimeout) => {
      await expect((await handle()).cancel({ cleanupTimeout })).rejects.toThrow(ClientError);
      expect(mockCancel).not.toHaveBeenCalled();
    }
  );
});
