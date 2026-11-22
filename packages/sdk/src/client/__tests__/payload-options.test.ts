/**
 * A client's `encryption` and `compression` options: refused at construction
 * when they cannot work, handed to the native connection when they can, and
 * never printed with the client.
 */
import { inspect } from 'util';

import { Client } from '../client';
import { ClientError } from '../../core/errors';
import { getNativeModule } from '../../core/native';
import { showsKey } from '../../core/__tests__/support/shows-key';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(),
  isNativeAvailable: jest.fn(() => true),
}));

const KEY = new Uint8Array(32).fill(0x5a);
const OLD_KEY = new Uint8Array(32).fill(0x3c);
const base = { serverUrl: 'http://localhost:50051', namespace: 'default' };

function connectingNative() {
  const native = {
    clientConnect: jest.fn(async (_config: unknown) => ({})),
    clientClose: jest.fn(),
  };
  (getNativeModule as jest.Mock).mockReturnValue(native);
  return native;
}

describe('Client payload options', () => {
  it.each([0, 16, 31, 33])('refuses an encryption key of %d bytes when constructed', (length) => {
    const construct = () => new Client({ ...base, encryption: { key: new Uint8Array(length) } });
    expect(construct).toThrow(ClientError);
    expect(construct).toThrow(
      `encryption.key must be exactly 32 bytes (AES-256-GCM), got ${length}`
    );
  });

  it('refuses a decryption key of the wrong length when constructed', () => {
    expect(
      () =>
        new Client({
          ...base,
          encryption: { key: KEY, decryptionKeys: { old: new Uint8Array(8) } },
        })
    ).toThrow("encryption.decryptionKeys['old'] must be exactly 32 bytes");
  });

  it('refuses a compression it does not have when constructed', () => {
    const construct = () => new Client({ ...base, compression: 'brotli' as 'gzip' });
    expect(construct).toThrow(ClientError);
    expect(construct).toThrow("compression must be 'gzip'");
  });

  it('connects without either when neither is set', async () => {
    const native = connectingNative();
    await new Client(base).connect();
    const config = native.clientConnect.mock.calls[0]![0] as Record<string, unknown>;
    expect(config['encryption']).toBeUndefined();
    expect(config['compression']).toBeUndefined();
  });

  it('hands the native connection the keys and the compression', async () => {
    const native = connectingNative();
    const client = new Client({
      ...base,
      compression: 'gzip',
      encryption: { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
    });
    await client.connect();
    expect(native.clientConnect).toHaveBeenCalledTimes(1);
    expect(native.clientConnect.mock.calls[0]![0]).toMatchObject({
      serverUrl: base.serverUrl,
      namespace: 'default',
      compression: 'gzip',
      encryption: { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
    });
  });

  it('does not print the key with the client', () => {
    const client = new Client({
      ...base,
      encryption: { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
    });
    const printed = inspect(client, { depth: Infinity, showHidden: true }) + JSON.stringify(client);
    for (const key of [KEY, OLD_KEY]) {
      expect(showsKey(printed, key)).toBe(false);
    }
    // The rest of the configuration is still there to read.
    expect(printed).toContain('localhost:50051');
    expect(printed).toContain('k2');
    expect(printed).toContain('<redacted>');
  });
});
