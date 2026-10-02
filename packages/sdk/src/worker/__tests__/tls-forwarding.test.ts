/**
 * The worker must hand its TLS setting to the native driver.
 *
 * Without it, a worker pointed at an https:// endpoint would dial it in
 * plaintext, log itself connected, and never complete a poll. These tests pin
 * what the driver is given.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';

const mockServiceCreate = jest.fn(() => ({}));

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({
    serviceCreate: mockServiceCreate,
    serviceStart: jest.fn(async () => undefined),
    pollWorkflowTask: jest.fn(() => new Promise(() => {})),
    pollTask: jest.fn(() => new Promise(() => {})),
  })),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function driverConfigFor(serverUrl: string, tls?: Record<string, string>) {
  mockServiceCreate.mockClear();
  new Worker({ serverUrl, namespace: 'default', taskQueue: 'q', logger: silent, tls });
  expect(mockServiceCreate).toHaveBeenCalledTimes(1);
  return (mockServiceCreate.mock.calls[0] as unknown[])[0] as { tls?: unknown };
}

describe('Worker TLS forwarding', () => {
  it('turns TLS on for an https server, with the system trust store', () => {
    expect(driverConfigFor('https://grpc.example.test:443').tls).toEqual({});
  });

  it('keeps a plain http server in plaintext', () => {
    expect(driverConfigFor('http://localhost:50051').tls).toBeUndefined();
  });

  it('passes an explicit setting through untouched', () => {
    const custom = { caPath: '/etc/orcher/ca.pem' };
    expect(driverConfigFor('https://grpc.example.test', custom).tls).toBe(custom);
  });
});
