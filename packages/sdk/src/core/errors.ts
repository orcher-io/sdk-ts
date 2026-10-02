/**
 * Error classes for the Orcher core.
 *
 * One class per native module error code, so callers can branch with
 * `instanceof` instead of comparing code strings.
 *
 * @module @orcher/sdk/core/errors
 */

import { ErrorCode, parseErrorCode, extractErrorMessage } from './types';

/**
 * Base class for every error the Orcher SDK throws.
 */
export class OrcherError extends Error {
  /**
   * Error code.
   *
   * Typed as `string` because two disjoint vocabularies ride on this base: the
   * transport codes below (`NOT_FOUND`, ...) and the orchestration codes
   * (`WORKFLOW_NOT_FOUND`, ...). Each subtree re-declares it narrowed to its
   * own enum, so callers keep the precise type where it is knowable.
   */
  public readonly code: string;

  /**
   * Original cause (if any)
   */
  public override readonly cause?: Error;

  /**
   * Create a new OrcherError
   *
   * @param message - Error message
   * @param code - Error code
   * @param cause - Original error cause
   */
  constructor(message: string, code: string = ErrorCode.Unknown, cause?: Error) {
    super(message);
    this.name = 'OrcherError';
    this.code = code;
    this.cause = cause;

    // Start the stack trace at the throw site rather than inside this constructor (V8 only).
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert a native module error into the matching OrcherError subclass.
   *
   * The code is parsed from the `[CODE ...]` tag in the message; an unrecognized
   * code yields a plain OrcherError.
   *
   * @param nativeError - Error from native module
   */
  static fromNative(nativeError: Error): OrcherError {
    const code = parseErrorCode(nativeError.message);
    const message = extractErrorMessage(nativeError.message);

    switch (code) {
      case ErrorCode.InvalidArgument:
        return new InvalidArgumentError(message, nativeError);
      case ErrorCode.ConnectionFailed:
        return new ConnectionError(message, nativeError);
      case ErrorCode.Timeout:
        return new TimeoutError(message, nativeError);
      case ErrorCode.NotFound:
        return new NotFoundError(message, nativeError);
      case ErrorCode.AlreadyExists:
        return new AlreadyExistsError(message, nativeError);
      case ErrorCode.PermissionDenied:
        return new PermissionDeniedError(message, nativeError);
      case ErrorCode.ResourceExhausted:
        return new ResourceExhaustedError(message, nativeError);
      case ErrorCode.FailedPrecondition:
        return new FailedPreconditionError(message, nativeError);
      case ErrorCode.Aborted:
        return new AbortedError(message, nativeError);
      case ErrorCode.OutOfRange:
        return new OutOfRangeError(message, nativeError);
      case ErrorCode.Unimplemented:
        return new UnimplementedError(message, nativeError);
      case ErrorCode.Internal:
        return new InternalError(message, nativeError);
      case ErrorCode.Unavailable:
        return new UnavailableError(message, nativeError);
      case ErrorCode.DataLoss:
        return new DataLossError(message, nativeError);
      case ErrorCode.Unauthenticated:
        return new UnauthenticatedError(message, nativeError);
      default:
        return new OrcherError(message, code, nativeError);
    }
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

/**
 * Invalid argument error
 */
export class InvalidArgumentError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.InvalidArgument, cause);
    this.name = 'InvalidArgumentError';
  }
}

/**
 * Connection error
 */
export class ConnectionError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.ConnectionFailed, cause);
    this.name = 'ConnectionError';
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Timeout, cause);
    this.name = 'TimeoutError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.NotFound, cause);
    this.name = 'NotFoundError';
  }
}

/**
 * Already exists error
 */
export class AlreadyExistsError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.AlreadyExists, cause);
    this.name = 'AlreadyExistsError';
  }
}

/**
 * Permission denied error
 */
export class PermissionDeniedError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.PermissionDenied, cause);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Resource exhausted error
 */
export class ResourceExhaustedError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.ResourceExhausted, cause);
    this.name = 'ResourceExhaustedError';
  }
}

/**
 * Failed precondition error
 */
export class FailedPreconditionError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.FailedPrecondition, cause);
    this.name = 'FailedPreconditionError';
  }
}

/**
 * Aborted error
 */
export class AbortedError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Aborted, cause);
    this.name = 'AbortedError';
  }
}

/**
 * Out of range error
 */
export class OutOfRangeError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.OutOfRange, cause);
    this.name = 'OutOfRangeError';
  }
}

/**
 * Unimplemented error
 */
export class UnimplementedError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Unimplemented, cause);
    this.name = 'UnimplementedError';
  }
}

/**
 * Internal error
 */
export class InternalError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Internal, cause);
    this.name = 'InternalError';
  }
}

/**
 * Unavailable error
 */
export class UnavailableError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Unavailable, cause);
    this.name = 'UnavailableError';
  }
}

/**
 * Data loss error
 */
export class DataLossError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.DataLoss, cause);
    this.name = 'DataLossError';
  }
}

/**
 * Unauthenticated error
 */
export class UnauthenticatedError extends OrcherError {
  constructor(message: string, cause?: Error) {
    super(message, ErrorCode.Unauthenticated, cause);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Error originating from a client operation.
 */
export class ClientError extends OrcherError {
  constructor(message: string, code: ErrorCode = ErrorCode.Internal, cause?: Error) {
    super(message, code, cause);
    this.name = 'ClientError';
  }
}




/**
 * Whether an error is an OrcherError.
 */
export function isOrcherError(error: unknown): error is OrcherError {
  return error instanceof OrcherError;
}

/**
 * Whether an error is an OrcherError with the given code.
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return isOrcherError(error) && error.code === code;
}

/**
 * Wrap an unknown error as an OrcherError.
 *
 * An OrcherError is returned unchanged and an Error goes through
 * {@link OrcherError.fromNative}. For any other value, `message` is used when given,
 * otherwise the value's string form.
 */
export function wrapError(error: unknown, message?: string): OrcherError {
  if (isOrcherError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return OrcherError.fromNative(error);
  }

  const errorMessage = message || String(error);
  return new OrcherError(errorMessage, ErrorCode.Unknown);
}
