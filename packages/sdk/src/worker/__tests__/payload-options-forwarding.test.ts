/**
 * A worker must hand its `encryption` and `compression` options to both
 * connections it opens: the worker host, which carries workflows, tasks,
 * actors and their state, and the worker's own client. One left out would
 * send or read plain payloads beside a host that seals them.
 */
import { inspect } from 'util';

import { Worker } from '../worker';
import { WorkerError } from '../errors';
import type { Logger, WorkerOptions } from '../types';
import { getNativeModule } from '../../core/native';
import { fakeHostNative } from './support/fake-host';
import { showsKey } from '../../core/__tests__/support/shows-key';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(),
  isNativeAvailable: jest.fn(() => true),
}));

const logged: unknown[][] = [];
const record = (...args: unknown[]) => void logged.push(args);
const recording: Logger = { debug: record, info: record, warn: record, error: record };

const KEY = new Uint8Array(32).fill(0x5a);
const OLD_KEY = new Uint8Array(32).fill(0x3c);
const KEY_B64 = Buffer.from(KEY).toString('base64');
const OLD_KEY_B64 = Buffer.from(OLD_KEY).toString('base64');

function workerWith(options: Partial<WorkerOptions>): Worker {
  return new Worker({
    serverUrl: 'http://localhost:50051',
    namespace: 'default',
    taskQueue: 'q',
    logger: recording,
    workflows: [Object.defineProperty(async () => null, 'name', { value: 'wf' })],
    ...options,
  });
}

async function connectionsFor(options: Partial<WorkerOptions>) {
  const native = fakeHostNative();
  (getNativeModule as jest.Mock).mockReturnValue(native);
  const worker = workerWith(options);
  await worker.run();
  await worker.shutdown();
  expect(native.hostStart).toHaveBeenCalledTimes(1);
  expect(native.clientConnect).toHaveBeenCalledTimes(1);
  return {
    worker,
    host: JSON.parse(native.hostStart.mock.calls[0]![0]) as Record<string, unknown>,
    client: (native.clientConnect.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
  };
}

describe('Worker payload options', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it('sends neither when neither is set', async () => {
    const { host, client } = await connectionsFor({});
    expect(host['encryption']).toBeUndefined();
    expect(host['compression']).toBeUndefined();
    expect(client['encryption']).toBeUndefined();
    expect(client['compression']).toBeUndefined();
  });

  it('gives the worker host the keys as base64, and its client the same keys', async () => {
    const { host, client } = await connectionsFor({
      compression: 'gzip',
      encryption: { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
    });
    expect(host['compression']).toBe('gzip');
    expect(host['encryption']).toEqual({
      key: KEY_B64,
      keyId: 'k2',
      decryptionKeys: { k1: OLD_KEY_B64 },
    });
    expect(client['compression']).toBe('gzip');
    expect(client['encryption']).toEqual({
      key: KEY,
      keyId: 'k2',
      decryptionKeys: { k1: OLD_KEY },
    });
  });

  it('takes them from the builder too', async () => {
    const native = fakeHostNative();
    (getNativeModule as jest.Mock).mockReturnValue(native);
    const worker = await Worker.builder()
      .serverUrl('http://localhost:50051')
      .namespace('default')
      .taskQueue('q')
      .logger(recording)
      .workflows([Object.defineProperty(async () => null, 'name', { value: 'wf' })])
      .encryption({ key: KEY })
      .compression('gzip')
      .build();
    await worker.run();
    await worker.shutdown();
    const host = JSON.parse(native.hostStart.mock.calls[0]![0]) as Record<string, unknown>;
    expect(host['encryption']).toEqual({ key: KEY_B64 });
    expect(host['compression']).toBe('gzip');
  });

  it.each([0, 16, 31, 33])('refuses an encryption key of %d bytes when constructed', (length) => {
    const construct = () => workerWith({ encryption: { key: new Uint8Array(length) } });
    expect(construct).toThrow(WorkerError);
    expect(construct).toThrow(
      `encryption.key must be exactly 32 bytes (AES-256-GCM), got ${length}`
    );
  });

  it('refuses a compression it does not have when constructed', () => {
    const construct = () => workerWith({ compression: 'brotli' as 'gzip' });
    expect(construct).toThrow(WorkerError);
    expect(construct).toThrow("compression must be 'gzip'");
  });

  it('neither logs the keys nor prints them with the worker', async () => {
    const native = fakeHostNative();
    (getNativeModule as jest.Mock).mockReturnValue(native);
    const worker = workerWith({
      encryption: { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
    });
    const all = { depth: Infinity, showHidden: true };
    // Before it runs, while it runs (when it also holds its client) and after.
    let printed = inspect(worker, all);
    await worker.run();
    printed += inspect(worker, all);
    await worker.shutdown();
    printed += inspect(worker, all) + inspect(logged, all);
    expect(logged.length).toBeGreaterThan(0);
    for (const key of [KEY, OLD_KEY]) {
      expect(showsKey(printed, key)).toBe(false);
    }
    expect(printed).toContain('<redacted>');
  });
});
