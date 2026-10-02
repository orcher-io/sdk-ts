/**
 * Task Mocking Patterns Example
 *
 * This example demonstrates all the different ways to mock tasks in Orcher:
 * - Fixed value mocking
 * - Sequence mocking (for retry testing)
 * - Function mocking (dynamic behavior)
 * - Error mocking
 * - Advanced patterns (alternates, delays, etc.)
 *
 * @example Run this test
 * ```bash
 * npm test -- task-mocking.test.ts
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
class CheckoutTasks {
  @Task()
  async processPayment(_ctx: TaskContext, _input: { amount: number; token: string }) {
    return { transactionId: 'txn_123', success: true };
  }

  @Task()
  async calculateDiscount(_ctx: TaskContext, input: { amount: number; userId: string }) {
    return { discount: 0, finalAmount: input.amount };
  }

  @Task()
  async sendNotification(_ctx: TaskContext, _input: { userId: string; message: string }) {
    return { sent: true, messageId: 'msg_123' };
  }
}

const checkoutTasks = createTaskRefs(CheckoutTasks);

type CheckoutInput = {
  userId: string;
  amount: number;
  items: string[];
};

/**
 * Checkout with the payment step supplied by the caller, so the plain and the
 * retrying workflow below differ only in how they take payment.
 */
async function checkout(
  ctx: WorkflowContext,
  input: CheckoutInput,
  pay: (payment: { amount: number; token: string }) => Promise<{ transactionId: string }>
) {
  // Calculate discount
  const discount = await ctx.executeTask(checkoutTasks.calculateDiscount, {
    amount: input.amount,
    userId: input.userId,
  });

  // Process payment
  const payment = await pay({
    amount: discount.finalAmount,
    token: 'tok_test',
  });

  // Send notification
  await ctx.executeTask(checkoutTasks.sendNotification, {
    userId: input.userId,
    message: `Order confirmed! Transaction: ${payment.transactionId}`,
  });

  return {
    success: true,
    transactionId: payment.transactionId,
    finalAmount: discount.finalAmount,
  };
}

async function checkoutWorkflow(ctx: WorkflowContext, input: CheckoutInput) {
  return checkout(ctx, input, (payment) => ctx.executeTask(checkoutTasks.processPayment, payment));
}

/**
 * The same checkout, retrying a failed payment up to three attempts before
 * giving up with the last error.
 */
async function retryingCheckoutWorkflow(ctx: WorkflowContext, input: CheckoutInput) {
  const maxAttempts = 3;
  return checkout(ctx, input, async (payment) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await ctx.executeTask(checkoutTasks.processPayment, payment);
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }
      }
    }
  });
}

// ============================================================================
// Pattern 1: Fixed Value Mocking
// ============================================================================

describe('Pattern 1: Fixed Value Mocking', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('returns a fixed value every time', async () => {
    // Mock returns the same value for every call
    testEnv.mockTask('calculateDiscount').returns({
      discount: 10,
      finalAmount: 89.99,
    });

    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_fixed_123',
      success: true,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_fixed_456',
    });

    const result = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-123',
      amount: 99.99,
      items: ['item1'],
    });

    expect(result.finalAmount).toBe(89.99);
    expect(result.transactionId).toBe('txn_fixed_123');
  });

  it('allows different fixed values for different tests', async () => {
    // Different scenario: premium user with bigger discount
    testEnv.mockTask('calculateDiscount').returns({
      discount: 50,
      finalAmount: 49.99,
    });

    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_premium_789',
      success: true,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_premium_101',
    });

    const result = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'premium-user-456',
      amount: 99.99,
      items: ['premium-item'],
    });

    expect(result.finalAmount).toBe(49.99);
    expect(result.transactionId).toBe('txn_premium_789');
  });
});

// ============================================================================
// Pattern 2: Sequence Mocking (Retry Testing)
// ============================================================================

describe('Pattern 2: Sequence Mocking', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('returns different values on subsequent calls', async () => {
    // Mock will return different values in sequence
    testEnv.mockTask('processPayment').returnsSequence([
      new Error('Gateway timeout'), // First call fails
      new Error('Gateway timeout'), // Second call fails
      { transactionId: 'txn_retry_success', success: true }, // Third call succeeds
    ]);

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // The retrying workflow eventually succeeds
    const result = await testEnv.executeWorkflow(retryingCheckoutWorkflow, {
      userId: 'user-123',
      amount: 99.99,
      items: ['item1'],
    });

    expect(result.transactionId).toBe('txn_retry_success');

    // Verify payment was attempted 3 times
    const paymentMock = testEnv.getMockTask('processPayment');
    expect(paymentMock.callCount).toBe(3);
  });

  it('tests complete failure after exhausting retries', async () => {
    // All attempts fail
    testEnv.mockTask('processPayment').returnsSequence([
      new Error('Declined'),
      new Error('Declined'),
      new Error('Declined'),
    ]);

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Workflow should fail after all retries
    await expect(
      testEnv.executeWorkflow(retryingCheckoutWorkflow, {
        userId: 'user-123',
        amount: 99.99,
        items: ['item1'],
      })
    ).rejects.toThrow('Declined');
  });

  it('handles mixed success and failure sequence', async () => {
    testEnv.mockTask('processPayment').returnsSequence([
      { transactionId: 'txn_1', success: true }, // Success
      new Error('Timeout'), // Failure
      { transactionId: 'txn_2', success: true }, // Success
    ]);

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // First execution succeeds
    const result1 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-1',
      amount: 99.99,
      items: ['item1'],
    });
    expect(result1.transactionId).toBe('txn_1');

    // Second execution fails
    await expect(
      testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-2',
        amount: 99.99,
        items: ['item2'],
      })
    ).rejects.toThrow('Timeout');

    // Third execution succeeds
    const result3 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-3',
      amount: 99.99,
      items: ['item3'],
    });
    expect(result3.transactionId).toBe('txn_2');
  });
});

// ============================================================================
// Pattern 3: Function Mocking (Dynamic Behavior)
// ============================================================================

describe('Pattern 3: Function Mocking', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('calculates return value based on input', async () => {
    // Mock with custom logic
    testEnv.mockTask('calculateDiscount').withFn(async (input) => {
      // Premium users (user IDs starting with 'premium') get 20% off
      const isPremium = input.userId.startsWith('premium');
      const discountPercent = isPremium ? 0.2 : 0;
      const discount = input.amount * discountPercent;
      const finalAmount = input.amount - discount;

      return { discount, finalAmount };
    });

    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_123',
      success: true,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Regular user - no discount
    const result1 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'regular-user-123',
      amount: 100,
      items: ['item1'],
    });
    expect(result1.finalAmount).toBe(100);

    // Premium user - 20% discount
    const result2 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'premium-user-456',
      amount: 100,
      items: ['item2'],
    });
    expect(result2.finalAmount).toBe(80);
  });

  it('maintains state across calls', async () => {
    // Counter to track calls
    let callCount = 0;

    testEnv.mockTask('processPayment').withFn(async (input) => {
      callCount++;
      return {
        transactionId: `txn_${callCount}`,
        success: true,
      };
    });

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Each call gets incremented transaction ID
    const result1 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-1',
      amount: 99.99,
      items: ['item1'],
    });
    expect(result1.transactionId).toBe('txn_1');

    const result2 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-2',
      amount: 99.99,
      items: ['item2'],
    });
    expect(result2.transactionId).toBe('txn_2');

    const result3 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-3',
      amount: 99.99,
      items: ['item3'],
    });
    expect(result3.transactionId).toBe('txn_3');
  });

  it('throws conditional errors', async () => {
    testEnv.mockTask('processPayment').withFn(async (input) => {
      // Fail for large amounts
      if (input.amount > 1000) {
        throw new Error('Amount exceeds limit');
      }
      return { transactionId: 'txn_123', success: true };
    });

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Small amount succeeds
    const result = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-1',
      amount: 99.99,
      items: ['item1'],
    });
    expect(result.success).toBe(true);

    // Large amount fails
    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 1500,
    });

    await expect(
      testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-2',
        amount: 1500,
        items: ['expensive-item'],
      })
    ).rejects.toThrow('Amount exceeds limit');
  });
});

// ============================================================================
// Pattern 4: Error Mocking
// ============================================================================

describe('Pattern 4: Error Mocking', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('throws error immediately', async () => {
    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('processPayment').throws(new Error('Card declined'));

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    await expect(
      testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-123',
        amount: 99.99,
        items: ['item1'],
      })
    ).rejects.toThrow('Card declined');
  });

  it('throws different error types', async () => {
    class PaymentError extends Error {
      constructor(
        message: string,
        public code: string
      ) {
        super(message);
        this.name = 'PaymentError';
      }
    }

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('processPayment').throws(
      new PaymentError('Insufficient funds', 'INSUFFICIENT_FUNDS')
    );

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    try {
      await testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-123',
        amount: 99.99,
        items: ['item1'],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).code).toBe('INSUFFICIENT_FUNDS');
    }
  });
});

// ============================================================================
// Pattern 5: Advanced Patterns
// ============================================================================

describe('Pattern 5: Advanced Patterns', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('alternates between success and failure', async () => {
    // Alternate between success and failure 3 times
    testEnv.mockTask('processPayment').alternates(
      { transactionId: 'txn_success', success: true },
      new Error('Temporary failure'),
      3
    );

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // First: success
    const result1 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-1',
      amount: 99.99,
      items: ['item1'],
    });
    expect(result1.success).toBe(true);

    // Second: failure
    await expect(
      testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-2',
        amount: 99.99,
        items: ['item2'],
      })
    ).rejects.toThrow('Temporary failure');

    // Third: success
    const result3 = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-3',
      amount: 99.99,
      items: ['item3'],
    });
    expect(result3.success).toBe(true);
  });

  it('throws once then succeeds', async () => {
    testEnv.mockTask('processPayment').throwsOnceThen(
      new Error('First attempt failed'),
      { transactionId: 'txn_recovery', success: true }
    );

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // First attempt fails
    await expect(
      testEnv.executeWorkflow(checkoutWorkflow, {
        userId: 'user-1',
        amount: 99.99,
        items: ['item1'],
      })
    ).rejects.toThrow('First attempt failed');

    // Second attempt succeeds
    const result = await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-2',
      amount: 99.99,
      items: ['item2'],
    });
    expect(result.transactionId).toBe('txn_recovery');
  });

  it('resolves after delay', async () => {
    testEnv.mockTask('processPayment').resolvesAfter(
      { transactionId: 'txn_delayed', success: true },
      5000 // 5 second delay
    );

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    const startTime = testEnv.getCurrentTime();

    const promise = testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-123',
      amount: 99.99,
      items: ['item1'],
    });

    // Advance time to trigger delayed response
    await testEnv.advanceTime(5000);

    const result = await promise;
    const endTime = testEnv.getCurrentTime();

    expect(result.transactionId).toBe('txn_delayed');
    expect(endTime.getTime() - startTime.getTime()).toBeGreaterThanOrEqual(5000);
  });
});

// ============================================================================
// Pattern 6: Mock Inspection and Verification
// ============================================================================

describe('Pattern 6: Mock Inspection', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('inspects call count and history', async () => {
    testEnv.mockTask('calculateDiscount').returns({
      discount: 10,
      finalAmount: 89.99,
    });

    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_123',
      success: true,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Execute workflow 3 times
    for (let i = 0; i < 3; i++) {
      await testEnv.executeWorkflow(checkoutWorkflow, {
        userId: `user-${i}`,
        amount: 99.99,
        items: ['item1'],
      });
    }

    // Inspect payment mock
    const paymentMock = testEnv.getMockTask('processPayment');

    expect(paymentMock.wasCalled).toBe(true);
    expect(paymentMock.callCount).toBe(3);
    expect(paymentMock.calls).toHaveLength(3);

    // Check each call
    paymentMock.calls.forEach((call, index) => {
      expect(call.input).toEqual({
        amount: 89.99,
        token: 'tok_test',
      });
      expect(call.result).toEqual({
        transactionId: 'txn_123',
        success: true,
      });
    });
  });

  it('verifies task was called with specific input', async () => {
    testEnv.mockTask('calculateDiscount').returns({
      discount: 20,
      finalAmount: 79.99,
    });

    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_verify',
      success: true,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_verify',
    });

    await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'premium-user-789',
      amount: 99.99,
      items: ['item1', 'item2'],
    });

    // Verify discount calculation was called correctly
    const discountMock = testEnv.getMockTask('calculateDiscount');
    expect(discountMock.wasCalledWith({
      amount: 99.99,
      userId: 'premium-user-789',
    })).toBe(true);

    // Verify payment was processed with final amount
    const paymentMock = testEnv.getMockTask('processPayment');
    expect(paymentMock.wasCalledWith({
      amount: 79.99,
      token: 'tok_test',
    })).toBe(true);
  });

  it('resets mock between tests', async () => {
    testEnv.mockTask('processPayment').returns({
      transactionId: 'txn_123',
      success: true,
    });

    testEnv.mockTask('calculateDiscount').returns({
      discount: 0,
      finalAmount: 99.99,
    });

    testEnv.mockTask('sendNotification').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // First execution
    await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-1',
      amount: 99.99,
      items: ['item1'],
    });

    const paymentMock = testEnv.getMockTask('processPayment');
    expect(paymentMock.callCount).toBe(1);

    // Reset mock
    paymentMock.reset();
    expect(paymentMock.callCount).toBe(0);
    expect(paymentMock.wasCalled).toBe(false);

    // Second execution after reset
    await testEnv.executeWorkflow(checkoutWorkflow, {
      userId: 'user-2',
      amount: 99.99,
      items: ['item2'],
    });

    expect(paymentMock.callCount).toBe(1); // Only counts calls after reset
  });
});
