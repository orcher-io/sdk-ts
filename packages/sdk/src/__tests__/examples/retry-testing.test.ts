/**
 * Retry and Error Handling Testing Example
 *
 * This example demonstrates how to test retry logic and error handling:
 * - Testing automatic retry behavior
 * - Testing exponential backoff
 * - Testing retry limits
 * - Testing error propagation
 * - Testing compensating actions
 *
 * @example Run this test
 * ```bash
 * npm test -- retry-testing.test.ts
 * ```
 */

import { TestWorkflowEnvironment } from '../../testing';
import { Tasks, Task, createTaskRefs } from '../../di';
import type { TaskContext } from '../../task';
import type { WorkflowContext } from '../../workflow';

// ============================================================================
// Test Tasks and Workflows
// ============================================================================

@Tasks()
class ApiTasks {
  @Task()
  async unreliableApiCall(_ctx: TaskContext, _input: { endpoint: string; data: any }) {
    return { success: true, responseId: 'resp_123' };
  }

  @Task()
  async rollbackTransaction(_ctx: TaskContext, _input: { transactionId: string }) {
    return { rolledBack: true };
  }

  @Task()
  async logError(_ctx: TaskContext, _input: { error: string; context: any }) {
    return { logged: true };
  }

  @Task()
  async processBatch(_ctx: TaskContext, input: { items: string[] }) {
    return { processed: input.items.length, failed: 0 };
  }
}

const apiTasks = createTaskRefs(ApiTasks);

/**
 * Calls an unreliable API, retrying in workflow code up to `maxRetries` attempts
 * and logging each failure through a task.
 */
async function resilientWorkflow(ctx: WorkflowContext, input: { data: any; maxRetries: number }) {
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < input.maxRetries) {
    try {
      attempt++;
      const result = await ctx.executeTask(apiTasks.unreliableApiCall, {
        endpoint: '/api/process',
        data: input.data,
      });

      if (result.success) {
        return {
          success: true,
          attempts: attempt,
          responseId: result.responseId,
        };
      }
    } catch (error) {
      lastError = error as Error;
      await ctx.executeTask(apiTasks.logError, {
        error: (error as Error).message,
        context: { attempt, data: input.data },
      });

      // Retry unless this was the last attempt.
      if (attempt < input.maxRetries) {
        continue;
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `Failed after ${attempt} attempts: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Runs a transaction and, if the call fails, rolls it back as a compensating
 * action before rethrowing.
 */
async function transactionWorkflow(
  ctx: WorkflowContext,
  input: { transactionId: string; amount: number }
) {
  // The transaction counts as started once the call is made: a call that
  // fails may still have taken effect on the far side, so it is rolled back.
  let transactionId: string | null = null;

  try {
    transactionId = input.transactionId;
    const result = await ctx.executeTask(apiTasks.unreliableApiCall, {
      endpoint: '/api/transaction',
      data: { id: input.transactionId, amount: input.amount },
    });

    if (!result.success) {
      throw new Error('Transaction failed');
    }

    return { success: true, transactionId };
  } catch (error) {
    // Rollback if transaction was initiated
    if (transactionId) {
      await ctx.executeTask(apiTasks.rollbackTransaction, { transactionId });
    }

    await ctx.executeTask(apiTasks.logError, {
      error: (error as Error).message,
      context: { transactionId: input.transactionId },
    });

    throw error;
  }
}

// ============================================================================
// Successful Retry After Failures
// ============================================================================

describe('Retry Testing', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should succeed after 2 failures', async () => {
    // Mock: fail twice, then succeed
    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new Error('Timeout'),
      new Error('Service unavailable'),
      { success: true, responseId: 'resp_success_123' },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(resilientWorkflow, {
      data: { key: 'value' },
      maxRetries: 3,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.responseId).toBe('resp_success_123');

    // Verify retry attempts
    const apiMock = testEnv.getMockTask('unreliableApiCall');
    expect(apiMock.callCount).toBe(3);

    // Verify errors were logged (once for each failure)
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(2);
  });

  it('should succeed on first attempt', async () => {
    // No failures - succeeds immediately
    testEnv.mockTask('unreliableApiCall').returns({
      success: true,
      responseId: 'resp_first_try',
    });

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(resilientWorkflow, {
      data: { key: 'value' },
      maxRetries: 3,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);

    // Verify no retries were needed
    const apiMock = testEnv.getMockTask('unreliableApiCall');
    expect(apiMock.callCount).toBe(1);

    // Verify no errors were logged
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(0);
  });

  it('should fail after exhausting all retries', async () => {
    // All attempts fail
    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new Error('Error 1'),
      new Error('Error 2'),
      new Error('Error 3'),
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    await expect(
      testEnv.executeWorkflow(resilientWorkflow, {
        data: { key: 'value' },
        maxRetries: 3,
      })
    ).rejects.toThrow('Failed after 3 attempts');

    // Verify all retry attempts were made
    const apiMock = testEnv.getMockTask('unreliableApiCall');
    expect(apiMock.callCount).toBe(3);

    // Verify errors were logged for each attempt
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(3);
  });
});

// ============================================================================
// Error Types and Handling
// ============================================================================

describe('Error Type Handling', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should handle different error types', async () => {
    class NetworkError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NetworkError';
      }
    }

    class ValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
      }
    }

    // Fail with different error types, then succeed
    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new NetworkError('Connection timeout'),
      new ValidationError('Invalid data'),
      { success: true, responseId: 'resp_mixed_errors' },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(resilientWorkflow, {
      data: { key: 'value' },
      maxRetries: 3,
    });

    expect(result.success).toBe(true);

    // Verify different error types were logged
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.calls[0]!.input.error).toBe('Connection timeout');
    expect(logMock.calls[1]!.input.error).toBe('Invalid data');
  });

  it('should preserve error context in logs', async () => {
    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new Error('First failure'),
      { success: true, responseId: 'resp_123' },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    await testEnv.executeWorkflow(resilientWorkflow, {
      data: { userId: 'user-123', action: 'purchase' },
      maxRetries: 2,
    });

    // Verify error was logged with context
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.calls[0]!.input).toEqual({
      error: 'First failure',
      context: {
        attempt: 1,
        data: { userId: 'user-123', action: 'purchase' },
      },
    });
  });
});

// ============================================================================
// Compensating Actions (Rollback)
// ============================================================================

describe('Compensating Actions', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should rollback transaction on failure', async () => {
    // Transaction fails
    testEnv.mockTask('unreliableApiCall').throws(new Error('Transaction failed'));

    testEnv.mockTask('rollbackTransaction').returns({ rolledBack: true });

    testEnv.mockTask('logError').returns({ logged: true });

    await expect(
      testEnv.executeWorkflow(transactionWorkflow, {
        transactionId: 'txn_123',
        amount: 100,
      })
    ).rejects.toThrow('Transaction failed');

    // Verify rollback was called
    const rollbackMock = testEnv.getMockTask('rollbackTransaction');
    expect(rollbackMock.callCount).toBe(1);
    expect(rollbackMock.calls[0]!.input).toEqual({
      transactionId: 'txn_123',
    });

    // Verify error was logged
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(1);
  });

  it('should rollback even when the call fails before confirming', async () => {
    // The call throws without saying whether the transaction happened
    testEnv.mockTask('unreliableApiCall').throws(
      new Error('Pre-transaction failure')
    );

    testEnv.mockTask('rollbackTransaction').returns({ rolledBack: true });

    testEnv.mockTask('logError').returns({ logged: true });

    await expect(
      testEnv.executeWorkflow(transactionWorkflow, {
        transactionId: 'txn_456',
        amount: 200,
      })
    ).rejects.toThrow('Pre-transaction failure');

    // Verify rollback was still called: an unconfirmed transaction may have
    // gone through, so it is compensated rather than assumed not to exist
    const rollbackMock = testEnv.getMockTask('rollbackTransaction');
    expect(rollbackMock.callCount).toBe(1);
  });

  it('should succeed without rollback', async () => {
    // Transaction succeeds
    testEnv.mockTask('unreliableApiCall').returns({
      success: true,
      responseId: 'resp_txn_success',
    });

    testEnv.mockTask('rollbackTransaction').returns({ rolledBack: true });

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(transactionWorkflow, {
      transactionId: 'txn_789',
      amount: 300,
    });

    expect(result.success).toBe(true);

    // Verify rollback was NOT called
    const rollbackMock = testEnv.getMockTask('rollbackTransaction');
    expect(rollbackMock.callCount).toBe(0);

    // Verify no errors were logged
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(0);
  });
});

// ============================================================================
// Retry with Different Error Codes
// ============================================================================

describe('Selective Retry Based on Error', () => {
  let testEnv: TestWorkflowEnvironment;

  async function selectiveRetryWorkflow(ctx: WorkflowContext, input: { data: any }) {
    const retryableErrors = ['TIMEOUT', 'SERVICE_UNAVAILABLE', 'RATE_LIMIT'];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        const result = await ctx.executeTask(apiTasks.unreliableApiCall, {
          endpoint: '/api/selective',
          data: input.data,
        });
        return { success: true, attempts };
      } catch (error) {
        const errorCode = (error as any).code;

        // Only retry for specific error codes
        if (retryableErrors.includes(errorCode) && attempts < maxAttempts) {
          await ctx.executeTask(apiTasks.logError, {
            error: (error as Error).message,
            context: { attempt: attempts, retryable: true },
          });
          continue;
        }

        // Non-retryable error or max attempts reached
        await ctx.executeTask(apiTasks.logError, {
          error: (error as Error).message,
          context: { attempt: attempts, retryable: false },
        });
        throw error;
      }
    }

    throw new Error('Max attempts reached');
  }

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should retry retryable errors', async () => {
    class RetryableError extends Error {
      code = 'TIMEOUT';
      constructor(message: string) {
        super(message);
        this.name = 'RetryableError';
      }
    }

    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new RetryableError('Timeout on attempt 1'),
      new RetryableError('Timeout on attempt 2'),
      { success: true, responseId: 'resp_retry_success' },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(selectiveRetryWorkflow, {
      data: { key: 'value' },
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);

    // Verify retries were attempted
    const apiMock = testEnv.getMockTask('unreliableApiCall');
    expect(apiMock.callCount).toBe(3);
  });

  it('should not retry non-retryable errors', async () => {
    class NonRetryableError extends Error {
      code = 'INVALID_INPUT';
      constructor(message: string) {
        super(message);
        this.name = 'NonRetryableError';
      }
    }

    testEnv.mockTask('unreliableApiCall').throws(
      new NonRetryableError('Invalid input data')
    );

    testEnv.mockTask('logError').returns({ logged: true });

    await expect(
      testEnv.executeWorkflow(selectiveRetryWorkflow, {
        data: { invalid: true },
      })
    ).rejects.toThrow('Invalid input data');

    // Verify only one attempt was made (no retries)
    const apiMock = testEnv.getMockTask('unreliableApiCall');
    expect(apiMock.callCount).toBe(1);

    // Verify error was logged as non-retryable
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.calls[0]!.input.context.retryable).toBe(false);
  });
});

// ============================================================================
// Exponential Backoff Pattern
// ============================================================================

describe('Exponential Backoff', () => {
  let testEnv: TestWorkflowEnvironment;

  async function backoffWorkflow(ctx: WorkflowContext, input: { data: any }) {
    let attempts = 0;
    const maxAttempts = 4;
    const baseDelay = 1000; // 1 second

    while (attempts < maxAttempts) {
      try {
        attempts++;
        const result = await ctx.executeTask(apiTasks.unreliableApiCall, {
          endpoint: '/api/backoff',
          data: input.data,
        });
        return { success: true, attempts };
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw error;
        }

        // Calculate exponential backoff: 1s, 2s, 4s, 8s
        const delay = baseDelay * Math.pow(2, attempts - 1);

        await ctx.executeTask(apiTasks.logError, {
          error: (error as Error).message,
          context: { attempt: attempts, nextRetryIn: delay },
        });

        // A real workflow would wait here with `ctx.sleep(delay)`; this
        // example only records the delay it would use.
        continue;
      }
    }

    throw new Error('Max attempts reached');
  }

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should log increasing backoff delays', async () => {
    testEnv.mockTask('unreliableApiCall').returnsSequence([
      new Error('Attempt 1 failed'),
      new Error('Attempt 2 failed'),
      new Error('Attempt 3 failed'),
      { success: true, responseId: 'resp_backoff_success' },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    const result = await testEnv.executeWorkflow(backoffWorkflow, {
      data: { key: 'value' },
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(4);

    // Verify backoff delays increase exponentially
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.calls[0]!.input.context.nextRetryIn).toBe(1000); // 1s
    expect(logMock.calls[1]!.input.context.nextRetryIn).toBe(2000); // 2s
    expect(logMock.calls[2]!.input.context.nextRetryIn).toBe(4000); // 4s
  });
});

// ============================================================================
// Partial Success Handling
// ============================================================================

describe('Partial Success', () => {
  let testEnv: TestWorkflowEnvironment;

  async function batchWorkflow(ctx: WorkflowContext, input: { items: string[] }) {
    const batchSize = 10;
    const results: string[] = [];
    const failures: string[] = [];

    for (let i = 0; i < input.items.length; i += batchSize) {
      const batch = input.items.slice(i, i + batchSize);

      try {
        const result = await ctx.executeTask(apiTasks.processBatch, { items: batch });
        results.push(...batch);
      } catch (error) {
        failures.push(...batch);
        await ctx.executeTask(apiTasks.logError, {
          error: (error as Error).message,
          context: { batch, startIndex: i },
        });
      }
    }

    return {
      totalItems: input.items.length,
      successCount: results.length,
      failureCount: failures.length,
      failures,
    };
  }

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should handle partial batch failures', async () => {
    // First batch succeeds, second fails, third succeeds
    testEnv.mockTask('processBatch').returnsSequence([
      { processed: 10, failed: 0 },
      new Error('Batch 2 failed'),
      { processed: 5, failed: 0 },
    ]);

    testEnv.mockTask('logError').returns({ logged: true });

    const items = Array.from({ length: 25 }, (_, i) => `item-${i}`);
    const result = await testEnv.executeWorkflow(batchWorkflow, { items });

    expect(result.totalItems).toBe(25);
    expect(result.successCount).toBe(15); // 10 + 5
    expect(result.failureCount).toBe(10); // Failed batch
    expect(result.failures).toHaveLength(10);

    // Verify error was logged for failed batch
    const logMock = testEnv.getMockTask('logError');
    expect(logMock.callCount).toBe(1);
    expect(logMock.calls[0]!.input.context.startIndex).toBe(10);
  });
});
