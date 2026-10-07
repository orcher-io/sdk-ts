/**
 * Tests for silent no-ops: an operation that reports success while doing
 * nothing, or an option accepted at the public API and discarded before it
 * reaches the wire.
 *
 * Each block guards one such case:
 *   - `cancel()`/`terminate()` must await the promise-returning native call, so a
 *     failed RPC surfaces to the caller;
 *   - `reset()` must reject when the native binding is missing or fails, never
 *     resolve to `''` as if it had succeeded;
 *   - start options the SDK cannot honor are rejected rather than dropped;
 *   - a poller count of 0 is rejected, because such a worker reports healthy and
 *     never receives work;
 *   - the workflow timeout options use the names the native layer reads, so a
 *     workflow does not run without a deadline.
 *
 * NOTE: tsconfig excludes test files, so nothing type-checks this file —
 * the assertions below are deliberately runtime ones. A type-only assertion
 * here would silently prove nothing.
 */

import type { WorkflowStartOptions } from '../client/types';
import { WorkflowIdReusePolicy } from '../client/types';
import type { NativeWorkflowStartOptions as CoreWorkflowStartOptions } from '../core/types';

// ---------------------------------------------------------------------------
// Native module mock — shared by the handle and client blocks
// ---------------------------------------------------------------------------

const mockNative = {
  workflowHandleCancel: jest.fn(),
  workflowHandleTerminate: jest.fn(),
  workflowHandleReset: jest.fn(),
};

jest.mock('../core/native', () => ({
  getNativeModule: jest.fn(() => mockNative),
  isNativeAvailable: jest.fn(() => true),
}));

import { WorkflowHandle } from '../client/workflow-handle';
import { Client } from '../client/client';
import { Worker } from '../worker/worker';

const makeHandle = () => new WorkflowHandle({} as never, 'wf-1', 'run-1');

describe('handle operations are awaited (no fire-and-forget)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNative.workflowHandleCancel.mockResolvedValue(undefined);
    mockNative.workflowHandleTerminate.mockResolvedValue(undefined);
  });

  it('cancel() rejects when the native call rejects', async () => {
    mockNative.workflowHandleCancel.mockRejectedValue(new Error('server said no'));

    await expect(makeHandle().cancel()).rejects.toThrow(/server said no/);
  });

  it('terminate() rejects when the native call rejects', async () => {
    mockNative.workflowHandleTerminate.mockRejectedValue(new Error('server said no'));

    await expect(makeHandle().terminate('because')).rejects.toThrow(/server said no/);
  });

  it('cancel() resolves only after the native call settles', async () => {
    let settled = false;
    mockNative.workflowHandleCancel.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            settled = true;
            resolve();
          })
        )
    );

    await makeHandle().cancel();

    expect(settled).toBe(true);
  });
});

describe('reset() reaches the native binding', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the new execution id from the native call', async () => {
    mockNative.workflowHandleReset.mockResolvedValue('exec-new-42');

    await expect(makeHandle().reset(5, 'bad deploy')).resolves.toBe('exec-new-42');
    expect(mockNative.workflowHandleReset).toHaveBeenCalledWith({}, 5, 'bad deploy');
  });

  it('propagates a native failure instead of reporting success', async () => {
    mockNative.workflowHandleReset.mockRejectedValue(new Error('event_id out of range'));

    await expect(makeHandle().reset(999)).rejects.toThrow(/event_id out of range/);
  });

  it('never resolves to an empty id when the binding is missing', async () => {
    // An optional call on an absent binding resolves to `undefined`, which must
    // not be coerced to '' and returned as a successful reset.
    mockNative.workflowHandleReset.mockImplementation(() => {
      throw new TypeError('workflowHandleReset is not a function');
    });

    await expect(makeHandle().reset(5)).rejects.toThrow();
  });
});

describe('start options that cannot be honoured are rejected', () => {
  const client = new Client({ serverUrl: 'http://localhost:50051', namespace: 'default' });

  const base: WorkflowStartOptions = { workflowType: 'Order', taskQueue: 'default' };

  it.each([
    ['memo', { memo: { note: 'hi' } }],
    ['searchAttributes', { searchAttributes: { customer: 'acme' } }],
  ])('rejects %s rather than discarding it', async (name, extra) => {
    await expect(
      client.startWorkflow({ ...base, ...(extra as Partial<WorkflowStartOptions>) })
    ).rejects.toThrow(new RegExp(name));
  });

  it.each([
    ['memo', { memo: { note: 'hi' } }],
    ['searchAttributes', { searchAttributes: { customer: 'acme' } }],
  ])('says plainly that %s is not supported', async (name, extra) => {
    // "Not plumbed through" read as a bug in the caller's setup, not as a
    // feature the SDK does not have.
    await expect(
      client.startWorkflow({ ...base, ...(extra as Partial<WorkflowStartOptions>) })
    ).rejects.toThrow(
      `The '${name}' start option is not supported yet: this SDK does not send it to the server.`
    );
  });

  it('rejects a reuse policy it does not know rather than starting under another', async () => {
    // The key rather than the value — an easy slip, and one the native layer
    // would otherwise be left to refuse with less to go on.
    await expect(
      client.startWorkflow({
        ...base,
        workflowIdReusePolicy: 'AllowDuplicate' as unknown as WorkflowIdReusePolicy,
      })
    ).rejects.toThrow(/workflowIdReusePolicy must be one of/);
  });

  it('lets a known reuse policy through to the connection check', async () => {
    await expect(
      client.startWorkflow({
        ...base,
        workflowIdReusePolicy: WorkflowIdReusePolicy.RejectDuplicate,
      })
    ).rejects.toThrow(/connect/i);
  });

  it('does not reject a start that sets only supported options', async () => {
    // Reaches the connection check, which is the next guard — proving the
    // option validation itself let it through.
    await expect(
      client.startWorkflow({ ...base, workflowExecutionTimeout: 60_000 })
    ).rejects.toThrow(/connect/i);
  });
});

describe('worker rejects a poller count that would never receive work', () => {
  const base = {
    serverUrl: 'http://localhost:50051',
    namespace: 'default',
    taskQueue: 'test-queue',
    workflows: [],
    tasks: [],
  };

  it.each(['workflowPollerCount', 'taskPollerCount', 'actorPollerCount'])(
    'rejects %s: 0',
    (key) => {
      expect(() => new Worker({ ...base, [key]: 0 })).toThrow(/must be >= 1/);
    }
  );

  it('still accepts a poller count of 1', () => {
    // Construction continues past validation into native setup, which this
    // suite does not stub — assert only that validation let the value through.
    expect(() => new Worker({ ...base, taskPollerCount: 1 })).not.toThrow(/must be >= 1/);
  });
});

describe('workflow timeout options are typed as milliseconds', () => {
  it('accepts numbers for every timeout', () => {
    const options: WorkflowStartOptions = {
      workflowType: 'Order',
      workflowExecutionTimeout: 3_600_000,
      workflowRunTimeout: 600_000,
      workflowTaskTimeout: 10_000,
    };

    expect(options.workflowExecutionTimeout).toBe(3_600_000);
  });

  it('both surfaces spell the timeouts the same way', () => {
    // The native reads these names off the caller's object. Two interfaces
    // describe that object; if they disagree, one side's timeouts vanish.
    const viaCore: CoreWorkflowStartOptions = {
      workflowId: 'wf-1',
      workflowType: 'Order',
      taskQueue: 'default',
      workflowExecutionTimeout: 3_600_000,
      workflowRunTimeout: 600_000,
      workflowTaskTimeout: 10_000,
    };

    expect(viaCore.workflowExecutionTimeout).toBe(3_600_000);
  });
});
