/**
 * Tests for workflow() functional API
 */

import { workflow } from '../workflow';
import { GlobalRegistry } from '../../di/registry';
import type { WorkflowReference } from '../../di/types';

describe('workflow() functional API', () => {
  let registry: GlobalRegistry;

  beforeEach(() => {
    registry = GlobalRegistry.getInstance();
    registry.clear();
  });

  afterEach(() => {
    registry.clear();
  });

  it('should return a WorkflowReference with correct shape', () => {
    const ref = workflow({
      name: 'my-workflow',
      run: async (_ctx, _input: { x: number }) => ({ result: 42 }),
    });

    expect(ref.workflowName).toBe('my-workflow');
    expect(ref.version).toBe('1.0');
    expect(ref.workflowClass).toBeDefined();
    expect(typeof ref.workflowClass).toBe('function');
  });

  it('should register workflow in GlobalRegistry', () => {
    workflow({
      name: 'registered-wf',
      run: async () => 'done',
    });

    expect(registry.hasWorkflow('registered-wf')).toBe(true);
    const metadata = registry.getWorkflow('registered-wf');
    expect(metadata).toBeDefined();
    expect(metadata!.name).toBe('registered-wf');
    expect(metadata!.version).toBe('1.0');
  });

  it('should respect custom version', () => {
    const ref = workflow({
      name: 'versioned-wf',
      version: '2.5',
      run: async () => 'done',
    });

    expect(ref.version).toBe('2.5');
    const metadata = registry.getWorkflow('versioned-wf');
    expect(metadata!.version).toBe('2.5');
  });

  it('should store description and timeout in metadata', () => {
    workflow({
      name: 'described-wf',
      description: 'A test workflow',
      timeout: 60_000,
      run: async () => 'done',
    });

    const metadata = registry.getWorkflow('described-wf');
    expect(metadata!.description).toBe('A test workflow');
    expect(metadata!.timeout).toBe(60_000);
  });

  it('should store cronSchedule in metadata', () => {
    workflow({
      name: 'cron-wf',
      cronSchedule: '0 9 * * *',
      run: async () => 'done',
    });

    const metadata = registry.getWorkflow('cron-wf');
    expect(metadata!.cronSchedule).toBe('0 9 * * *');
  });

  it('should create a workflow class whose run method calls the provided function', async () => {
    const runFn = jest.fn().mockResolvedValue({ status: 'completed' });

    const ref = workflow({
      name: 'callable-wf',
      run: runFn,
    });

    // Call it the way the worker does: new WorkflowClass(), then instance.run(ctx, input)
    const instance = new ref.workflowClass();
    const result = await instance.run('fake-ctx', { orderId: '123' });

    expect(runFn).toHaveBeenCalledWith('fake-ctx', { orderId: '123' });
    expect(result).toEqual({ status: 'completed' });
  });

  it('should throw on empty name', () => {
    expect(() =>
      workflow({ name: '', run: async () => {} })
    ).toThrow('requires a non-empty name');
  });

  it('should throw on missing run', () => {
    expect(() =>
      workflow({ name: 'bad', run: undefined as any })
    ).toThrow('run must be a function');
  });

  it('should support multiple workflows without collision', () => {
    const ref1 = workflow({ name: 'wf-a', run: async () => 'a' });
    const ref2 = workflow({ name: 'wf-b', run: async () => 'b' });

    expect(ref1.workflowName).toBe('wf-a');
    expect(ref2.workflowName).toBe('wf-b');
    expect(ref1.workflowClass).not.toBe(ref2.workflowClass);
    expect(registry.hasWorkflow('wf-a')).toBe(true);
    expect(registry.hasWorkflow('wf-b')).toBe(true);
  });

  it('should produce correctly typed refs', () => {
    const ref = workflow({
      name: 'typed-wf',
      run: async (_ctx, input: { amount: number }) => ({ ok: true }),
    });

    // Must satisfy the WorkflowReference type
    const asRef: WorkflowReference<{ amount: number }, { ok: boolean }> = ref;
    expect(asRef.workflowName).toBe('typed-wf');
  });
});
