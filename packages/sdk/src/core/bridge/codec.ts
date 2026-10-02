/**
 * Compression and encryption codecs for Payloads.
 *
 * TypeScript wrappers around the Rust codec implementations in sdk-core. Each
 * codec transforms a Payload's data bytes and records the change in its
 * `encoding` metadata so decoding can undo it.
 *
 * @module @orcher/sdk/core/bridge/codec
 */

import type { Payload } from './payload';
import { METADATA_ENCODING } from './payload';

// Loaded at module load time; importing this module fails if the binding is missing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const native = require('../../orcher-core.node');

/**
 * Gzip compression codec for Payloads.
 *
 * Compresses Payload data in Gzip (RFC 1952) format.
 * Text and JSON data typically shrink by 60-90%.
 *
 * @example
 * ```typescript
 * const codec = new GzipCodec();
 * const compressed = codec.encode(payload);
 * const original = codec.decode(compressed);
 * ```
 */
export class GzipCodec {
  private readonly handle: unknown;

  /**
   * Create a GzipCodec with a compression level.
   * @param options - Optional configuration
   * @param options.level - Compression level 0-9 (default 6)
   */
  constructor(options?: { level?: number }) {
    this.handle = native.codecGzipCreate(options ?? {});
  }

  /**
   * Compress a Payload, returning a new Payload with compressed data.
   */
  encode(payload: Payload): Payload {
    const compressedData: Buffer = native.codecGzipEncode(this.handle, Buffer.from(payload.data));

    const textEncoder = new TextEncoder();
    const metadata = { ...payload.metadata };

    // A binary encoding keeps its name with a `+gzip` suffix, so decode() can restore it.
    // Any other encoding becomes `binary/gzip`.
    const currentEncoding = getEncodingString(payload);
    const newEncoding =
      currentEncoding && currentEncoding.startsWith('binary/')
        ? `${currentEncoding}+gzip`
        : 'binary/gzip';
    metadata[METADATA_ENCODING] = textEncoder.encode(newEncoding);

    return {
      data: new Uint8Array(compressedData),
      metadata,
    };
  }

  /**
   * Decompress a Payload, returning a new Payload with decompressed data.
   */
  decode(payload: Payload): Payload {
    const decompressedData: Buffer = native.codecGzipDecode(
      this.handle,
      Buffer.from(payload.data)
    );

    const textEncoder = new TextEncoder();
    const metadata = { ...payload.metadata };

    // Undo the encoding change made by encode().
    const currentEncoding = getEncodingString(payload);
    if (currentEncoding === 'binary/gzip') {
      delete metadata[METADATA_ENCODING];
    } else if (currentEncoding?.endsWith('+gzip')) {
      metadata[METADATA_ENCODING] = textEncoder.encode(
        currentEncoding.slice(0, -'+gzip'.length)
      );
    }

    return {
      data: new Uint8Array(decompressedData),
      metadata,
    };
  }
}

/**
 * AES-256-GCM encryption codec for Payloads.
 *
 * Provides confidentiality, authenticity, and integrity.
 * Each encryption uses a unique random nonce.
 *
 * @example
 * ```typescript
 * const key = EncryptionCodec.generateKey();
 * const codec = new EncryptionCodec(key);
 * const encrypted = codec.encode(payload);
 * const decrypted = codec.decode(encrypted);
 * ```
 */
export class EncryptionCodec {
  private readonly handle: unknown;

  /**
   * Create an EncryptionCodec with a 32-byte key.
   * @param key - 32-byte encryption key
   * @throws Error if key is not exactly 32 bytes
   */
  constructor(key: Buffer) {
    this.handle = native.codecEncryptionCreate(key);
  }

  /**
   * Generate a cryptographically secure random 32-byte key.
   */
  static generateKey(): Buffer {
    return native.codecEncryptionGenerateKey();
  }

  /**
   * Encrypt a Payload, returning a new Payload with encrypted data.
   *
   * A binary encoding gains a `+encrypted` suffix; any other becomes `binary/encrypted`.
   */
  encode(payload: Payload): Payload {
    const encryptedData: Buffer = native.codecEncryptionEncode(
      this.handle,
      Buffer.from(payload.data)
    );

    const textEncoder = new TextEncoder();
    const metadata = { ...payload.metadata };

    const currentEncoding = getEncodingString(payload);
    const newEncoding =
      currentEncoding && currentEncoding.startsWith('binary/')
        ? `${currentEncoding}+encrypted`
        : 'binary/encrypted';
    metadata[METADATA_ENCODING] = textEncoder.encode(newEncoding);

    return {
      data: new Uint8Array(encryptedData),
      metadata,
    };
  }

  /**
   * Decrypt a Payload, returning a new Payload with decrypted data.
   */
  decode(payload: Payload): Payload {
    const decryptedData: Buffer = native.codecEncryptionDecode(
      this.handle,
      Buffer.from(payload.data)
    );

    const textEncoder = new TextEncoder();
    const metadata = { ...payload.metadata };

    const currentEncoding = getEncodingString(payload);
    if (currentEncoding === 'binary/encrypted') {
      delete metadata[METADATA_ENCODING];
    } else if (currentEncoding?.endsWith('+encrypted')) {
      metadata[METADATA_ENCODING] = textEncoder.encode(
        currentEncoding.slice(0, -'+encrypted'.length)
      );
    }

    return {
      data: new Uint8Array(decryptedData),
      metadata,
    };
  }
}

/**
 * Composable chain of codecs applied in sequence.
 *
 * Codecs are applied in order during encoding and in reverse during decoding.
 *
 * @example
 * ```typescript
 * const key = EncryptionCodec.generateKey();
 * const chain = new CodecChain()
 *   .withEncryption(key)
 *   .withGzip();
 *
 * const encoded = chain.encode(payload);   // encrypt then compress
 * const decoded = chain.decode(encoded);   // decompress then decrypt
 * ```
 */
export class CodecChain {
  private readonly handle: unknown;
  private readonly codecCount: number;

  constructor(handle?: unknown, count?: number) {
    this.handle = handle ?? native.codecChainCreate();
    this.codecCount = count ?? 0;
  }

  /**
   * Add gzip compression to the chain, returning a new CodecChain.
   * @param options - Optional configuration
   * @param options.level - Compression level 0-9 (default 6)
   */
  withGzip(options?: { level?: number }): CodecChain {
    const newHandle = native.codecChainAddGzip(this.handle, options?.level);
    return new CodecChain(newHandle, this.codecCount + 1);
  }

  /**
   * Add AES-256-GCM encryption to the chain, returning a new CodecChain.
   * @param key - 32-byte encryption key
   */
  withEncryption(key: Buffer): CodecChain {
    const newHandle = native.codecChainAddEncryption(this.handle, key);
    return new CodecChain(newHandle, this.codecCount + 1);
  }

  /**
   * Encode a Payload through the full codec chain.
   */
  encode(payload: Payload): Payload {
    const encodedData: Buffer = native.codecChainEncode(this.handle, Buffer.from(payload.data));

    // The Rust side performs every transformation in the chain, so the metadata only
    // marks the result as opaque binary. An empty chain leaves the encoding unchanged.
    const textEncoder = new TextEncoder();
    const metadata = { ...payload.metadata };
    if (this.codecCount > 0) {
      metadata[METADATA_ENCODING] = textEncoder.encode('binary/codec-chain');
    }

    return {
      data: new Uint8Array(encodedData),
      metadata,
    };
  }

  /**
   * Decode a Payload through the full codec chain, in reverse order.
   *
   * The `encoding` metadata entry is removed from the result.
   */
  decode(payload: Payload): Payload {
    const decodedData: Buffer = native.codecChainDecode(this.handle, Buffer.from(payload.data));

    const metadata = { ...payload.metadata };
    delete metadata[METADATA_ENCODING];

    return {
      data: new Uint8Array(decodedData),
      metadata,
    };
  }

  /**
   * Get the number of codecs in the chain.
   */
  get length(): number {
    return native.codecChainLen(this.handle) as number;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the encoding string from a Payload's metadata.
 */
function getEncodingString(payload: Payload): string | undefined {
  const encodingBytes = payload.metadata[METADATA_ENCODING];
  if (!encodingBytes) return undefined;
  return new TextDecoder().decode(encodingBytes);
}
