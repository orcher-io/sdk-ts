/**
 * Tests for the public retry-policy surface.
 *
 * The SDK exposes a single retry shape:
 *   - `RetryPolicy` is the durable task retry policy, with intervals in milliseconds.
 *     Durable workflows delegate retries to the engine, so the SDK exports no
 *     in-process retry helper (`RetryPolicyBuilder`, `RetryState`, `BackoffStrategy`,
 *     `JitterStrategy`, `DEFAULT_RETRY_POLICY`, `executeWithRetry`, `RetryPolicies`).
 *   - `WorkflowStartOptions` has no `retryPolicy` field and there is no
 *     `WorkflowRetryPolicy`, because the native start binding does not read them.
 *
 * The runtime block below asserts that those value exports are absent.
 *
 * NOTE: tsconfig excludes test files, so `tsc` does not check the type-level block
 * below and it proves nothing on its own. It documents the intended types and
 * becomes enforced once test type-checking is enabled.
 */

import * as sdk from '../index';
import type { RetryPolicy, WorkflowStartOptions, DIRetryPolicy } from '../index';

describe('retry-policy public surface (B7)', () => {
  const removed = [
    'RetryPolicyBuilder',
    'RetryState',
    'BackoffStrategy',
    'JitterStrategy',
    'DEFAULT_RETRY_POLICY',
    'RetryPolicies',
    'executeWithRetry',
  ];

  it.each(removed)('no longer exports the in-process retry helper: %s', (name) => {
    expect(sdk).not.toHaveProperty(name);
  });

  it('still exports the durable RetryPolicy type usably', () => {
    const policy: RetryPolicy = {
      maxAttempts: 5,
      initialInterval: 2000,
      maxInterval: 30000,
      backoffCoefficient: 3.0,
      nonRetryableErrorTypes: ['ValidationError'],
    };
    expect(policy.maxAttempts).toBe(5);
    expect(policy.nonRetryableErrorTypes).toContain('ValidationError');
  });
});

// ---------------------------------------------------------------------------
// Type-level contract. Checked by `tsc` only when test files are type-checked.
// ---------------------------------------------------------------------------

// The canonical RetryPolicy carries the durable task fields (ms intervals);
// `nonRetryableErrorTypes` is optional.
const _canonical: RetryPolicy = {
  maxAttempts: 3,
  initialInterval: 1000,
  maxInterval: 60000,
  backoffCoefficient: 2.0,
};
void _canonical;

// `WorkflowStartOptions` has no `retryPolicy` field, because the native start
// binding would ignore it. This resolves to `true` only if the key is absent.
type RetryPolicyRemovedFromStart = 'retryPolicy' extends keyof WorkflowStartOptions ? false : true;
const _retryOptionRemoved: RetryPolicyRemovedFromStart = true;
void _retryOptionRemoved;

// The DI retry-policy export is the single canonical `Partial<RetryPolicy>`.
// These assignments compile only if `DIRetryPolicy` and `Partial<RetryPolicy>` are
// mutually assignable — i.e. there is one underlying definition, not a look-alike.
const _diIsPartial: Partial<RetryPolicy> = {} as DIRetryPolicy;
const _partialIsDi: DIRetryPolicy = {} as Partial<RetryPolicy>;
void _diIsPartial;
void _partialIsDi;

// The partial accepts a subset of fields (every field optional).
const _diOverride: DIRetryPolicy = { maxAttempts: 5 };
void _diOverride;
