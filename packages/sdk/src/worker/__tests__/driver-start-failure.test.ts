/**
 * A worker whose pollers cannot connect must fail to start.
 *
 * The drivers are started in the constructor. If their failure were only
 * logged, `run()` would resolve and the worker would report itself running
 * while polling nothing, noticed only by whoever read the log.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';

const mockServiceStart = jest.fn(async () => undefined);

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: jest.fn(() => ({})),
    serviceStart: mockServiceStart,
    clientConnect: jest.fn(async () => ({})),
    clientClose: jest.fn(),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
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

describe('Worker.run() when the drivers cannot start', () => {
  afterEach(() => {
    mockServiceStart.mockReset();
    mockServiceStart.mockImplementation(async () => undefined);
  });

  it('rejects with the driver failure instead of reporting itself running', async () => {
    mockServiceStart.mockRejectedValue(
      new Error('Failed to create workflow driver: Connection error: transport error')
    );
    const w = worker();

    await expect(w.run()).rejects.toThrow(/transport error/);
    expect(w.isRunning()).toBe(false);
  });

  it('still starts when the drivers come up', async () => {
    const w = worker();
    await expect(w.run()).resolves.toBeUndefined();
    expect(w.isRunning()).toBe(true);
    await w.shutdown();
  });
});
