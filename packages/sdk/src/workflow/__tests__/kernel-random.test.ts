/**
 * The kernel's random source, ported: it draws the values the kernel records
 * for fixed lineages, the ones every SDK draws for a run under the kernel's
 * step-id scheme.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { RunRandom, seedForLineage } from '../kernel-random';

const vectors = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'random_v1.json'), 'utf8'));

describe('the kernel random source', () => {
  for (const c of vectors.cases as any[]) {
    it(`reproduces the recorded values for lineage ${c.lineage || '(empty)'}`, () => {
      expect(Buffer.from(seedForLineage(c.lineage)).toString('hex')).toBe(c.seed);
      const r = RunRandom.forLineage(c.lineage);
      expect([0, 1, 2, 3].map(() => r.nextU64().toString())).toEqual(c.next_u64);
      expect([0, 1, 2, 3].map(() => r.nextF64())).toEqual(c.next_f64);
      expect([0, 1, 2, 3, 4, 5].map(() => Number(r.below(10n)))).toEqual(c.below_10);
      expect([0, 1, 2, 3].map(() => Number(r.range(-50n, 50n)))).toEqual(c.range_minus50_50);
      expect([0, 1, 2, 3, 4, 5].map(() => r.nextBool())).toEqual(c.next_bool);
      const shuffled = Array.from({ length: 10 }, (_, i) => i);
      r.shuffle(shuffled);
      expect(shuffled).toEqual(c.shuffle_0_to_9);
      expect(r.sample(20, 5)).toEqual(c.sample_5_of_20);
      expect(r.uuid()).toBe(c.uuid);
    });
  }
});
