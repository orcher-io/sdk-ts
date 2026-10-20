/**
 * A worker reports what it measured of its calls to the engine and its work,
 * with the field names TypeScript code uses, and keeps them once it stops.
 */

import { Worker } from '../worker';
import type { Logger } from '../types';
import { getNativeModule } from '../../core/native';
import { fakeHostNative } from './support/fake-host';

jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(),
  isNativeAvailable: jest.fn(() => true),
}));

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const expected = {
  methods: {
    '/orcher.v1.ExecutionService/PollTaskExecution': {
      calls: 3,
      statusErrors: { '14': 1 },
      transportErrors: 0,
      retries: 1,
      latencyBuckets: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latencyTotalUs: 1200,
    },
  },
  work: {
    activations: 0,
    activationJournalEntries: 0,
    workflowReports: 0,
    workflowCommands: 0,
    workflowFailures: 0,
    tasks: 2,
    taskInputBytes: 10,
    taskReports: 0,
    taskResultBytes: 0,
    taskFailures: 0,
  },
};

describe('Worker.wireMetrics()', () => {
  it('is null before the worker runs, then the host measurements, kept after shutdown', async () => {
    const native = fakeHostNative();
    (getNativeModule as jest.Mock).mockReturnValue(native);
    const worker = new Worker({
      serverUrl: 'http://localhost:1',
      namespace: 'default',
      taskQueue: 'q',
      logger: silent,
    });
    expect(worker.wireMetrics()).toBeNull();

    await worker.run();
    expect(worker.wireMetrics()).toEqual(expected);

    await worker.shutdown();
    expect(worker.wireMetrics()).toEqual(expected);
  });
});
