/**
 * A wrong unit is not a type error and not a test failure — it is a silent
 * 1000x. These lock the one conversion every user-facing duration goes through.
 */

import { Duration, durationToMillis } from '../types';

describe('durationToMillis', () => {
  it('treats a bare number as milliseconds, the pre-existing contract', () => {
    expect(durationToMillis(90_000)).toBe(90_000);
  });

  it('converts the helper to milliseconds', () => {
    expect(durationToMillis(Duration.fromSeconds(90))).toBe(90_000);
    expect(durationToMillis(Duration.fromMilliseconds(1_500))).toBe(1_500);
    expect(durationToMillis(Duration.fromMinutes(2))).toBe(120_000);
  });

  it('makes the two spellings of the same duration identical', () => {
    // The whole point: `Duration.fromSeconds(90)` and `90000` must be
    // indistinguishable by the time they reach the wire.
    expect(durationToMillis(Duration.fromSeconds(90))).toBe(durationToMillis(90_000));
  });

  it('does not silently treat seconds as milliseconds', () => {
    // A bare 90 meant as seconds is 90ms, not 90s. The helper is the way to
    // say seconds; a bare number is always milliseconds.
    expect(durationToMillis(90)).not.toBe(durationToMillis(Duration.fromSeconds(90)));
    expect(durationToMillis(90)).toBe(90);
  });

  it('preserves sub-second precision', () => {
    expect(durationToMillis(Duration.fromMilliseconds(250))).toBe(250);
  });
});
