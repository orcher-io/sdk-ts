/**
 * Time Control Testing Example
 *
 * This example demonstrates how to control time in workflow tests:
 * - Setting initial time
 * - Advancing time manually
 * - Testing timers and delays
 * - Testing time-based conditions
 * - Testing timeouts
 *
 * @example Run this test
 * ```bash
 * npm test -- time-control.test.ts
 * ```
 */

import { TestWorkflowEnvironment } from '../../testing';
import { Tasks, Task, createTaskRefs } from '../../di';
import { Duration } from '../../workflow';
import type { TaskContext } from '../../task';
import type { WorkflowContext } from '../../workflow';

// ============================================================================
// Test Tasks and Workflows
// ============================================================================

@Tasks()
class OrderTimeTasks {
  @Task()
  async sendReminder(_ctx: TaskContext, _input: { userId: string; message: string }) {
    return { sent: true, messageId: `msg_${Date.now()}` };
  }

  @Task()
  async checkStatus(_ctx: TaskContext, input: { orderId: string }) {
    return { status: 'pending', orderId: input.orderId };
  }

  @Task()
  async cancelOrder(_ctx: TaskContext, input: { orderId: string; reason: string }) {
    return { cancelled: true, orderId: input.orderId };
  }

  @Task()
  async processOrder(_ctx: TaskContext, input: { orderId: string }) {
    return { processed: true, orderId: input.orderId };
  }
}

const orderTimeTasks = createTaskRefs(OrderTimeTasks);

/**
 * Polls for approval once a second and cancels the order when the timeout passes.
 *
 * Workflow code reads time from `ctx.time` and waits with `ctx.sleep`, never
 * `Date.now()` or a busy loop: those are what keep a workflow deterministic on
 * replay, and they are also what the test clock controls.
 */
async function approvalWorkflow(
  ctx: WorkflowContext,
  input: {
    orderId: string;
    timeoutMs: number;
    userId: string;
  }
) {
  const deadline = ctx.time.now().getTime() + input.timeoutMs;

  while (ctx.time.now().getTime() < deadline) {
    const status = await ctx.executeTask(orderTimeTasks.checkStatus, { orderId: input.orderId });

    if (status.status === 'approved') {
      await ctx.executeTask(orderTimeTasks.processOrder, { orderId: input.orderId });
      return { success: true, timedOut: false };
    }

    // Check every second
    await ctx.sleep(Duration.fromSeconds(1));
  }

  // Timeout reached
  await ctx.executeTask(orderTimeTasks.cancelOrder, {
    orderId: input.orderId,
    reason: 'Approval timeout',
  });

  return { success: false, timedOut: true };
}

/**
 * Sends `maxReminders` reminders, sleeping `reminderIntervalMs` before each one.
 */
async function reminderWorkflow(
  ctx: WorkflowContext,
  input: {
    userId: string;
    reminderIntervalMs: number;
    maxReminders: number;
  }
) {
  const reminders: number[] = [];

  for (let i = 0; i < input.maxReminders; i++) {
    // Wait until next reminder time
    await ctx.sleep(Duration.fromMilliseconds(input.reminderIntervalMs));

    await ctx.executeTask(orderTimeTasks.sendReminder, {
      userId: input.userId,
      message: `Reminder ${i + 1} of ${input.maxReminders}`,
    });

    reminders.push(ctx.time.now().getTime());
  }

  return {
    remindersSent: reminders.length,
    timestamps: reminders,
  };
}

/**
 * Processes an order immediately during business hours, or schedules it for the next
 * opening otherwise. Business hours are 9 AM - 5 PM, read in UTC so the outcome
 * does not depend on the machine's time zone.
 */
async function businessHoursWorkflow(
  ctx: WorkflowContext,
  input: {
    orderId: string;
    requestTime: Date;
  }
) {
  const hour = input.requestTime.getUTCHours();
  const isBusinessHours = hour >= 9 && hour < 17; // 9 AM - 5 PM

  if (isBusinessHours) {
    // Process immediately during business hours
    await ctx.executeTask(orderTimeTasks.processOrder, { orderId: input.orderId });
    return { processedImmediately: true, scheduledFor: null };
  }

  // Schedule for the next opening at 9 AM: later today when the request comes
  // in before opening, tomorrow when it comes in after closing.
  const nextOpening = new Date(input.requestTime);
  if (hour >= 17) {
    nextOpening.setUTCDate(nextOpening.getUTCDate() + 1);
  }
  nextOpening.setUTCHours(9, 0, 0, 0);

  return {
    processedImmediately: false,
    scheduledFor: nextOpening.toISOString(),
  };
}

// ============================================================================
// Basic Time Control
// ============================================================================

describe('Basic Time Control', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    // Start with a known time
    testEnv = await TestWorkflowEnvironment.create({
      initialTime: new Date('2025-01-15T10:00:00Z'),
    });
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should start with specified initial time', async () => {
    const currentTime = testEnv.getCurrentTime();
    expect(currentTime.toISOString()).toBe('2025-01-15T10:00:00.000Z');
  });

  it('should advance time by duration', async () => {
    const startTime = testEnv.getCurrentTime();

    // Advance 1 hour (3,600,000 ms)
    await testEnv.advanceTime(3600000);

    const endTime = testEnv.getCurrentTime();
    expect(endTime.getTime() - startTime.getTime()).toBe(3600000);
    expect(endTime.toISOString()).toBe('2025-01-15T11:00:00.000Z');
  });

  it('should advance to specific time', async () => {
    await testEnv.advanceTimeTo(new Date('2025-01-15T15:30:00Z'));

    const currentTime = testEnv.getCurrentTime();
    expect(currentTime.toISOString()).toBe('2025-01-15T15:30:00.000Z');
  });

  it('should advance time multiple times', async () => {
    // Start: 10:00 AM
    expect(testEnv.getCurrentTime().toISOString()).toBe(
      '2025-01-15T10:00:00.000Z'
    );

    // Advance 30 minutes
    await testEnv.advanceTime(1800000);
    expect(testEnv.getCurrentTime().toISOString()).toBe(
      '2025-01-15T10:30:00.000Z'
    );

    // Advance another 30 minutes
    await testEnv.advanceTime(1800000);
    expect(testEnv.getCurrentTime().toISOString()).toBe(
      '2025-01-15T11:00:00.000Z'
    );

    // Jump to 3 PM
    await testEnv.advanceTimeTo(new Date('2025-01-15T15:00:00Z'));
    expect(testEnv.getCurrentTime().toISOString()).toBe(
      '2025-01-15T15:00:00.000Z'
    );
  });
});

// ============================================================================
// Testing Timeouts
// ============================================================================

describe('Timeout Testing', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create({
      initialTime: new Date('2025-01-15T10:00:00Z'),
    });
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should timeout when approval not received', async () => {
    // Mock status check to always return pending
    testEnv.mockTask('checkStatus').returns({
      status: 'pending',
      orderId: 'order-123',
    });

    testEnv.mockTask('cancelOrder').returns({
      cancelled: true,
      orderId: 'order-123',
    });

    // Start workflow with 5-minute timeout
    const promise = testEnv.executeWorkflow(approvalWorkflow, {
      orderId: 'order-123',
      timeoutMs: 300000, // 5 minutes
      userId: 'user-123',
    });

    // Advance time past timeout
    await testEnv.advanceTime(300001); // Just over 5 minutes

    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.success).toBe(false);

    // Verify the order was canceled
    testEnv.assertTaskCalled('cancelOrder', 1);
  });

  it('should complete before timeout when approved', async () => {
    // Mock status to return approved after 2 minutes
    let calls = 0;
    testEnv.mockTask('checkStatus').withFn(async () => {
      calls++;
      // Approve after a few checks (simulate approval received after 2 min)
      const elapsed = testEnv.getCurrentTime().getTime() -
        new Date('2025-01-15T10:00:00Z').getTime();

      if (elapsed >= 120000) { // 2 minutes
        return { status: 'approved', orderId: 'order-456' };
      }
      return { status: 'pending', orderId: 'order-456' };
    });

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-456',
    });

    testEnv.mockTask('cancelOrder').returns({
      cancelled: true,
      orderId: 'order-456',
    });

    const promise = testEnv.executeWorkflow(approvalWorkflow, {
      orderId: 'order-456',
      timeoutMs: 300000, // 5 minutes
      userId: 'user-456',
    });

    // Advance time to 2 minutes (when approval is granted)
    await testEnv.advanceTime(120000);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);

    // Verify the order was processed, not canceled
    testEnv.assertTaskCalled('processOrder', 1);
    testEnv.assertTaskCalled('cancelOrder', 0);
  });
});

// ============================================================================
// Testing Scheduled Tasks
// ============================================================================

describe('Scheduled Task Testing', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create({
      initialTime: new Date('2025-01-15T10:00:00Z'),
    });
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should send reminders at scheduled intervals', async () => {
    testEnv.mockTask('sendReminder').returns({
      sent: true,
      messageId: 'msg_123',
    });

    // Send 3 reminders, 1 minute apart
    const promise = testEnv.executeWorkflow(reminderWorkflow, {
      userId: 'user-123',
      reminderIntervalMs: 60000, // 1 minute
      maxReminders: 3,
    });

    // Advance time to trigger all reminders
    await testEnv.advanceTime(180000); // 3 minutes

    const result = await promise;

    expect(result.remindersSent).toBe(3);

    // Verify reminders were sent
    const reminderMock = testEnv.getMockTask('sendReminder');
    expect(reminderMock.callCount).toBe(3);

    // Verify reminder messages
    expect(reminderMock.calls[0]!.input.message).toBe('Reminder 1 of 3');
    expect(reminderMock.calls[1]!.input.message).toBe('Reminder 2 of 3');
    expect(reminderMock.calls[2]!.input.message).toBe('Reminder 3 of 3');
  });

  it('should space reminders correctly', async () => {
    const reminderTimes: number[] = [];

    testEnv.mockTask('sendReminder').withFn(async () => {
      reminderTimes.push(testEnv.getCurrentTime().getTime());
      return { sent: true, messageId: 'msg_123' };
    });

    const promise = testEnv.executeWorkflow(reminderWorkflow, {
      userId: 'user-123',
      reminderIntervalMs: 120000, // 2 minutes
      maxReminders: 3,
    });

    // Advance time gradually
    await testEnv.advanceTime(120000); // 2 min - first reminder
    await testEnv.advanceTime(120000); // 4 min - second reminder
    await testEnv.advanceTime(120000); // 6 min - third reminder

    await promise;

    // Verify spacing between reminders
    expect(reminderTimes[1]! - reminderTimes[0]!).toBe(120000); // 2 minutes
    expect(reminderTimes[2]! - reminderTimes[1]!).toBe(120000); // 2 minutes
  });
});

// ============================================================================
// Time-Based Business Logic
// ============================================================================

describe('Time-Based Business Logic', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeEach(async () => {
    testEnv = await TestWorkflowEnvironment.create();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should process immediately during business hours', async () => {
    // Set time to 2 PM (business hours)
    const businessTime = new Date('2025-01-15T14:00:00Z');

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-123',
    });

    const result = await testEnv.executeWorkflow(businessHoursWorkflow, {
      orderId: 'order-123',
      requestTime: businessTime,
    });

    expect(result.processedImmediately).toBe(true);
    expect(result.scheduledFor).toBeNull();

    // Verify order was processed
    testEnv.assertTaskCalled('processOrder', 1);
  });

  it('should schedule for next day if after hours', async () => {
    // Set time to 8 PM (after business hours)
    const afterHours = new Date('2025-01-15T20:00:00Z');

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-456',
    });

    const result = await testEnv.executeWorkflow(businessHoursWorkflow, {
      orderId: 'order-456',
      requestTime: afterHours,
    });

    expect(result.processedImmediately).toBe(false);
    expect(result.scheduledFor).toBe('2025-01-16T09:00:00.000Z');

    // Verify order was NOT processed immediately
    testEnv.assertTaskCalled('processOrder', 0);
  });

  it('should handle early morning requests', async () => {
    // Set time to 7 AM (before business hours)
    const earlyMorning = new Date('2025-01-15T07:00:00Z');

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-789',
    });

    const result = await testEnv.executeWorkflow(businessHoursWorkflow, {
      orderId: 'order-789',
      requestTime: earlyMorning,
    });

    expect(result.processedImmediately).toBe(false);
    // Should schedule for same day at 9 AM
    expect(result.scheduledFor).toBe('2025-01-15T09:00:00.000Z');
  });

  it('should handle edge case at 9 AM exactly', async () => {
    // Exactly 9 AM - start of business hours
    const startTime = new Date('2025-01-15T09:00:00Z');

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-edge',
    });

    const result = await testEnv.executeWorkflow(businessHoursWorkflow, {
      orderId: 'order-edge',
      requestTime: startTime,
    });

    expect(result.processedImmediately).toBe(true);
    testEnv.assertTaskCalled('processOrder', 1);
  });

  it('should handle edge case at 5 PM exactly', async () => {
    // Exactly 5 PM - end of business hours
    const endTime = new Date('2025-01-15T17:00:00Z');

    testEnv.mockTask('processOrder').returns({
      processed: true,
      orderId: 'order-end',
    });

    const result = await testEnv.executeWorkflow(businessHoursWorkflow, {
      orderId: 'order-end',
      requestTime: endTime,
    });

    // 5 PM is NOT business hours (9 AM - 5 PM exclusive)
    expect(result.processedImmediately).toBe(false);
    expect(result.scheduledFor).toBe('2025-01-16T09:00:00.000Z');
  });
});

// ============================================================================
// Deterministic Time Testing
// ============================================================================

describe('Deterministic Time', () => {
  it('should produce consistent results across test runs', async () => {
    // Run the same workflow twice with same initial time
    const results: any[] = [];

    for (let run = 0; run < 2; run++) {
      const testEnv = await TestWorkflowEnvironment.create({
        initialTime: new Date('2025-01-01T00:00:00Z'),
      });

      testEnv.mockTask('sendReminder').withFn(async () => {
        return {
          sent: true,
          messageId: 'msg',
          timestamp: testEnv.getCurrentTime().getTime(),
        };
      });

      const promise = testEnv.executeWorkflow(reminderWorkflow, {
        userId: 'user-test',
        reminderIntervalMs: 30000, // 30 seconds
        maxReminders: 2,
      });

      await testEnv.advanceTime(60000); // 1 minute

      const result = await promise;
      results.push(result);

      await testEnv.cleanup();
    }

    // Both runs should produce identical results
    expect(results[0]).toEqual(results[1]);
  });

  it('should maintain time consistency within workflow', async () => {
    const testEnv = await TestWorkflowEnvironment.create({
      initialTime: new Date('2025-01-01T12:00:00Z'),
    });

    const timestamps: number[] = [];

    testEnv.mockTask('checkStatus').withFn(async () => {
      timestamps.push(testEnv.getCurrentTime().getTime());
      return { status: 'pending', orderId: 'order-1' };
    });

    testEnv.mockTask('cancelOrder').returns({
      cancelled: true,
      orderId: 'order-1',
    });

    const promise = testEnv.executeWorkflow(approvalWorkflow, {
      orderId: 'order-1',
      timeoutMs: 10000,
      userId: 'user-1',
    });

    await testEnv.advanceTime(10001);
    await promise;

    // All timestamps should be monotonically increasing
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }

    await testEnv.cleanup();
  });
});
