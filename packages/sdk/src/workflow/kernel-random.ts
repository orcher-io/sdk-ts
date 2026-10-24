/**
 * The kernel's deterministic random source, version 1.
 *
 * A run under the kernel's step-id scheme draws its random values from one
 * generator seeded from its history lineage, with algorithms the kernel
 * fixes, so every SDK draws the same values for the run. This is that
 * algorithm (sdk-core `src/kernel/random.rs`), checked against the values
 * the kernel records for fixed lineages (`__tests__/fixtures/random_v1.json`):
 *
 * - **Seed**: SHA-256 of `orcher.kernel.v1.random`, a zero byte and the
 *   lineage's UTF-8 bytes; the 32 bytes are four little-endian u64 words of
 *   state (an all-zero state takes 1 as its first word).
 * - **Generator**: xoshiro256**.
 * - **Float** in [0, 1): `(next >> 11) * 2^-53`.
 * - **Below n**, unbiased: `threshold = (2^64 - n) % n`; draw until
 *   `x >= threshold`; return `x % n`.
 * - **Range** [low, high): `low + below(high - low)`.
 * - **Bool**: the top bit of `next`.
 * - **Shuffle** in place: for `i` from `len - 1` down to 1, swap `i` with
 *   `below(i + 1)`.
 * - **Sample** `k` of `n`: indices `0..n`; for `i` in `0..k`, swap `i` with
 *   `i + below(n - i)`; the first `k`.
 * - **UUID** (version 4): the little-endian bytes of two `next` values; byte 6
 *   becomes `(b6 & 0x0f) | 0x40`, byte 8 `(b8 & 0x3f) | 0x80`.
 *
 * @internal
 */

import { createHash } from 'crypto';

const MASK = (1n << 64n) - 1n;
const SEED_LABEL = 'orcher.kernel.v1.random';

/** The seed of the run whose history lineage is `lineage`. */
export function seedForLineage(lineage: string): Uint8Array {
  const hash = createHash('sha256');
  hash.update(Buffer.from(SEED_LABEL, 'utf8'));
  hash.update(Buffer.from([0]));
  hash.update(Buffer.from(lineage, 'utf8'));
  return new Uint8Array(hash.digest());
}

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK;
}

function wordAt(bytes: Uint8Array, offset: number): bigint {
  let word = 0n;
  for (let i = 7; i >= 0; i--) {
    word = (word << 8n) | BigInt(bytes[offset + i]!);
  }
  return word;
}

function littleEndian(word: bigint): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    out.push(Number((word >> BigInt(8 * i)) & 0xffn));
  }
  return out;
}

/** A run's deterministic random source, from its 32-byte seed. */
export class RunRandom {
  private readonly s: bigint[];

  constructor(seed: Uint8Array) {
    if (seed.length !== 32) {
      throw new Error(`a seed is 32 bytes, not ${seed.length}`);
    }
    this.s = [0, 8, 16, 24].map((offset) => wordAt(seed, offset));
    if (this.s.every((word) => word === 0n)) {
      this.s[0] = 1n;
    }
  }

  /** The source of the run whose history lineage is `lineage`. */
  static forLineage(lineage: string): RunRandom {
    return new RunRandom(seedForLineage(lineage));
  }

  /** The next 64 random bits. */
  nextU64(): bigint {
    const s = this.s;
    const result = (rotl((s[1]! * 5n) & MASK, 7n) * 9n) & MASK;
    const t = (s[1]! << 17n) & MASK;
    s[2] = s[2]! ^ s[0]!;
    s[3] = s[3]! ^ s[1]!;
    s[1] = s[1]! ^ s[2]!;
    s[0] = s[0]! ^ s[3]!;
    s[2] = s[2]! ^ t;
    s[3] = rotl(s[3]!, 45n);
    return result;
  }

  /** A float in [0, 1). */
  nextF64(): number {
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  /** An integer in [0, n), unbiased. */
  below(n: bigint): bigint {
    if (n <= 0n) {
      throw new Error('below() needs a bound greater than 0');
    }
    const threshold = ((1n << 64n) - n) % n;
    for (;;) {
      const x = this.nextU64();
      if (x >= threshold) {
        return x % n;
      }
    }
  }

  /** An integer in [low, high). */
  range(low: bigint, high: bigint): bigint {
    if (low >= high) {
      throw new Error(`range(${low}, ${high}) is empty`);
    }
    return low + this.below(high - low);
  }

  /** A random boolean. */
  nextBool(): boolean {
    return this.nextU64() >> 63n === 1n;
  }

  /** Shuffles `items` in place. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Number(this.below(BigInt(i + 1)));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
  }

  /** `k` distinct indices of `n`, in the order drawn. */
  sample(n: number, k: number): number[] {
    if (k > n) {
      throw new Error(`cannot sample ${k} of ${n}`);
    }
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Number(this.below(BigInt(n - i)));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    return indices.slice(0, k);
  }

  /** A version 4 UUID, hyphenated lowercase. */
  uuid(): string {
    const bytes = [...littleEndian(this.nextU64()), ...littleEndian(this.nextU64())];
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}
