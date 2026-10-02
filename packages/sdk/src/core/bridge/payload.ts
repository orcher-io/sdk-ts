/**
 * Conversion between TypeScript values and Orcher Payloads.
 *
 * Payloads carry data between the TypeScript SDK and the Rust core.
 *
 * ## Payload format
 *
 * A Payload consists of:
 * - `data`: Serialized bytes (typically JSON)
 * - `metadata`: Key-value pairs describing encoding/compression
 *
 * ## Encoding
 *
 * Values are JSON-encoded by default, with metadata:
 * ```
 * {
 *   "encoding": "json/plain",
 *   "content-type": "application/json"
 * }
 * ```
 *
 * `null`/`undefined` and binary data (`Uint8Array`, `Buffer`) use the encodings in
 * {@link PayloadEncoding}. Protobuf and custom encodings are not supported.
 *
 * @module @orcher/sdk/core/bridge/payload
 */

/**
 * Payload representation matching the Rust `Payload` struct.
 *
 * ```rust
 * pub struct Payload {
 *     pub data: Vec<u8>,
 *     pub metadata: HashMap<String, Vec<u8>>,
 * }
 * ```
 */
export interface Payload {
  /** Serialized data bytes (Base64 encoded when transferred) */
  data: Uint8Array;

  /** Metadata about encoding/compression */
  metadata: Record<string, Uint8Array>;
}

/**
 * Workflow execution identifiers, matching the Rust `WorkflowExecution` struct.
 */
export interface WorkflowExecution {
  /** Workflow ID */
  workflowId: string;

  /** Run ID (unique for each execution attempt) */
  runId: string;
}

/** Metadata key naming a payload's encoding. */
export const METADATA_ENCODING = 'encoding';
/** Metadata key naming a payload's MIME content type. */
export const METADATA_CONTENT_TYPE = 'content-type';

/**
 * Standard encoding types
 */
export enum PayloadEncoding {
  /** Plain JSON encoding */
  JSON = 'json/plain',

  /** Binary/raw data */
  Binary = 'binary/raw',

  /** Null/undefined value */
  Null = 'binary/null',
}

/**
 * Converts between TypeScript values and Orcher Payloads.
 */
export class PayloadConverter {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  /**
   * Convert a TypeScript value to a Payload.
   *
   * `null` and `undefined` become a null payload, `Uint8Array` and `Buffer` a binary
   * payload, and everything else JSON.
   *
   * @param value - TypeScript value to convert
   * @returns Payload with serialized data and metadata
   */
  toPayload(value: unknown): Payload {
    if (value === null || value === undefined) {
      return this.createNullPayload();
    }

    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      return this.createBinaryPayload(value);
    }

    return this.createJsonPayload(value);
  }

  /**
   * Convert a Payload to a TypeScript value.
   *
   * A payload with a missing or unrecognized encoding is decoded as JSON.
   *
   * @param payload - Payload to convert
   * @returns TypeScript value
   */
  fromPayload(payload: Payload): unknown {
    const encoding = this.getEncoding(payload);

    switch (encoding) {
      case PayloadEncoding.Null:
        return null;

      case PayloadEncoding.Binary:
        return payload.data;

      case PayloadEncoding.JSON:
      default:
        return this.fromJsonPayload(payload);
    }
  }

  /**
   * Convert multiple TypeScript values to Payloads
   *
   * @param values - Array of TypeScript values
   * @returns Array of Payloads
   */
  toPayloads(values: unknown[]): Payload[] {
    return values.map((value) => this.toPayload(value));
  }

  /**
   * Convert multiple Payloads to TypeScript values
   *
   * @param payloads - Array of Payloads
   * @returns Array of TypeScript values
   */
  fromPayloads(payloads: Payload[]): unknown[] {
    return payloads.map((payload) => this.fromPayload(payload));
  }

  /**
   * Create a JSON-encoded Payload
   */
  private createJsonPayload(value: unknown): Payload {
    const json = JSON.stringify(value);
    const data = this.textEncoder.encode(json);

    return {
      data,
      metadata: {
        [METADATA_ENCODING]: this.textEncoder.encode(PayloadEncoding.JSON),
        [METADATA_CONTENT_TYPE]: this.textEncoder.encode('application/json'),
      },
    };
  }

  /**
   * Create a binary Payload
   */
  private createBinaryPayload(data: Uint8Array | Buffer): Payload {
    return {
      data: data instanceof Buffer ? new Uint8Array(data) : data,
      metadata: {
        [METADATA_ENCODING]: this.textEncoder.encode(PayloadEncoding.Binary),
        [METADATA_CONTENT_TYPE]: this.textEncoder.encode('application/octet-stream'),
      },
    };
  }

  /**
   * Create a null Payload
   */
  private createNullPayload(): Payload {
    return {
      data: new Uint8Array(0),
      metadata: {
        [METADATA_ENCODING]: this.textEncoder.encode(PayloadEncoding.Null),
      },
    };
  }

  /**
   * Decode a JSON Payload to TypeScript value
   */
  private fromJsonPayload(payload: Payload): unknown {
    const json = this.textDecoder.decode(payload.data);
    return JSON.parse(json);
  }

  /**
   * Get the encoding from Payload metadata
   */
  private getEncoding(payload: Payload): PayloadEncoding {
    const encodingBytes = payload.metadata[METADATA_ENCODING];
    if (!encodingBytes) {
      return PayloadEncoding.JSON; // Default
    }

    const encoding = this.textDecoder.decode(encodingBytes);
    return encoding as PayloadEncoding;
  }
}

/**
 * Default global payload converter instance
 */
export const defaultPayloadConverter = new PayloadConverter();

/**
 * Helper function to convert TypeScript value to Payload
 *
 * @param value - TypeScript value
 * @returns Payload
 */
export function toPayload(value: unknown): Payload {
  return defaultPayloadConverter.toPayload(value);
}

/**
 * Helper function to convert Payload to TypeScript value
 *
 * @param payload - Payload
 * @returns TypeScript value
 */
export function fromPayload(payload: Payload): unknown {
  return defaultPayloadConverter.fromPayload(payload);
}

/**
 * Helper function to convert multiple TypeScript values to Payloads
 *
 * @param values - Array of TypeScript values
 * @returns Array of Payloads
 */
export function toPayloads(values: unknown[]): Payload[] {
  return defaultPayloadConverter.toPayloads(values);
}

/**
 * Helper function to convert multiple Payloads to TypeScript values
 *
 * @param payloads - Array of Payloads
 * @returns Array of TypeScript values
 */
export function fromPayloads(payloads: Payload[]): unknown[] {
  return defaultPayloadConverter.fromPayloads(payloads);
}

/**
 * Serialize Payload for transfer to Rust (Base64 encoding)
 *
 * This is used when sending Payloads from TypeScript to Rust via Neon.
 * The data and metadata byte arrays are Base64 encoded for JSON transfer.
 *
 * @param payload - Payload to serialize
 * @returns Serialized payload object
 */
export function serializePayload(payload: Payload): SerializedPayload {
  return {
    data: Buffer.from(payload.data).toString('base64'),
    metadata: Object.fromEntries(
      Object.entries(payload.metadata).map(([key, value]) => [
        key,
        Buffer.from(value).toString('base64'),
      ])
    ),
  };
}

/**
 * Deserialize Payload received from Rust (Base64 decoding)
 *
 * This is used when receiving Payloads from Rust via Neon.
 * The Base64 encoded data and metadata are decoded back to byte arrays.
 *
 * @param serialized - Serialized payload object
 * @returns Payload with byte arrays
 */
export function deserializePayload(serialized: SerializedPayload): Payload {
  return {
    data: new Uint8Array(Buffer.from(serialized.data, 'base64')),
    metadata: Object.fromEntries(
      Object.entries(serialized.metadata).map(([key, value]) => [
        key,
        new Uint8Array(Buffer.from(value, 'base64')),
      ])
    ),
  };
}

/**
 * Serialized payload format for JSON transfer
 *
 * Used when transferring Payloads between TypeScript and Rust.
 * Byte arrays are Base64 encoded strings.
 */
export interface SerializedPayload {
  /** Base64 encoded data */
  data: string;

  /** Base64 encoded metadata values */
  metadata: Record<string, string>;
}

/**
 * Serialize multiple Payloads
 */
export function serializePayloads(payloads: Payload[]): SerializedPayload[] {
  return payloads.map(serializePayload);
}

/**
 * Deserialize multiple Payloads
 */
export function deserializePayloads(serialized: SerializedPayload[]): Payload[] {
  return serialized.map(deserializePayload);
}
