/**
 * Native bridge between TypeScript and the Orcher Rust core.
 *
 * Low-level bindings to sdk-core through Neon (N-API). This module exposes:
 *
 * - the client API for starting and managing workflows
 * - type definitions and error classes
 * - protobuf payload helpers
 * - native module loading and health checks
 *
 * Workers are not part of this module; use `Worker` from `@orcher/sdk`.
 *
 * @packageDocumentation
 * @module @orcher/sdk/core
 */

export {
  getNativeModule,
  isNativeModuleAvailable,
  getNativeVersion,
  getNativeModuleVersion,
  performHealthCheck,
  getNativeModuleInfo,
} from './native';

export type {
  ClientConfig,
  ServiceConfig,
  ExecutionRequest,
  ExecutionResult,
  NativeModule,
  Disposable,
  AsyncDisposable,
  NativeClientHandle,
  NativeServiceHandle,
  NativeWorkflowHandle,
} from './types';

export type {
  WorkflowStartOptions,
  WorkflowHandleOptions,
  QueryOptions,
  EventOptions,
} from '../client/types';

export { WorkflowIdReusePolicy } from '../client/types';

export { WorkflowStatus, ErrorCode, parseErrorCode, extractErrorMessage } from './types';
export type {
  WorkflowExecutionDescription,
  WorkflowExecutionConfig,
  WorkflowExecutionInfo,
  WorkflowListPage,
  ListWorkflowsOptions,
  SearchWorkflowsOptions,
  ParentExecutionInfo,
} from './types';

export {
  OrcherError,
  InvalidArgumentError,
  ConnectionError,
  TimeoutError,
  NotFoundError,
  AlreadyExistsError,
  PermissionDeniedError,
  ResourceExhaustedError,
  FailedPreconditionError,
  AbortedError,
  OutOfRangeError,
  UnimplementedError,
  InternalError,
  UnavailableError,
  DataLossError,
  UnauthenticatedError,
  ClientError,
  isOrcherError,
  isErrorCode,
  wrapError,
} from './errors';

export { Client, WorkflowHandle } from '../client';

// Protobuf utilities: thin wrappers over @protobuf-ts.
export {
  toPayload,
  fromPayload,
  toPayloadWithMetadata,
  getPayloadMetadata,
  isValidPayload,
  tryFromPayload,
  PayloadError,
  PayloadUtils,
  // Re-export commonly used generated types
  Payload,
  WorkflowExecution,
  Header,
  RetryPolicy,
  Failure,
} from './protobuf';

/** Version of the core native bindings. */
export const CORE_VERSION = '0.1.0';

/**
 * With `ORCHER_DEBUG` set, log the core and native module versions when this module loads.
 */
if (typeof process !== 'undefined' && process.env?.['ORCHER_DEBUG']) {
  // eslint-disable-next-line no-console
  console.log(`[@orcher/sdk/core] Version ${CORE_VERSION} loaded`);
  try {
    // Required lazily to avoid a circular import at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./native') as typeof import('./native');
    // eslint-disable-next-line no-console
    console.log(`[@orcher/sdk/core] Native module version: ${native.getNativeVersion()}`);
    // eslint-disable-next-line no-console
    console.log(`[@orcher/sdk/core] Native core version: ${native.getNativeModuleVersion()}`);
  } catch {
    // eslint-disable-next-line no-console
    console.log('[@orcher/sdk/core] Native module not yet available');
  }
}
