/**
 * Tests for task() functional API
 */

import { task } from '../task';
import { GlobalRegistry } from '../../di/registry';
import type { TaskReference } from '../../di/types';

describe('task() functional API', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  it('should return a TaskReference with correct shape', () => {
    const ref = task({
      name: 'my-task',
      execute: async (_ctx, _input: { x: number }) => ({ result: 42 }),
    });

    expect(ref.taskName).toBe('my-task');
    expect(ref.methodName).toBe('execute');
    expect(ref.handlerClass).toBeDefined();
    expect(typeof ref.handlerClass).toBe('function');
  });

  it('should register task in GlobalRegistry', () => {
    task({
      name: 'registered-task',
      execute: async () => 'done',
    });

    expect(registry.hasTask('registered-task')).toBe(true);
    const metadata = registry.getTask('registered-task');
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('registered-task');
    expect(metadata!.methodName).toBe('execute');
  });

  it('should register task handler in GlobalRegistry', () => {
    const ref = task({
      name: 'handler-task',
      execute: async () => 'done',
    });

    expect(registry.hasTaskHandler(ref.handlerClass)).toBe(true);
  });

  it('should store timeout in metadata', () => {
    task({
      name: 'timeout-task',
      timeout: 30_000,
      execute: async () => 'done',
    });

    const metadata = registry.getTask('timeout-task');
    expect(metadata!.timeout).toBe(30_000);
  });

  it('should store retryPolicy in metadata', () => {
    const policy = { maxAttempts: 5, backoffCoefficient: 2 };
    task({
      name: 'retry-task',
      retryPolicy: policy,
      execute: async () => 'done',
    });

    const metadata = registry.getTask('retry-task');
    expect(metadata!.retryPolicy).toEqual(policy);
  });

  it('should create a handler class whose execute method calls the provided function', async () => {
    const executeFn = jest.fn().mockResolvedValue({ result: 42 });

    const ref = task({
      name: 'callable-task',
      execute: executeFn,
    });

    // Call it the way the worker does: new HandlerClass(), then instance[methodName](ctx, input)
    const instance = new ref.handlerClass();
    const result = await instance[ref.methodName]('fake-ctx', { x: 1 });

    expect(executeFn).toHaveBeenCalledWith('fake-ctx', { x: 1 });
    expect(result).toEqual({ result: 42 });
  });

  it('should throw on empty name', () => {
    expect(() =>
      task({ name: '', execute: async () => {} })
    ).toThrow('requires a non-empty name');
  });

  it('should throw on missing execute', () => {
    expect(() =>
      task({ name: 'bad', execute: undefined as any })
    ).toThrow('execute must be a function');
  });

  it('should produce refs usable alongside class-based TaskReferences', () => {
    const ref = task({
      name: 'functional-task',
      execute: async (_ctx, input: string) => input.toUpperCase(),
    });

    // Same shape as the metadata @Task() produces
    const asTaskRef: TaskReference<string, string> = ref;
    expect(asTaskRef.taskName).toBe('functional-task');
    expect(asTaskRef.handlerClass).toBeDefined();
    expect(asTaskRef.methodName).toBe('execute');
  });

  it('should support multiple tasks without collision', () => {
    const ref1 = task({ name: 'task-a', execute: async () => 'a' });
    const ref2 = task({ name: 'task-b', execute: async () => 'b' });

    expect(ref1.taskName).toBe('task-a');
    expect(ref2.taskName).toBe('task-b');
    expect(ref1.handlerClass).not.toBe(ref2.handlerClass);
    expect(registry.hasTask('task-a')).toBe(true);
    expect(registry.hasTask('task-b')).toBe(true);
  });
});
