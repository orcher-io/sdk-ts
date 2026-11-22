/**
 * The `encryption` and `compression` options are checked when a client or a
 * worker is constructed, and the keys they hold are never printed.
 */
import { inspect } from 'util';

import { PayloadEncryption, checkedCompression } from '../payload-options';
import { showsKey } from './support/shows-key';

const fail = (message: string) => new Error(message);

/** A key whose bytes are easy to spot in any rendering: 0x5a, 90, `Wlpa…`. */
const KEY = new Uint8Array(32).fill(0x5a);
const OLD_KEY = new Uint8Array(32).fill(0x3c);

describe('encryption option', () => {
  it('is absent when not given', () => {
    expect(PayloadEncryption.from(undefined, fail)).toBeUndefined();
    expect(PayloadEncryption.from(null, fail)).toBeUndefined();
  });

  it('takes a 32-byte key, as a Uint8Array or a Buffer', () => {
    expect(PayloadEncryption.from({ key: KEY }, fail)?.toClientConfig()).toEqual({ key: KEY });
    const fromBuffer = PayloadEncryption.from({ key: Buffer.alloc(32, 7) }, fail);
    expect(fromBuffer?.toHostConfig()).toEqual({ key: Buffer.alloc(32, 7).toString('base64') });
  });

  it.each([0, 16, 31, 33, 64])('refuses a key of %d bytes, saying how long it was', (length) => {
    expect(() => PayloadEncryption.from({ key: new Uint8Array(length) }, fail)).toThrow(
      `encryption.key must be exactly 32 bytes (AES-256-GCM), got ${length}`
    );
  });

  it.each([
    ['a string', 'a'.repeat(32)],
    ['an array of numbers', new Array(32).fill(1)],
    ['a wider typed array', new Uint16Array(32)],
    ['nothing', undefined],
  ])('refuses a key that is %s', (_what, key) => {
    expect(() => PayloadEncryption.from({ key: key as unknown as Uint8Array }, fail)).toThrow(
      'encryption.key must be a Uint8Array of 32 bytes'
    );
  });

  it('refuses an empty key id', () => {
    expect(() => PayloadEncryption.from({ key: KEY, keyId: '' }, fail)).toThrow(
      'encryption.keyId must be a non-empty string'
    );
  });

  it('refuses a decryption key of the wrong length, naming it by its id', () => {
    expect(() =>
      PayloadEncryption.from({ key: KEY, decryptionKeys: { k1: new Uint8Array(16) } }, fail)
    ).toThrow("encryption.decryptionKeys['k1'] must be exactly 32 bytes (AES-256-GCM), got 16");
  });

  it('refuses decryption keys that are not an object of keys by id', () => {
    expect(() =>
      PayloadEncryption.from(
        { key: KEY, decryptionKeys: [OLD_KEY] as unknown as Record<string, Uint8Array> },
        fail
      )
    ).toThrow('encryption.decryptionKeys must be an object of 32-byte keys by key id');
  });

  it('throws the error its caller makes', () => {
    class Mine extends Error {}
    expect(() =>
      PayloadEncryption.from({ key: new Uint8Array(1) }, (message) => new Mine(message))
    ).toThrow(Mine);
  });

  it('gives the native client the keys as bytes', () => {
    const encryption = PayloadEncryption.from(
      { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
      fail
    );
    expect(encryption?.toClientConfig()).toEqual({
      key: KEY,
      keyId: 'k2',
      decryptionKeys: { k1: OLD_KEY },
    });
  });

  it('gives the worker host the keys as base64', () => {
    const encryption = PayloadEncryption.from(
      { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
      fail
    );
    expect(encryption?.toHostConfig()).toEqual({
      key: Buffer.from(KEY).toString('base64'),
      keyId: 'k2',
      decryptionKeys: { k1: Buffer.from(OLD_KEY).toString('base64') },
    });
  });

  it('keeps its own copy of the keys', () => {
    const key = Uint8Array.from(KEY);
    const encryption = PayloadEncryption.from({ key }, fail);
    key.fill(0);
    expect(encryption?.toClientConfig().key).toEqual(KEY);
  });

  it('never prints a key', () => {
    const encryption = PayloadEncryption.from(
      { key: KEY, keyId: 'k2', decryptionKeys: { k1: OLD_KEY } },
      fail
    )!;
    const holder = { serverUrl: 'http://localhost:50051', encryption };
    const renderings = [
      inspect(encryption, { depth: Infinity, showHidden: true }),
      inspect(holder, { depth: Infinity, showHidden: true }),
      JSON.stringify(holder),
      String(encryption),
      `${JSON.stringify(Object.entries(encryption))}`,
    ];
    for (const text of renderings) {
      expect(showsKey(text, KEY)).toBe(false);
      expect(showsKey(text, OLD_KEY)).toBe(false);
    }
    // What it does show is which keys it holds.
    expect(inspect(encryption)).toContain("keyId: 'k2'");
    expect(inspect(encryption)).toContain("'k1'");
    expect(JSON.parse(JSON.stringify(encryption))).toEqual({
      key: '<redacted>',
      keyId: 'k2',
      decryptionKeys: ['k1'],
    });
  });

  it('can tell when a key is shown, so the check above can fail', () => {
    const all = { depth: Infinity, showHidden: true };
    expect(showsKey(inspect({ key: KEY }), KEY)).toBe(true);
    expect(showsKey(inspect({ key: KEY }, all), KEY)).toBe(true);
    expect(showsKey(inspect({ key: Buffer.from(KEY) }), KEY)).toBe(true);
    expect(showsKey(inspect({ key: Buffer.from(KEY) }, all), KEY)).toBe(true);
    expect(showsKey(JSON.stringify({ key: Buffer.from(KEY).toString('base64') }), KEY)).toBe(true);
    expect(showsKey(JSON.stringify({ key: Buffer.from(KEY) }), KEY)).toBe(true);
    expect(showsKey(JSON.stringify({ key: Array.from(KEY) }, null, 2), KEY)).toBe(true);
    expect(showsKey(inspect({ serverUrl: 'http://localhost:50051' }), KEY)).toBe(false);
  });
});

describe('compression option', () => {
  it('is absent when not given', () => {
    expect(checkedCompression(undefined, fail)).toBeUndefined();
  });

  it('takes gzip', () => {
    expect(checkedCompression('gzip', fail)).toBe('gzip');
  });

  it('refuses anything else', () => {
    expect(() => checkedCompression('zstd' as 'gzip', fail)).toThrow(
      `compression must be 'gzip', got "zstd"`
    );
  });
});
