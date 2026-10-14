/**
 * Shutting a worker down stops its worker host and closes the client
 * connection it opened on start.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';
import { getNativeModule } from '../../core/native';
import { fakeHostNative } from './support/fake-host';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('Worker.shutdown()', () => {
  it('stops the worker host and closes the client connection', async () => {
    const native = fakeHostNative();
    (getNativeModule as jest.Mock).mockReturnValue(native);
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      logger: silent,
    });
    await worker.run();
    expect(native.clientClose).not.toHaveBeenCalled();

    await worker.shutdown();

    expect(native.hostShutdown).toHaveBeenCalledTimes(1);
    expect(native.clientClose).toHaveBeenCalledTimes(1);
    expect(worker.isRunning()).toBe(false);
  });
});
