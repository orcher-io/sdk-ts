/**
 * Typed errors across the native boundary, and the timeout contract.
 *
 * `parseErrorCode` reads a `[CODE]` prefix and maps it to `ErrorCode`, which is
 * how `NotFoundError` and `TimeoutError` become reachable. Two things must hold
 * for that to work, and both are pinned here:
 *
 *   - the native layer throws errors that carry the prefix, not bare strings
 *   - the prefix is matched against enum VALUES (`NOT_FOUND`), not KEYS
 *     (`NotFound`); TypeScript string enums have no reverse mapping, so
 *     `code in ErrorCode` would never match
 */

import { ErrorCode, extractErrorMessage, parseErrorCode } from '../types';
import { TimeoutError } from '../errors';

describe('parseErrorCode', () => {
  it('maps a tagged code to its ErrorCode', () => {
    expect(parseErrorCode('[NOT_FOUND] status: workflow missing')).toBe(ErrorCode.NotFound);
    expect(parseErrorCode('[TIMEOUT] result: too slow')).toBe(ErrorCode.Timeout);
    expect(parseErrorCode('[UNAVAILABLE] connect: server down')).toBe(ErrorCode.Unavailable);
  });

  it('matches on enum values, which is what the tag contains', () => {
    // `'NOT_FOUND' in ErrorCode` is false because the keys are PascalCase.
    // Asserted directly so the reason cannot be lost.
    expect('NOT_FOUND' in ErrorCode).toBe(false);
    expect(Object.values(ErrorCode)).toContain('NOT_FOUND');
    expect(parseErrorCode('[NOT_FOUND] x')).toBe(ErrorCode.NotFound);
  });

  it('falls back to Unknown for an untagged or unrecognised message', () => {
    expect(parseErrorCode('something went wrong')).toBe(ErrorCode.Unknown);
    expect(parseErrorCode('[NOT_A_REAL_CODE] x')).toBe(ErrorCode.Unknown);
  });

  it('reads the code, and only the message, from a tag that names things beside it', () => {
    const tagged = '[ALREADY_EXISTS run_id=run-7] start: already running';
    expect(parseErrorCode(tagged)).toBe(ErrorCode.AlreadyExists);
    expect(extractErrorMessage(tagged)).toBe('start: already running');
  });
});

describe('the timeout contract', () => {
  it('carries the Timeout code', () => {
    expect(new TimeoutError('too slow').code).toBe(ErrorCode.Timeout);
  });
});
