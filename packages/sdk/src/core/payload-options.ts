/**
 * The `encryption` and `compression` options a client and a worker share.
 *
 * Both are applied by the native core to every payload as it leaves for the
 * engine and removed from every payload as it arrives, so the SDK and the
 * code written against it see plain values only. This module checks the
 * options when a client or worker is constructed and keeps the keys out of
 * anything that prints a configuration.
 *
 * @module @orcher/sdk/core/payload-options
 */

import { inspect } from 'util';

/** The length of an encryption key: AES-256-GCM takes exactly 32 bytes. */
export const ENCRYPTION_KEY_BYTES = 32;

/**
 * End-to-end encryption of payloads, with AES-256-GCM.
 *
 * A client and every worker that exchange payloads must be given the same
 * key. The engine never holds it.
 */
export interface EncryptionOptions {
  /**
   * The key payloads are encrypted with: exactly 32 bytes. Generate it with
   * `crypto.randomBytes(32)` and keep it in a secret store.
   */
  key: Uint8Array;

  /**
   * A name for `key`, stored unencrypted beside every payload it encrypts.
   * It is what lets a key be rotated later: a reader holding several keys
   * picks the one a payload names. It must not be derived from the key.
   */
  keyId?: string;

  /**
   * Keys used only for reading, by their `keyId`: payloads that name one of
   * these ids are decrypted with it, and nothing is encrypted with it. This
   * keeps payloads written before a rotation readable.
   */
  decryptionKeys?: Record<string, Uint8Array>;
}

/** Compression of payloads. `gzip` is the only kind. */
export type PayloadCompression = 'gzip';

/** `encryption` as the worker's JSON configuration carries it: keys as base64. */
export interface HostEncryptionConfig {
  key: string;
  keyId?: string;
  decryptionKeys?: Record<string, string>;
}

function isKey(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/** What is wrong with a key, or `null`. Never includes the key. */
function keyProblem(name: string, value: unknown): string | null {
  if (!isKey(value)) {
    return `${name} must be a Uint8Array of ${ENCRYPTION_KEY_BYTES} bytes`;
  }
  if (value.byteLength !== ENCRYPTION_KEY_BYTES) {
    return `${name} must be exactly ${ENCRYPTION_KEY_BYTES} bytes (AES-256-GCM), got ${value.byteLength}`;
  }
  return null;
}

/**
 * Checked encryption keys, held so that they are not printed.
 *
 * The keys live in private fields, which `console.log`, `util.inspect` and
 * `JSON.stringify` do not read; what those show instead is the key id and the
 * ids of the decryption keys. The bytes are copied in, so changing the
 * caller's array afterwards changes nothing here.
 */
export class PayloadEncryption {
  readonly keyId?: string;
  readonly #key: Uint8Array;
  readonly #decryptionKeys: Map<string, Uint8Array>;

  private constructor(key: Uint8Array, keyId: string | undefined, keys: Map<string, Uint8Array>) {
    this.#key = key;
    this.keyId = keyId;
    this.#decryptionKeys = keys;
  }

  /**
   * Check `options` and take a copy of its keys.
   *
   * @param options - The `encryption` option as the caller gave it
   * @param fail - Makes the error to throw; the message never holds a key
   */
  static from(
    options: EncryptionOptions | undefined | null,
    fail: (message: string) => Error
  ): PayloadEncryption | undefined {
    if (options === undefined || options === null) {
      return undefined;
    }
    if (typeof options !== 'object') {
      throw fail('encryption must be an object with a 32-byte `key`');
    }
    const problem = keyProblem('encryption.key', options.key);
    if (problem) {
      throw fail(problem);
    }
    if (options.keyId !== undefined && (typeof options.keyId !== 'string' || !options.keyId)) {
      throw fail('encryption.keyId must be a non-empty string');
    }
    const keys = new Map<string, Uint8Array>();
    const decryptionKeys: unknown = options.decryptionKeys;
    if (decryptionKeys !== undefined && decryptionKeys !== null) {
      if (
        typeof decryptionKeys !== 'object' ||
        Array.isArray(decryptionKeys) ||
        isKey(decryptionKeys)
      ) {
        throw fail('encryption.decryptionKeys must be an object of 32-byte keys by key id');
      }
      for (const [id, key] of Object.entries(decryptionKeys)) {
        if (!id) {
          throw fail('encryption.decryptionKeys must not have an empty key id');
        }
        const keyProblemHere = keyProblem(`encryption.decryptionKeys['${id}']`, key);
        if (keyProblemHere) {
          throw fail(keyProblemHere);
        }
        keys.set(id, Uint8Array.from(key as Uint8Array));
      }
    }
    return new PayloadEncryption(Uint8Array.from(options.key), options.keyId, keys);
  }

  /** The option as the native client reads it: keys as bytes. */
  toClientConfig(): EncryptionOptions {
    const options: EncryptionOptions = { key: Uint8Array.from(this.#key) };
    if (this.keyId !== undefined) {
      options.keyId = this.keyId;
    }
    if (this.#decryptionKeys.size > 0) {
      options.decryptionKeys = Object.fromEntries(
        [...this.#decryptionKeys].map(([id, key]) => [id, Uint8Array.from(key)])
      );
    }
    return options;
  }

  /** The option as the worker host reads it from JSON: keys as base64. */
  toHostConfig(): HostEncryptionConfig {
    const config: HostEncryptionConfig = { key: Buffer.from(this.#key).toString('base64') };
    if (this.keyId !== undefined) {
      config.keyId = this.keyId;
    }
    if (this.#decryptionKeys.size > 0) {
      config.decryptionKeys = Object.fromEntries(
        [...this.#decryptionKeys].map(([id, key]) => [id, Buffer.from(key).toString('base64')])
      );
    }
    return config;
  }

  /** What may be shown of this: the ids, never a key. */
  private describe(): { key: string; keyId?: string; decryptionKeys: string[] } {
    return {
      key: '<redacted>',
      ...(this.keyId !== undefined ? { keyId: this.keyId } : {}),
      decryptionKeys: [...this.#decryptionKeys.keys()],
    };
  }

  /** `JSON.stringify` of anything holding this shows no key. */
  toJSON(): unknown {
    return this.describe();
  }

  /** `console.log` and `util.inspect` of anything holding this show no key. */
  [inspect.custom](): string {
    return `PayloadEncryption ${inspect(this.describe())}`;
  }
}

/**
 * Check the `compression` option.
 *
 * @param fail - Makes the error to throw
 */
export function checkedCompression(
  compression: PayloadCompression | undefined | null,
  fail: (message: string) => Error
): PayloadCompression | undefined {
  if (compression === undefined || compression === null) {
    return undefined;
  }
  if (compression !== 'gzip') {
    throw fail(`compression must be 'gzip', got ${JSON.stringify(compression)}`);
  }
  return compression;
}
