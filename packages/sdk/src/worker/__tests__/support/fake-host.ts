/**
 * A native module whose worker host does nothing: it starts, hands over no
 * work, and on shutdown ends every pull, as the real host does once it has
 * stopped. The client calls a worker makes on `run()` succeed.
 *
 * A test mocks `core/native` and returns this from `getNativeModule`.
 */
import { jest } from '@jest/globals';

/** The measurements the fake host reports, in the native JSON shape. */
export const WIRE_METRICS = {
  methods: {
    '/orcher.v1.ExecutionService/PollTaskExecution': {
      calls: 3,
      status_errors: { '14': 1 },
      transport_errors: 0,
      retries: 1,
      latency_buckets: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latency_total_us: 1200,
    },
  },
  work: { activations: 0, tasks: 2, task_input_bytes: 10 },
};

export function fakeHostNative() {
  let pending: Array<(value: null) => void> = [];
  const pull = () =>
    new Promise<Uint8Array | null>((resolve) => {
      pending.push(resolve);
    });
  return {
    clientConnect: jest.fn(async () => ({})),
    clientClose: jest.fn(),
    hostStart: jest.fn(async (_config: string, _registrations: string) => ({})),
    hostNextActivation: jest.fn(pull),
    hostNextTask: jest.fn(pull),
    hostNextActorOperation: jest.fn(pull),
    hostWireMetrics: jest.fn(() => JSON.stringify(WIRE_METRICS)),
    hostShutdown: jest.fn(async () => {
      const ended = pending;
      pending = [];
      for (const end of ended) end(null);
    }),
  };
}
