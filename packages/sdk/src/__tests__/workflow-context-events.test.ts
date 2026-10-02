/**
 * Tests for WorkflowContext Event Methods
 *
 * This file tests the event handling methods in WorkflowContext including:
 * - waitForEvent() - waiting for events without timeout
 * - waitForEventWithTimeout() - waiting with timeout support
 * - bufferEvent() - internal event buffering
 * - Command generation for deterministic replay
 * - Integration with EventManager
 */

import { WorkflowContext, WorkflowExecution, WorkflowCommandType } from '../workflow/context';
import { Duration } from '../workflow/types';
import { EventHelpers } from '../workflow/events';

describe('WorkflowContext Event Methods', () => {
  let ctx: WorkflowContext;
  let execution: WorkflowExecution;

  beforeEach(() => {
    execution = {
      workflowId: 'test-workflow-123',
      runId: 'test-run-456',
      workflowType: 'TestWorkflow',
      attempt: 1,
      namespace: 'default',
      taskQueue: 'test-queue',
    };

    ctx = new WorkflowContext(execution, false, '1.0.0', Date.now());
  });

  describe('waitForEvent', () => {
    it('should validate event name', async () => {
      // Empty event name should throw
      await expect(ctx.waitForEvent('')).rejects.toThrow('Event name must be a non-empty string');
    });

    it('should reject invalid event names', async () => {
      // Event name with spaces
      await expect(ctx.waitForEvent('invalid name')).rejects.toThrow(
        'Event name must contain only alphanumeric characters'
      );

      // Event name with special characters
      await expect(ctx.waitForEvent('event@name')).rejects.toThrow();
    });

    it('should accept valid event names', async () => {
      // Valid names pass validation and then suspend execution, so the
      // suspension error is caught and must not be a validation error.
      const validNames = ['approve', 'order_received', 'payment-done', 'Event123'];

      for (const name of validNames) {
        try {
          await ctx.waitForEvent(name);
        } catch (err: any) {
          expect(err.message).not.toContain('Event name must');
        }
      }
    });

    it('should generate WAIT_FOR_EVENT command', async () => {
      try {
        await ctx.waitForEvent('approve');
      } catch {
        // Expected to throw (suspension)
      }

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0].type).toBe(WorkflowCommandType.WAIT_FOR_EVENT);
      expect((commands[0] as any).eventName).toBe('approve');
      // The native layer requires a step id on this command; derived from the
      // sequence so it is stable across replays.
      expect((commands[0] as any).stepId).toMatch(/^event_approve_\d+$/);
    });

    it('takes no number from the step counter', async () => {
      try {
        await ctx.waitForEvent('event1');
      } catch {
        // Expected
      }

      try {
        await ctx.waitForEvent('event2');
      } catch {
        // Expected
      }

      // A wait is not an engine step: parked or not, it leaves the counter
      // where it was, so the steps around it keep their ids once the event is
      // in the journal.
      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(2);
      expect(commands[0].sequence).toBe(0);
      expect(commands[1].sequence).toBe(0);
      expect((ctx as any).state.sequence).toBe(0);
    });
  });

  describe('waitForEventWithTimeout', () => {
    it('should validate event name', async () => {
      await expect(ctx.waitForEventWithTimeout('', 1000)).rejects.toThrow(
        'Event name must be a non-empty string'
      );
    });

    it('should validate timeout is positive', async () => {
      await expect(ctx.waitForEventWithTimeout('approve', 0)).rejects.toThrow(
        'Timeout must be greater than 0'
      );

      await expect(ctx.waitForEventWithTimeout('approve', -100)).rejects.toThrow(
        'Timeout must be greater than 0'
      );
    });

    it('should accept valid timeout values', async () => {
      const validTimeouts = [1, 100, 1000, 60000, 86400000]; // 1ms to 24 hours

      for (const timeout of validTimeouts) {
        try {
          await ctx.waitForEventWithTimeout('approve', timeout);
        } catch (err: any) {
          // Should fail with suspension, not validation error
          expect(err.message).not.toContain('Timeout must be');
        }
      }
    });

    // The timeout is a durable timer raced against the event: parking emits
    // the wait (which the engine ignores) and a StartTimer for the deadline
    // (which the engine fires).
    it('parks on the event and starts a deadline timer', async () => {
      await expect(
        ctx.waitForEventWithTimeout('approve', Duration.fromSeconds(5))
      ).rejects.toThrow();

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(2);
      expect(commands[0].type).toBe(WorkflowCommandType.WAIT_FOR_EVENT);
      expect((commands[0] as any).eventName).toBe('approve');
      expect((commands[0] as any).timeoutMs).toBe(5000);
      expect((commands[0] as any).stepId).toMatch(/^event_approve_\d+$/);
      expect(commands[1].type).toBe(WorkflowCommandType.START_TIMER);
      expect((commands[1] as any).timerId).toBe('event_timeout_approve_1');
      expect((commands[1] as any).durationMs).toBe(5000);
    });

    it('returns null once the deadline timer has fired', async () => {
      // The fired-timer marker the worker injects on replay.
      (ctx as any).state.pendingTaskResults.set('timer:event_timeout_approve_1', true);

      await expect(
        ctx.waitForEventWithTimeout('approve', Duration.fromSeconds(5))
      ).resolves.toBeNull();
      expect(ctx.takeCommands()).toHaveLength(0);
    });

    it('returns the event when it arrived, even if the timer fired too', async () => {
      // Both in the journal: the event wins, which is what a caller expects
      // from "wait for this, give up after that".
      ctx.bufferEvent('approve', { approved: true });
      (ctx as any).state.pendingTaskResults.set('timer:event_timeout_approve_1', true);

      await expect(
        ctx.waitForEventWithTimeout('approve', Duration.fromSeconds(5))
      ).resolves.toEqual({ approved: true });
      expect(ctx.takeCommands()).toHaveLength(0);
    });

    it('does not consume a step sequence when the event is already buffered', async () => {
      // Step ids after the wait must be identical whether the event was
      // there or not, or a replay would re-schedule work that already ran.
      ctx.bufferEvent('approve', { approved: true });
      const before = (ctx as any).state.sequence;
      await ctx.waitForEventWithTimeout('approve', Duration.fromSeconds(5));
      expect((ctx as any).state.sequence).toBe(before);
    });

    it('numbers deadline timers per event name', async () => {
      // A loop of waits on one name gets one timer per wait, and a fired
      // timer only times out the wait it belongs to.
      ctx.bufferEvent('status', { round: 1 });
      await ctx.waitForEventWithTimeout('status', Duration.fromSeconds(1));
      await expect(
        ctx.waitForEventWithTimeout('status', Duration.fromSeconds(1))
      ).rejects.toThrow();
      await expect(ctx.waitForEventWithTimeout('other', Duration.fromSeconds(2))).rejects.toThrow();

      const timers = ctx
        .takeCommands()
        .filter((c) => c.type === WorkflowCommandType.START_TIMER)
        .map((c) => (c as any).timerId);
      expect(timers).toEqual(['event_timeout_status_2', 'event_timeout_other_1']);
    });

    it('keeps a timed-out wait timed out when the event arrives later', async () => {
      // Journal: wait 1 times out (timer fired at position 3), then the event
      // lands (position 7). An earlier activation already took the timeout
      // branch; the replay must too, and the event belongs to the next wait.
      (ctx as any).state.pendingTaskResults.set('timer:event_timeout_status_1', { firedAt: 3 });
      ctx.bufferEvent('status', { late: true }, 7);

      await expect(
        ctx.waitForEventWithTimeout('status', Duration.fromSeconds(1))
      ).resolves.toBeNull();
      await expect(ctx.waitForEventWithTimeout('status', Duration.fromSeconds(1))).resolves.toEqual(
        { late: true }
      );
    });

    it('takes the event when it arrived before the deadline fired', async () => {
      // Journal: the event at position 2, the (never canceled) timer at 5.
      (ctx as any).state.pendingTaskResults.set('timer:event_timeout_status_1', { firedAt: 5 });
      ctx.bufferEvent('status', { early: true }, 2);

      await expect(ctx.waitForEventWithTimeout('status', Duration.fromSeconds(1))).resolves.toEqual(
        { early: true }
      );
    });
  });

  describe('bufferEvent', () => {
    it('should buffer event for later retrieval', () => {
      ctx.bufferEvent('approve', { approved: true });

      // bufferEvent is internal and has no observable result here, so the test
      // only checks that buffering again does not throw.
      expect(() => ctx.bufferEvent('approve', { approved: true })).not.toThrow();
    });

    it('should handle multiple events', () => {
      ctx.bufferEvent('event1', { data: 1 });
      ctx.bufferEvent('event2', { data: 2 });
      ctx.bufferEvent('event3', { data: 3 });

      // Reaching this line means buffering did not throw.
      expect(true).toBe(true);
    });

    it('should handle complex payloads', () => {
      const complexPayload = {
        nested: {
          data: {
            values: [1, 2, 3],
            metadata: { key: 'value' },
          },
        },
        timestamp: new Date().toISOString(),
      };

      expect(() => ctx.bufferEvent('complex', complexPayload)).not.toThrow();
    });
  });

  describe('command generation', () => {
    it('should generate deterministic commands', async () => {
      // Generate commands in sequence
      try {
        await ctx.waitForEvent('event1');
      } catch {
        // Expected
      }

      try {
        await ctx.waitForEventWithTimeout('event2', 1000);
      } catch {
        // Expected
      }

      // The wait with a timeout also emits its deadline timer.
      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(3);

      // Waits and their deadline timers take no number from the step counter;
      // the sequence only labels them.
      expect(commands.map((c) => c.sequence)).toEqual([0, 0, 0]);

      // Command types should be correct
      expect(commands.map((c) => c.type)).toEqual([
        WorkflowCommandType.WAIT_FOR_EVENT,
        WorkflowCommandType.WAIT_FOR_EVENT,
        WorkflowCommandType.START_TIMER,
      ]);
    });

    it('should include event names in commands', async () => {
      try {
        await ctx.waitForEvent('order_approved');
      } catch {
        // Expected
      }

      try {
        await ctx.waitForEvent('payment_received');
      } catch {
        // Expected
      }

      const commands = ctx.takeCommands();
      expect((commands[0] as any).eventName).toBe('order_approved');
      expect((commands[1] as any).eventName).toBe('payment_received');
    });

    it('should clear commands after taking', async () => {
      try {
        await ctx.waitForEvent('test');
      } catch {
        // Expected
      }

      const commands1 = ctx.takeCommands();
      expect(commands1).toHaveLength(1);

      const commands2 = ctx.takeCommands();
      expect(commands2).toHaveLength(0);
    });
  });

  describe('integration scenarios', () => {
    it('should handle approval workflow pattern', async () => {
      // Simulate approval workflow
      try {
        // Wait for approval with 24-hour timeout
        await ctx.waitForEventWithTimeout('approve', 24 * 60 * 60 * 1000);
      } catch {
        // Expected suspension
      }

      // The wait, and the durable timer that enforces its 24-hour deadline.
      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(2);
      expect((commands[0] as any).eventName).toBe('approve');
      expect((commands[0] as any).timeoutMs).toBe(86400000); // 24 hours
      expect(commands[1].type).toBe(WorkflowCommandType.START_TIMER);
      expect((commands[1] as any).durationMs).toBe(86400000);
    });

    it('should handle multi-step approval', async () => {
      // Department approval
      try {
        await ctx.waitForEventWithTimeout('dept_approve', 48 * 60 * 60 * 1000);
      } catch {
        // Expected
      }

      // Executive approval
      try {
        await ctx.waitForEventWithTimeout('exec_approve', 72 * 60 * 60 * 1000);
      } catch {
        // Expected
      }

      const waits = ctx.takeCommands().filter((c) => c.type === WorkflowCommandType.WAIT_FOR_EVENT);
      expect(waits).toHaveLength(2);
      expect((waits[0] as any).eventName).toBe('dept_approve');
      expect((waits[1] as any).eventName).toBe('exec_approve');
    });

    it('should handle event buffering before waiting', async () => {
      // Buffer events first
      ctx.bufferEvent('event1', { data: 1 });
      ctx.bufferEvent('event2', { data: 2 });

      // A buffered event is returned at once: no wait is issued.
      await expect(ctx.waitForEvent('event1')).resolves.toEqual({ data: 1 });
      expect(ctx.takeCommands()).toHaveLength(0);
    });

    it('should combine events with other workflow operations', async () => {
      // Wait for order event
      try {
        await ctx.waitForEvent('order_received');
      } catch {
        // Expected
      }

      // Wait for payment with timeout
      try {
        await ctx.waitForEventWithTimeout('payment_confirmed', 300000); // 5 min
      } catch {
        // Expected
      }

      // Get all commands: two waits, and the second one's deadline timer.
      const commands = ctx.takeCommands();
      expect(commands.map((c) => c.type)).toEqual([
        WorkflowCommandType.WAIT_FOR_EVENT,
        WorkflowCommandType.WAIT_FOR_EVENT,
        WorkflowCommandType.START_TIMER,
      ]);
    });
  });

  describe('type safety', () => {
    it('should support generic payload types', async () => {
      interface ApprovalData {
        approved: boolean;
        approver: string;
        reason: string;
      }

      // Type-safe event waiting
      try {
        const approval = await ctx.waitForEvent<ApprovalData>('approve');
        // TypeScript should know approval is ApprovalData
        if (approval) {
          expect(typeof approval.approved).toBe('boolean');
        }
      } catch {
        // Expected suspension
      }
    });

    it('should support timeout with generic types', async () => {
      interface OrderData {
        orderId: string;
        amount: number;
        items: string[];
      }

      try {
        const order = await ctx.waitForEventWithTimeout<OrderData>('order', 5000);
        // TypeScript should know order is OrderData | null
        if (order) {
          expect(typeof order.orderId).toBe('string');
        }
      } catch {
        // Expected
      }
    });
  });

  describe('error handling', () => {
    it('should provide clear error for invalid event name', async () => {
      try {
        await ctx.waitForEvent('invalid name with spaces');
        fail('Should have thrown validation error');
      } catch (err: any) {
        expect(err.message).toContain('Event name must contain only alphanumeric');
      }
    });

    it('should provide clear error for invalid timeout', async () => {
      try {
        await ctx.waitForEventWithTimeout('approve', -1);
        fail('Should have thrown validation error');
      } catch (err: any) {
        expect(err.message).toContain('Timeout must be greater than 0');
      }
    });

    it('should validate event name before timeout', async () => {
      // Event name validation should happen first
      try {
        await ctx.waitForEventWithTimeout('', 1000);
        fail('Should have thrown validation error');
      } catch (err: any) {
        expect(err.message).toContain('Event name');
        expect(err.message).not.toContain('Timeout');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very long event names (max 255)', async () => {
      const longName = 'a'.repeat(255);

      try {
        await ctx.waitForEvent(longName);
      } catch (err: any) {
        // Should not fail validation
        expect(err.message).not.toContain('Event name must not exceed');
      }
    });

    it('should reject event names over 255 characters', async () => {
      const tooLongName = 'a'.repeat(256);

      await expect(ctx.waitForEvent(tooLongName)).rejects.toThrow(
        'Event name must not exceed 255 characters'
      );
    });

    it('should handle very short timeouts', async () => {
      try {
        await ctx.waitForEventWithTimeout('event', 1); // 1ms
      } catch {
        // Expected
      }

      const commands = ctx.takeCommands();
      expect((commands[0] as any).timeoutMs).toBe(1);
    });

    it('should handle very long timeouts', async () => {
      const oneWeek = 7 * 24 * 60 * 60 * 1000; // 1 week in ms

      try {
        await ctx.waitForEventWithTimeout('event', oneWeek);
      } catch {
        // Expected
      }

      const commands = ctx.takeCommands();
      expect((commands[0] as any).timeoutMs).toBe(oneWeek);
    });

    it('should handle special characters in allowed set', async () => {
      const validNames = ['event_name', 'event-name', 'Event123', 'EVENT_NAME_123'];

      for (const name of validNames) {
        try {
          await ctx.waitForEvent(name);
        } catch (err: any) {
          expect(err.message).not.toContain('Event name must contain only');
        }
      }
    });

    it('should handle rapid consecutive event waits', async () => {
      for (let i = 0; i < 100; i++) {
        try {
          await ctx.waitForEvent(`event${i}`);
        } catch {
          // Expected
        }
      }

      const commands = ctx.takeCommands();
      expect(commands).toHaveLength(100);
    });
  });

  describe('metadata and context', () => {
    it('should maintain workflow metadata during event operations', async () => {
      try {
        await ctx.waitForEvent('test');
      } catch {
        // Expected
      }

      // Metadata should still be accessible
      expect(ctx.workflowId()).toBe('test-workflow-123');
      expect(ctx.runId()).toBe('test-run-456');
      expect(ctx.workflowType()).toBe('TestWorkflow');
    });

    it('should maintain deterministic helpers during event operations', async () => {
      try {
        await ctx.waitForEvent('test');
      } catch {
        // Expected
      }

      // Deterministic helpers should still work
      expect(ctx.random).toBeDefined();
      expect(ctx.time).toBeDefined();
    });

    it('should maintain replay state during event operations', async () => {
      const replayCtx = new WorkflowContext(execution, true);

      try {
        await replayCtx.waitForEvent('test');
      } catch {
        // Expected
      }

      expect(replayCtx.isReplaying()).toBe(true);
    });
  });
});
