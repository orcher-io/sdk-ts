/**
 * A worker whose host cannot start must fail to start.
 *
 * If the failure were only logged, `run()` would resolve and the worker would
 * report itself running while polling nothing, noticed only by whoever read
 * the log.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';
import { getNativeModule } from '../../core/native';
import { fakeHostNative } from './support/fake-host';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function worker(): Worker {
  return new Worker({
    serverUrl: 'https://grpc.example.test:443',
    namespace: 'default',
    taskQueue: 'q',
    logger: silent,
  });
}

describe('Worker.run() when the worker host cannot start', () => {
  it('rejects with the host failure instead of reporting itself running', async () => {
    const native = fakeHostNative();
    native.hostStart.mockRejectedValue(
      new Error('[CONNECTION_FAILED] the worker could not start: transport error')
    );
    (getNativeModule as jest.Mock).mockReturnValue(native);
    const w = worker();

    await expect(w.run()).rejects.toThrow(/transport error/);
    expect(w.isRunning()).toBe(false);
    // The client it connected is closed again.
    expect(native.clientClose).toHaveBeenCalledTimes(1);
  });

  it('still starts when the host comes up', async () => {
    (getNativeModule as jest.Mock).mockReturnValue(fakeHostNative());
    const w = worker();
    await expect(w.run()).resolves.toBeUndefined();
    expect(w.isRunning()).toBe(true);
    await w.shutdown();
  });
});
