/**
 * Shutting a worker down closes the client connection it opened on start.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';

const mockClientClose = jest.fn();

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: jest.fn(async () => undefined),
    clientConnect: jest.fn(async () => ({})),
    clientClose: mockClientClose,
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('Worker.shutdown()', () => {
  it('closes the client connection', async () => {
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      logger: silent,
    });
    await worker.run();
    expect(mockClientClose).not.toHaveBeenCalled();

    await worker.shutdown();

    expect(mockClientClose).toHaveBeenCalledTimes(1);
  });
});
