/**
 * The worker must hand its TLS setting to the worker host.
 *
 * Without it, a worker pointed at an https:// endpoint would dial it in
 * plaintext, log itself connected, and never complete a poll. These tests pin
 * what the host is given.
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

async function hostConfigFor(serverUrl: string, tls?: Record<string, string>) {
  const native = fakeHostNative();
  (getNativeModule as jest.Mock).mockReturnValue(native);
  const worker = new Worker({
    serverUrl,
    namespace: 'default',
    taskQueue: 'q',
    logger: silent,
    tls,
    workflows: [Object.defineProperty(async () => null, 'name', { value: 'wf' })],
  });
  await worker.run();
  await worker.shutdown();
  expect(native.hostStart).toHaveBeenCalledTimes(1);
  return JSON.parse(native.hostStart.mock.calls[0]![0]) as { tls?: unknown };
}

describe('Worker TLS forwarding', () => {
  it('turns TLS on for an https server, with the system trust store', async () => {
    expect((await hostConfigFor('https://grpc.example.test:443')).tls).toEqual({});
  });

  it('keeps a plain http server in plaintext', async () => {
    expect((await hostConfigFor('http://localhost:50051')).tls).toBeUndefined();
  });

  it('passes an explicit setting through untouched', async () => {
    const custom = { caPath: '/etc/orcher/ca.pem' };
    expect((await hostConfigFor('https://grpc.example.test', custom)).tls).toEqual(custom);
  });
});
