/**
 * Payload helpers built on the @protobuf-ts generated `Payload` type.
 *
 * Thin wrappers for creating, reading and inspecting JSON-encoded payloads.
 *
 * @packageDocumentation
 */

import { Payload } from '../generated/types';

/** Thrown when a value cannot be encoded into, or decoded from, a payload. */
export class PayloadError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PayloadError';
    Object.setPrototypeOf(this, PayloadError.prototype);
  }
}

/**
 * Create a JSON-encoded Payload from any JSON-serializable value.
 *
 * Sets the `encoding` and `content-type` metadata to `json` and `application/json`.
 * The payload can be serialized to binary protobuf with `Payload.toBinary()`.
 *
 * @param value - Any JSON-serializable value
 * @returns Payload protobuf message
 * @throws {PayloadError} If encoding fails
 *
 * @example
 * ```typescript
 * const payload = toPayload({ orderId: '123', amount: 100 });
 *
 * // Serialize to binary for network transport
 * const bytes = Payload.toBinary(payload);
 * ```
 */
export function toPayload(value: unknown): Payload {
  try {
    const json = JSON.stringify(value);
    const encodedData = new TextEncoder().encode(json);

    // The payload crosses the FFI boundary as JSON. A Uint8Array serializes as
    // {"0": 123, "1": 34, ...} while a plain Array serializes as [123, 34, ...], so the
    // bytes are stored as an Array typed as Uint8Array.
    const data = Array.from(encodedData) as unknown as Uint8Array;

    // Metadata values are stored as Arrays for the same reason.
    const metadata: Record<string, Uint8Array> = {
      encoding: Array.from(new TextEncoder().encode('json')) as unknown as Uint8Array,
      'content-type': Array.from(new TextEncoder().encode('application/json')) as unknown as Uint8Array,
    };

    return {
      data,
      metadata,
    };
  } catch (error) {
    throw new PayloadError(
      `Failed to encode payload: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Decode the value from a JSON-encoded Payload.
 *
 * The payload must hold JSON data, such as one created by `toPayload()`.
 *
 * @param payload - Payload protobuf message
 * @returns Decoded value
 * @throws {PayloadError} If decoding fails
 *
 * @example
 * ```typescript
 * const data = fromPayload<OrderData>(payload);
 * console.log(data.orderId, data.amount);
 * ```
 */
export function fromPayload<T = unknown>(payload: Payload): T {
  try {
    if (!payload.data || payload.data.length === 0) {
      throw new Error('Payload data is empty');
    }

    const json = new TextDecoder().decode(payload.data);
    return JSON.parse(json) as T;
  } catch (error) {
    throw new PayloadError(
      `Failed to decode payload: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Read a metadata value from a payload as a string.
 *
 * @param payload - The payload to extract metadata from
 * @param key - The metadata key
 * @returns The metadata value as a string, or null if not found
 *
 * @example
 * ```typescript
 * const encoding = getPayloadMetadata(payload, 'encoding');
 * console.log(encoding); // 'json'
 * ```
 */
export function getPayloadMetadata(payload: Payload, key: string): string | null {
  if (!payload.metadata || !payload.metadata[key]) {
    return null;
  }

  try {
    return new TextDecoder().decode(payload.metadata[key]);
  } catch {
    return null;
  }
}

/**
 * Create a JSON-encoded Payload with extra metadata entries.
 *
 * Custom keys are added after the default `encoding` and `content-type` entries and
 * overwrite them if they share a name.
 *
 * @param value - Any JSON-serializable value
 * @param metadata - Custom metadata key-value pairs
 * @returns Payload protobuf message
 *
 * @example
 * ```typescript
 * const payload = toPayloadWithMetadata(
 *   { orderId: '123' },
 *   { requestId: 'req-456', userId: 'user-789' }
 * );
 * ```
 */
export function toPayloadWithMetadata(value: unknown, metadata: Record<string, string>): Payload {
  const payload = toPayload(value);
  const encoder = new TextEncoder();

  for (const [key, val] of Object.entries(metadata)) {
    payload.metadata[key] = encoder.encode(val);
  }

  return payload;
}

/**
 * Whether a payload has non-empty data that parses as JSON.
 *
 * @param payload - The payload to check
 * @returns True if the payload appears valid
 */
export function isValidPayload(payload: Payload): boolean {
  try {
    if (!payload || !payload.data || payload.data.length === 0) {
      return false;
    }

    const json = new TextDecoder().decode(payload.data);
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode the value from a payload, returning a default if decoding fails.
 *
 * @param payload - The payload to decode
 * @param defaultValue - The value to return if decoding fails
 * @returns The decoded value or the default value
 *
 * @example
 * ```typescript
 * const data = tryFromPayload(payload, { orderId: 'unknown' });
 * ```
 */
export function tryFromPayload<T>(payload: Payload, defaultValue: T): T {
  try {
    return fromPayload<T>(payload);
  } catch {
    return defaultValue;
  }
}
