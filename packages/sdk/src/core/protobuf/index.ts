/**
 * Protocol Buffer utilities for Orcher.
 *
 * Thin wrappers around the @protobuf-ts generated code for creating payloads
 * and using the protobuf types with full typing.
 *
 * @packageDocumentation
 *
 * @example
 * Basic payload creation and extraction:
 * ```typescript
 * import { toPayload, fromPayload } from '@orcher/sdk';
 *
 * const payload = toPayload({ orderId: '123', amount: 100 });
 * const data = fromPayload<OrderData>(payload);
 * ```
 *
 * @example
 * Binary serialization for network transport:
 * ```typescript
 * import { toPayload, Payload } from '@orcher/sdk';
 *
 * const payload = toPayload({ orderId: '123' });
 *
 * // Serialize to binary protobuf format with the @protobuf-ts built-in
 * const bytes = Payload.toBinary(payload);
 *
 * // Deserialize from binary
 * const restored = Payload.fromBinary(bytes);
 * ```
 */

export {
  toPayload,
  fromPayload,
  toPayloadWithMetadata,
  getPayloadMetadata,
  isValidPayload,
  tryFromPayload,
  PayloadError,
} from './payload';

// Re-export commonly used generated types
export {
  Payload,
  WorkflowExecution,
  WorkflowStatus,
  Header,
  RetryPolicy,
  Failure,
} from '../generated/types';

// Re-export all generated protobuf code for advanced usage
export * from '../generated';

import { Payload as PayloadMessageType } from '../generated/types';

/**
 * The @protobuf-ts `MessageType` instance for `Payload`, re-exported as-is.
 *
 * At run time it provides `toBinary()`, `fromBinary()`, `toJson()` and `fromJson()`.
 * It is typed as `unknown`, so for typed calls use the `Payload` export, which is the
 * same object.
 *
 * @example
 * ```typescript
 * import { toPayload, Payload } from '@orcher/sdk';
 *
 * const payload = toPayload({ data: 'test' });
 *
 * // Serialize to binary
 * const bytes = Payload.toBinary(payload);
 *
 * // Deserialize from binary
 * const restored = Payload.fromBinary(bytes);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
export const PayloadUtils = PayloadMessageType as unknown;
