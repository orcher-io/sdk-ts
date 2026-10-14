/**
 * A native module whose worker host does nothing: it starts, hands over no
 * work, and on shutdown ends every pull, as the real host does once it has
 * stopped. The client calls a worker makes on `run()` succeed.
 *
 * A test mocks `core/native` and returns this from `getNativeModule`.
 */
import { jest } from '@jest/globals';

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
    hostShutdown: jest.fn(async () => {
      const ended = pending;
      pending = [];
      for (const end of ended) end(null);
    }),
  };
}
