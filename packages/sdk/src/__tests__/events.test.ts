/**
 * Tests for Event Infrastructure
 *
 * This file tests the event handling infrastructure including:
 * - EventBuffer (FIFO event storage)
 * - EventManager (event handling and waiting)
 * - EventHelpers (validation and serialization)
 * - Timeout handling
 * - Event delivery to waiting handlers
 */

import {
  EventBuffer,
  EventManager,
  EventHelpers,
  EventData,
} from '../workflow/events';

describe('EventBuffer', () => {
  let buffer: EventBuffer;

  beforeEach(() => {
    buffer = new EventBuffer();
  });

  describe('basic operations', () => {
    it('should create empty buffer', () => {
      expect(buffer.totalCount()).toBe(0);
      expect(buffer.getEventNames()).toEqual([]);
    });

    it('should add event to buffer', () => {
      buffer.add('test-event', { data: 'value' });
      expect(buffer.has('test-event')).toBe(true);
      expect(buffer.count('test-event')).toBe(1);
    });

    it('should pop event from buffer', () => {
      buffer.add('test-event', { data: 'value' });
      const event = buffer.pop('test-event');
      expect(event).toEqual({ data: 'value' });
      expect(buffer.has('test-event')).toBe(false);
    });

    it('should return undefined when popping empty buffer', () => {
      const event = buffer.pop('non-existent');
      expect(event).toBeUndefined();
    });

    it('should handle multiple events with same name', () => {
      buffer.add('test-event', { id: 1 });
      buffer.add('test-event', { id: 2 });
      buffer.add('test-event', { id: 3 });

      expect(buffer.count('test-event')).toBe(3);
    });
  });

  describe('FIFO order', () => {
    it('should maintain FIFO order', () => {
      buffer.add('event', { id: 1 });
      buffer.add('event', { id: 2 });
      buffer.add('event', { id: 3 });

      expect(buffer.pop('event')).toEqual({ id: 1 });
      expect(buffer.pop('event')).toEqual({ id: 2 });
      expect(buffer.pop('event')).toEqual({ id: 3 });
      expect(buffer.pop('event')).toBeUndefined();
    });

    it('should handle interleaved add and pop', () => {
      buffer.add('event', { id: 1 });
      expect(buffer.pop('event')).toEqual({ id: 1 });

      buffer.add('event', { id: 2 });
      buffer.add('event', { id: 3 });
      expect(buffer.pop('event')).toEqual({ id: 2 });

      buffer.add('event', { id: 4 });
      expect(buffer.pop('event')).toEqual({ id: 3 });
      expect(buffer.pop('event')).toEqual({ id: 4 });
    });
  });

  describe('multiple event names', () => {
    it('should handle different event names independently', () => {
      buffer.add('event-a', { type: 'a' });
      buffer.add('event-b', { type: 'b' });

      expect(buffer.has('event-a')).toBe(true);
      expect(buffer.has('event-b')).toBe(true);
      expect(buffer.count('event-a')).toBe(1);
      expect(buffer.count('event-b')).toBe(1);
    });

    it('should pop events independently', () => {
      buffer.add('event-a', { type: 'a' });
      buffer.add('event-b', { type: 'b' });

      expect(buffer.pop('event-a')).toEqual({ type: 'a' });
      expect(buffer.has('event-a')).toBe(false);
      expect(buffer.has('event-b')).toBe(true);
    });

    it('should return all event names', () => {
      buffer.add('event-1', {});
      buffer.add('event-2', {});
      buffer.add('event-3', {});

      const names = buffer.getEventNames();
      expect(names).toContain('event-1');
      expect(names).toContain('event-2');
      expect(names).toContain('event-3');
      expect(names).toHaveLength(3);
    });
  });

  describe('peek operations', () => {
    it('should peek without removing', () => {
      buffer.add('event', { id: 1 });
      buffer.add('event', { id: 2 });

      const peeked = buffer.peek('event');
      expect(peeked).toEqual([{ id: 1 }, { id: 2 }]);
      expect(buffer.count('event')).toBe(2); // Still there
    });

    it('should return empty array for non-existent event', () => {
      const peeked = buffer.peek('non-existent');
      expect(peeked).toEqual([]);
    });
  });

  describe('clear operations', () => {
    it('should clear specific event name', () => {
      buffer.add('event-a', { id: 1 });
      buffer.add('event-b', { id: 2 });

      buffer.clear('event-a');

      expect(buffer.has('event-a')).toBe(false);
      expect(buffer.has('event-b')).toBe(true);
    });

    it('should clear all events', () => {
      buffer.add('event-1', {});
      buffer.add('event-2', {});
      buffer.add('event-3', {});

      buffer.clearAll();

      expect(buffer.totalCount()).toBe(0);
      expect(buffer.getEventNames()).toEqual([]);
    });
  });

  describe('count operations', () => {
    it('should count total events', () => {
      buffer.add('event-a', {});
      buffer.add('event-a', {});
      buffer.add('event-b', {});

      expect(buffer.totalCount()).toBe(3);
    });

    it('should count events by name', () => {
      buffer.add('event', {});
      buffer.add('event', {});
      buffer.add('event', {});

      expect(buffer.count('event')).toBe(3);
    });

    it('should return 0 for non-existent event', () => {
      expect(buffer.count('non-existent')).toBe(0);
    });
  });
});

describe('EventManager', () => {
  let manager: EventManager;

  beforeEach(() => {
    manager = new EventManager();
  });

  describe('event buffering', () => {
    it('should buffer event when no handlers waiting', () => {
      manager.bufferEvent('test-event', { data: 'value' });

      const stats = manager.getStats();
      expect(stats.bufferedEvents).toBe(1);
      expect(stats.eventNames).toContain('test-event');
    });

    it('should buffer multiple events', () => {
      manager.bufferEvent('event-1', { id: 1 });
      manager.bufferEvent('event-2', { id: 2 });
      manager.bufferEvent('event-3', { id: 3 });

      const stats = manager.getStats();
      expect(stats.bufferedEvents).toBe(3);
    });
  });

  describe('waitForEvent - already buffered', () => {
    it('should return buffered event immediately', async () => {
      manager.bufferEvent('test-event', { data: 'value' });

      const event = await manager.waitForEvent('test-event');
      expect(event).toEqual({ data: 'value' });
    });

    it('should return events in FIFO order', async () => {
      manager.bufferEvent('event', { id: 1 });
      manager.bufferEvent('event', { id: 2 });

      const event1 = await manager.waitForEvent('event');
      const event2 = await manager.waitForEvent('event');

      expect(event1).toEqual({ id: 1 });
      expect(event2).toEqual({ id: 2 });
    });

    it('should handle different event names', async () => {
      manager.bufferEvent('event-a', { type: 'a' });
      manager.bufferEvent('event-b', { type: 'b' });

      const eventA = await manager.waitForEvent('event-a');
      const eventB = await manager.waitForEvent('event-b');

      expect(eventA).toEqual({ type: 'a' });
      expect(eventB).toEqual({ type: 'b' });
    });
  });

  describe('waitForEvent - future events', () => {
    it('should wait for future event', async () => {
      const eventPromise = manager.waitForEvent('test-event');

      // Send event after a delay
      setTimeout(() => {
        manager.bufferEvent('test-event', { data: 'value' });
      }, 50);

      const event = await eventPromise;
      expect(event).toEqual({ data: 'value' });
    });

    it('should handle multiple waiters', async () => {
      const waiter1 = manager.waitForEvent('event');
      const waiter2 = manager.waitForEvent('event');

      // Send two events
      setTimeout(() => {
        manager.bufferEvent('event', { id: 1 });
        manager.bufferEvent('event', { id: 2 });
      }, 50);

      const [event1, event2] = await Promise.all([waiter1, waiter2]);
      expect(event1).toEqual({ id: 1 });
      expect(event2).toEqual({ id: 2 });
    });

    it('should register waiting handler', () => {
      manager.waitForEvent('test-event');

      const stats = manager.getStats();
      expect(stats.waitingHandlers).toBe(1);
    });
  });

  describe('waitForEventWithTimeout', () => {
    it('should return buffered event immediately', async () => {
      manager.bufferEvent('test-event', { data: 'value' });

      const event = await manager.waitForEventWithTimeout('test-event', 1000);
      expect(event).toEqual({ data: 'value' });
    });

    it('should return null on timeout', async () => {
      const event = await manager.waitForEventWithTimeout('test-event', 100);
      expect(event).toBeNull();
    });

    it('should return event if received before timeout', async () => {
      const eventPromise = manager.waitForEventWithTimeout('test-event', 200);

      // Send event before timeout
      setTimeout(() => {
        manager.bufferEvent('test-event', { data: 'value' });
      }, 50);

      const event = await eventPromise;
      expect(event).toEqual({ data: 'value' });
    });

    it('should timeout if event not received in time', async () => {
      const eventPromise = manager.waitForEventWithTimeout('test-event', 50);

      // Send event after timeout
      setTimeout(() => {
        manager.bufferEvent('test-event', { data: 'value' });
      }, 200);

      const event = await eventPromise;
      expect(event).toBeNull();
    });
  });

  describe('statistics', () => {
    it('should report empty statistics', () => {
      const stats = manager.getStats();
      expect(stats.bufferedEvents).toBe(0);
      expect(stats.waitingHandlers).toBe(0);
      expect(stats.eventNames).toEqual([]);
    });

    it('should report buffered events', () => {
      manager.bufferEvent('event-1', {});
      manager.bufferEvent('event-2', {});

      const stats = manager.getStats();
      expect(stats.bufferedEvents).toBe(2);
      expect(stats.eventNames).toHaveLength(2);
    });

    it('should report waiting handlers', () => {
      manager.waitForEvent('event-1');
      manager.waitForEvent('event-2');

      const stats = manager.getStats();
      expect(stats.waitingHandlers).toBe(2);
    });
  });

  describe('clear operations', () => {
    it('should clear all state', () => {
      manager.bufferEvent('event', {});
      manager.waitForEvent('event');

      manager.clear();

      const stats = manager.getStats();
      expect(stats.bufferedEvents).toBe(0);
      expect(stats.waitingHandlers).toBe(0);
    });
  });

  describe('buffer access', () => {
    it('should provide access to internal buffer', () => {
      const buffer = manager.getBuffer();
      expect(buffer).toBeInstanceOf(EventBuffer);
    });

    it('should allow direct buffer manipulation', () => {
      const buffer = manager.getBuffer();
      buffer.add('test-event', { data: 'value' });

      expect(buffer.has('test-event')).toBe(true);
    });
  });
});

describe('EventHelpers', () => {
  describe('validateEventName', () => {
    it('should accept valid event names', () => {
      expect(() => EventHelpers.validateEventName('approve')).not.toThrow();
      expect(() => EventHelpers.validateEventName('order_approved')).not.toThrow();
      expect(() => EventHelpers.validateEventName('payment-received')).not.toThrow();
      expect(() => EventHelpers.validateEventName('event123')).not.toThrow();
      expect(() => EventHelpers.validateEventName('Event_Name-123')).not.toThrow();
    });

    it('should reject empty event name', () => {
      expect(() => EventHelpers.validateEventName('')).toThrow(
        'Event name must be a non-empty string'
      );
    });

    it('should reject whitespace-only event name', () => {
      expect(() => EventHelpers.validateEventName('   ')).toThrow(
        'Event name must be a non-empty string'
      );
    });

    it('should reject event name exceeding 255 characters', () => {
      const longName = 'a'.repeat(256);
      expect(() => EventHelpers.validateEventName(longName)).toThrow(
        'Event name must not exceed 255 characters'
      );
    });

    it('should accept event name with exactly 255 characters', () => {
      const maxLengthName = 'a'.repeat(255);
      expect(() => EventHelpers.validateEventName(maxLengthName)).not.toThrow();
    });

    it('should reject event names with spaces', () => {
      expect(() => EventHelpers.validateEventName('invalid name')).toThrow(
        'Event name must contain only alphanumeric characters, dots, underscores, and hyphens'
      );
    });

    it('should accept dotted event names', () => {
      expect(() => EventHelpers.validateEventName('provider.status')).not.toThrow();
      expect(() => EventHelpers.validateEventName('order.shipment.delivered')).not.toThrow();
    });

    it('should reject event names with special characters', () => {
      expect(() => EventHelpers.validateEventName('event@name')).toThrow();
      expect(() => EventHelpers.validateEventName('event/name')).toThrow();
      expect(() => EventHelpers.validateEventName('event\\name')).toThrow();
    });
  });

  describe('serialize', () => {
    it('should serialize object to JSON', () => {
      const obj = { key: 'value', number: 123 };
      const serialized = EventHelpers.serialize(obj);
      expect(serialized).toBe('{"key":"value","number":123}');
    });

    it('should serialize array to JSON', () => {
      const arr = [1, 2, 3];
      const serialized = EventHelpers.serialize(arr);
      expect(serialized).toBe('[1,2,3]');
    });

    it('should return string as-is', () => {
      const str = 'already a string';
      const serialized = EventHelpers.serialize(str);
      expect(serialized).toBe('already a string');
    });

    it('should serialize null', () => {
      const serialized = EventHelpers.serialize(null);
      expect(serialized).toBe('null');
    });

    it('should serialize boolean', () => {
      expect(EventHelpers.serialize(true)).toBe('true');
      expect(EventHelpers.serialize(false)).toBe('false');
    });

    it('should serialize nested objects', () => {
      const obj = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };
      const serialized = EventHelpers.serialize(obj);
      expect(serialized).toBe('{"level1":{"level2":{"value":"deep"}}}');
    });
  });

  describe('deserialize', () => {
    it('should deserialize JSON string to object', () => {
      const json = '{"key":"value","number":123}';
      const obj = EventHelpers.deserialize(json);
      expect(obj).toEqual({ key: 'value', number: 123 });
    });

    it('should deserialize JSON array', () => {
      const json = '[1,2,3]';
      const arr = EventHelpers.deserialize(json);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('should return object as-is', () => {
      const obj = { key: 'value' };
      const deserialized = EventHelpers.deserialize(obj);
      expect(deserialized).toBe(obj);
    });

    it('should deserialize null', () => {
      const deserialized = EventHelpers.deserialize('null');
      expect(deserialized).toBeNull();
    });

    it('should deserialize boolean', () => {
      expect(EventHelpers.deserialize('true')).toBe(true);
      expect(EventHelpers.deserialize('false')).toBe(false);
    });

    it('should handle type parameter', () => {
      interface TestType {
        id: number;
        name: string;
      }

      const json = '{"id":123,"name":"test"}';
      const obj = EventHelpers.deserialize<TestType>(json);
      expect(obj.id).toBe(123);
      expect(obj.name).toBe('test');
    });
  });

  describe('createEventData', () => {
    it('should create event data structure', () => {
      const beforeTime = Date.now();
      const eventData = EventHelpers.createEventData('test-event', { key: 'value' });
      const afterTime = Date.now();

      expect(eventData.name).toBe('test-event');
      expect(eventData.payload).toEqual({ key: 'value' });
      expect(eventData.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(eventData.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should include timestamp', () => {
      const eventData = EventHelpers.createEventData('event', {});
      expect(typeof eventData.timestamp).toBe('number');
      expect(eventData.timestamp).toBeGreaterThan(0);
    });

    it('should handle complex payloads', () => {
      const payload = {
        nested: {
          data: [1, 2, 3],
          metadata: { key: 'value' },
        },
      };
      const eventData = EventHelpers.createEventData('event', payload);
      expect(eventData.payload).toEqual(payload);
    });
  });
});

describe('Event Infrastructure Integration', () => {
  it('should handle complete event flow', async () => {
    const manager = new EventManager();

    // Validate event name
    expect(() => EventHelpers.validateEventName('approve')).not.toThrow();

    // Serialize payload
    const payload = { approved: true, approver: 'manager' };
    const serialized = EventHelpers.serialize(payload);
    expect(typeof serialized).toBe('string');

    // Buffer event
    manager.bufferEvent('approve', serialized);

    // Wait for event
    const received = await manager.waitForEvent<string>('approve');
    expect(received).toBe(serialized);

    // Deserialize
    const deserialized = EventHelpers.deserialize(received);
    expect(deserialized).toEqual(payload);
  });

  it('should handle concurrent events', async () => {
    const manager = new EventManager();

    // Start multiple waiters
    const waiters = [
      manager.waitForEvent('event-1'),
      manager.waitForEvent('event-2'),
      manager.waitForEvent('event-3'),
    ];

    // Send events
    setTimeout(() => {
      manager.bufferEvent('event-1', { id: 1 });
      manager.bufferEvent('event-2', { id: 2 });
      manager.bufferEvent('event-3', { id: 3 });
    }, 50);

    const results = await Promise.all(waiters);
    expect(results).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('should handle timeout with fallback', async () => {
    const manager = new EventManager();

    const event = await manager.waitForEventWithTimeout('approve', 100);

    if (event === null) {
      // Timeout - use default
      const defaultPayload = { approved: false, reason: 'timeout' };
      expect(defaultPayload.approved).toBe(false);
    }
  });
});
