/**
 * A workflow's falsy result is its result.
 *
 * A workflow that returns `0`, `false`, `''`, `[]`, `{}` or `null` completes
 * with that value as JSON. `null` used to complete with an empty payload, which
 * the engine took for a run with no result: a caller waiting on it was told
 * the result was missing.
 */

import { FakeEngine, runner } from './support/fake-engine';

// A worker connects to nothing until run(), which none of these call.
jest.mock('../../core/native', () => ({
  getNativeModule: jest.fn(() => ({})),
  isNativeAvailable: jest.fn(() => true),
}));

/** The JSON a workflow that returns `value` completes with. */
async function completedWith(value: unknown): Promise<string> {
  const commands = await runner(async () => value)(new FakeEngine());
  const complete = commands.find((c) => c.what.oneofKind === 'completeRun')!.what as any;
  return new TextDecoder().decode(Uint8Array.from(complete.completeRun.result.data));
}

describe('a falsy workflow result', () => {
  it.each([
    ['zero', 0, '0'],
    ['false', false, 'false'],
    ['an empty string', '', '""'],
    ['an empty list', [], '[]'],
    ['an empty object', {}, '{}'],
    ['null', null, 'null'],
  ])('completes with %s', async (_label, value, json) => {
    expect(await completedWith(value)).toBe(json);
  });

  it('completes with null when the workflow returns nothing', async () => {
    expect(await completedWith(undefined)).toBe('null');
  });
});
