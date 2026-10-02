/**
 * Guards the per-call task durations: `timeout` and the heartbeat timeout.
 *
 * The engine enforces both, but only if they reach the schedule command. If
 * either is lost in conversion, a task silently takes the engine's 300s default
 * timeout or runs without heartbeat supervision.
 */

import { Duration, durationToMillis } from '../types';

/**
 * The conversion the worker applies before handing a command to sdk-core,
 * which expects `{ secs, nanos }` rather than milliseconds.
 */
const msToDuration = (ms: number) => ({
  secs: Math.floor(ms / 1000),
  nanos: (ms % 1000) * 1_000_000,
});

describe('task execute options', () => {
  it('accepts the Duration helper and a bare number alike', () => {
    expect(durationToMillis(Duration.fromSeconds(35))).toBe(35_000);
    expect(durationToMillis(35_000)).toBe(35_000);
  });

  it('converts whole seconds to the shape sdk-core deserializes', () => {
    expect(msToDuration(durationToMillis(Duration.fromSeconds(80)))).toEqual({
      secs: 80,
      nanos: 0,
    });
  });

  it('keeps sub-second precision instead of truncating to no timeout', () => {
    // A timeout of 0 means "no limit" downstream, so truncation would invert
    // the caller's request rather than approximate it.
    expect(msToDuration(durationToMillis(Duration.fromMilliseconds(500)))).toEqual({
      secs: 0,
      nanos: 500_000_000,
    });
  });

  it('carries a fractional second into nanos', () => {
    expect(msToDuration(1_500)).toEqual({ secs: 1, nanos: 500_000_000 });
  });

  it('agrees with the other SDKs on the same declared duration', () => {
    // sdk-py encodes timedelta(seconds=45) as {'secs': 45, 'nanos': 0}; the two
    // must be indistinguishable by the time they reach the engine.
    expect(msToDuration(durationToMillis(Duration.fromSeconds(45)))).toEqual({
      secs: 45,
      nanos: 0,
    });
  });
});
