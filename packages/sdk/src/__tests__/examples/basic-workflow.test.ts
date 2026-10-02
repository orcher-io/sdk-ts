/**
 * Basic Workflow Testing Example
 *
 * This example demonstrates the fundamentals of testing Orcher workflows:
 * - Setting up a test environment
 * - Mocking tasks
 * - Executing workflows
 * - Making assertions
 *
 * @example Run this test
 * ```bash
 * npm test -- basic-workflow.test.ts
 * ```
 */

import { TestWorkflowEnvironment } from '../../testing';
import { Tasks, Task, createTaskRefs } from '../../di';
import type { TaskContext } from '../../task';
import type { WorkflowContext } from '../../workflow';

// ============================================================================
// Define Test Workflows and Tasks
// ============================================================================

/**
 * Order tasks. The test environment never runs these bodies — every test
 * mocks the tasks by name — but they show what the real handlers look like.
 */
@Tasks()
class OrderTasks {
  /** Charges a credit card. */
  @Task()
  async chargeCard(_ctx: TaskContext, input: { amount: number; cardToken: string }) {
    // A real implementation would call a payment gateway.
    return {
      chargeId: `ch_${Date.now()}`,
      amount: input.amount,
      success: true,
    };
  }

  /** Reserves inventory for the order's items. */
  @Task()
  async reserveInventory(_ctx: TaskContext, input: { items: string[]; orderId: string }) {
    // A real implementation would call an inventory service.
    return {
      reservationId: `res_${Date.now()}`,
      items: input.items,
      reserved: true,
    };
  }

  /** Sends the order confirmation email. */
  @Task()
  async sendConfirmationEmail(_ctx: TaskContext, _input: { email: string; orderId: string }) {
    // A real implementation would send an actual email.
    return {
      messageId: `msg_${Date.now()}`,
      sent: true,
    };
  }
}

const orderTasks = createTaskRefs(OrderTasks);

/**
 * Order workflow. It runs three tasks in order and stops at the first failure:
 * 1. Charge the customer's card
 * 2. Reserve inventory
 * 3. Send confirmation email
 */
async function orderWorkflow(
  ctx: WorkflowContext,
  input: {
    orderId: string;
    customerId: string;
    amount: number;
    items: string[];
    email: string;
  }
) {
  const charge = await ctx.executeTask(orderTasks.chargeCard, {
    amount: input.amount,
    cardToken: 'tok_test',
  });

  if (!charge.success) {
    throw new Error('Payment failed');
  }

  const reservation = await ctx.executeTask(orderTasks.reserveInventory, {
    items: input.items,
    orderId: input.orderId,
  });

  if (!reservation.reserved) {
    throw new Error('Inventory reservation failed');
  }

  await ctx.executeTask(orderTasks.sendConfirmationEmail, {
    email: input.email,
    orderId: input.orderId,
  });

  return {
    orderId: input.orderId,
    chargeId: charge.chargeId,
    reservationId: reservation.reservationId,
    status: 'completed' as const,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Basic Workflow Testing', () => {
  let testEnv: TestWorkflowEnvironment;

  /** Creates a fresh test environment for each test, so tests stay isolated. */
  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  /** Cleans up the test environment after each test so no state leaks. */
  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should complete order successfully', async () => {
    // ARRANGE: Set up test data and mocks
    const orderInput = {
      orderId: 'order-123',
      customerId: 'cust-456',
      amount: 99.99,
      items: ['widget-1', 'widget-2'],
      email: 'customer@example.com',
    };

    // Mock task responses - these replace the real task implementations
    testEnv.mockTask('chargeCard').returns({
      chargeId: 'ch_test_123',
      amount: 99.99,
      success: true,
    });

    testEnv.mockTask('reserveInventory').returns({
      reservationId: 'res_test_456',
      items: ['widget-1', 'widget-2'],
      reserved: true,
    });

    testEnv.mockTask('sendConfirmationEmail').returns({
      messageId: 'msg_test_789',
      sent: true,
    });

    // ACT: Execute the workflow
    const result = await testEnv.executeWorkflow(orderWorkflow, orderInput);

    // ASSERT: Verify the results
    expect(result.status).toBe('completed');
    expect(result.orderId).toBe('order-123');
    expect(result.chargeId).toBe('ch_test_123');
    expect(result.reservationId).toBe('res_test_456');

    // ASSERT: Verify tasks were called
    testEnv.assertTaskCalled('chargeCard', 1);
    testEnv.assertTaskCalled('reserveInventory', 1);
    testEnv.assertTaskCalled('sendConfirmationEmail', 1);
  });

  it('should pass correct inputs to tasks', async () => {
    // ARRANGE
    const orderInput = {
      orderId: 'order-789',
      customerId: 'cust-999',
      amount: 149.99,
      items: ['premium-widget'],
      email: 'vip@example.com',
    };

    testEnv.mockTask('chargeCard').returns({
      chargeId: 'ch_123',
      amount: 149.99,
      success: true,
    });

    testEnv.mockTask('reserveInventory').returns({
      reservationId: 'res_123',
      items: ['premium-widget'],
      reserved: true,
    });

    testEnv.mockTask('sendConfirmationEmail').returns({
      messageId: 'msg_123',
      sent: true,
    });

    // ACT
    await testEnv.executeWorkflow(orderWorkflow, orderInput);

    // ASSERT: Verify task was called with correct inputs
    testEnv.assertTaskCalledWith('chargeCard', {
      amount: 149.99,
      cardToken: 'tok_test',
    });

    testEnv.assertTaskCalledWith('reserveInventory', {
      items: ['premium-widget'],
      orderId: 'order-789',
    });

    testEnv.assertTaskCalledWith('sendConfirmationEmail', {
      email: 'vip@example.com',
      orderId: 'order-789',
    });
  });

  it('should fail when payment is declined', async () => {
    // ARRANGE
    const orderInput = {
      orderId: 'order-failed',
      customerId: 'cust-123',
      amount: 99.99,
      items: ['widget-1'],
      email: 'customer@example.com',
    };

    // Mock payment failure
    testEnv.mockTask('chargeCard').returns({
      chargeId: '',
      amount: 0,
      success: false,
    });

    // ACT & ASSERT: Workflow should throw error
    await expect(
      testEnv.executeWorkflow(orderWorkflow, orderInput)
    ).rejects.toThrow('Payment failed');

    // ASSERT: Verify charge was attempted but subsequent tasks were not called
    testEnv.assertTaskCalled('chargeCard', 1);
    testEnv.assertTaskCalled('reserveInventory', 0);
    testEnv.assertTaskCalled('sendConfirmationEmail', 0);
  });

  it('should fail when inventory cannot be reserved', async () => {
    // ARRANGE
    const orderInput = {
      orderId: 'order-no-stock',
      customerId: 'cust-123',
      amount: 99.99,
      items: ['out-of-stock-item'],
      email: 'customer@example.com',
    };

    // Payment succeeds
    testEnv.mockTask('chargeCard').returns({
      chargeId: 'ch_123',
      amount: 99.99,
      success: true,
    });

    // But inventory reservation fails
    testEnv.mockTask('reserveInventory').returns({
      reservationId: '',
      items: [],
      reserved: false,
    });

    // ACT & ASSERT
    await expect(
      testEnv.executeWorkflow(orderWorkflow, orderInput)
    ).rejects.toThrow('Inventory reservation failed');

    // ASSERT: Verify payment was charged but email was not sent
    testEnv.assertTaskCalled('chargeCard', 1);
    testEnv.assertTaskCalled('reserveInventory', 1);
    testEnv.assertTaskCalled('sendConfirmationEmail', 0);
  });

  it('should handle multiple independent orders', async () => {
    // Setup mocks
    testEnv.mockTask('chargeCard').returns({
      chargeId: 'ch_123',
      amount: 99.99,
      success: true,
    });

    testEnv.mockTask('reserveInventory').returns({
      reservationId: 'res_123',
      items: ['widget'],
      reserved: true,
    });

    testEnv.mockTask('sendConfirmationEmail').returns({
      messageId: 'msg_123',
      sent: true,
    });

    // Execute first order
    const result1 = await testEnv.executeWorkflow(orderWorkflow, {
      orderId: 'order-1',
      customerId: 'cust-1',
      amount: 99.99,
      items: ['widget-1'],
      email: 'customer1@example.com',
    });

    // Execute second order
    const result2 = await testEnv.executeWorkflow(orderWorkflow, {
      orderId: 'order-2',
      customerId: 'cust-2',
      amount: 149.99,
      items: ['widget-2'],
      email: 'customer2@example.com',
    });

    // Both should complete successfully
    expect(result1.status).toBe('completed');
    expect(result1.orderId).toBe('order-1');
    expect(result2.status).toBe('completed');
    expect(result2.orderId).toBe('order-2');

    // Each order charges the card once, so two orders mean two charges.
    const chargeMock = testEnv.getMockTask('chargeCard');
    expect(chargeMock.callCount).toBe(2);
  });

  it('should allow inspection of mock call history', async () => {
    // ARRANGE
    testEnv.mockTask('chargeCard').returns({
      chargeId: 'ch_123',
      amount: 99.99,
      success: true,
    });

    testEnv.mockTask('reserveInventory').returns({
      reservationId: 'res_123',
      items: ['widget'],
      reserved: true,
    });

    testEnv.mockTask('sendConfirmationEmail').returns({
      messageId: 'msg_123',
      sent: true,
    });

    // ACT
    await testEnv.executeWorkflow(orderWorkflow, {
      orderId: 'order-inspect',
      customerId: 'cust-123',
      amount: 99.99,
      items: ['widget'],
      email: 'test@example.com',
    });

    // ASSERT: Inspect mock details
    const chargeMock = testEnv.getMockTask('chargeCard');

    expect(chargeMock.wasCalled).toBe(true);
    expect(chargeMock.callCount).toBe(1);
    expect(chargeMock.calls).toHaveLength(1);

    // Inspect first call
    const firstCall = chargeMock.calls[0]!;
    expect(firstCall.input).toEqual({
      amount: 99.99,
      cardToken: 'tok_test',
    });
    expect(firstCall.result).toEqual({
      chargeId: 'ch_123',
      amount: 99.99,
      success: true,
    });
  });
});

// ============================================================================
// Additional Examples: Testing Best Practices
// ============================================================================

describe('Testing Best Practices', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('uses descriptive names for better readability', async () => {
    // Descriptive names make the test read as a specification.
    const premiumCustomerOrder = {
      orderId: 'premium-order-001',
      customerId: 'premium-cust-789',
      amount: 999.99,
      items: ['premium-widget', 'premium-service'],
      email: 'premium@example.com',
    };

    const successfulChargeResponse = {
      chargeId: 'ch_premium_123',
      amount: 999.99,
      success: true,
    };

    testEnv.mockTask('chargeCard').returns(successfulChargeResponse);
    testEnv.mockTask('reserveInventory').returns({
      reservationId: 'res_premium_456',
      items: ['premium-widget', 'premium-service'],
      reserved: true,
    });
    testEnv.mockTask('sendConfirmationEmail').returns({
      messageId: 'msg_premium_789',
      sent: true,
    });

    const result = await testEnv.executeWorkflow(
      orderWorkflow,
      premiumCustomerOrder
    );

    expect(result.status).toBe('completed');
  });

  // ==========================================================================
  // Example: Extracting Common Setup
  // ==========================================================================

  describe('with standard mocks', () => {
    beforeEach(() => {
      // Setup common mocks that most tests need
      testEnv.mockTask('chargeCard').returns({
        chargeId: 'ch_123',
        amount: 99.99,
        success: true,
      });

      testEnv.mockTask('reserveInventory').returns({
        reservationId: 'res_123',
        items: ['widget'],
        reserved: true,
      });

      testEnv.mockTask('sendConfirmationEmail').returns({
        messageId: 'msg_123',
        sent: true,
      });
    });

    it('reduces boilerplate in tests', async () => {
      // The mocks come from the beforeEach above.
      const result = await testEnv.executeWorkflow(orderWorkflow, {
        orderId: 'order-simple',
        customerId: 'cust-123',
        amount: 99.99,
        items: ['widget'],
        email: 'test@example.com',
      });

      expect(result.status).toBe('completed');
    });
  });
});
