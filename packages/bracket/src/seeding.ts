import { BracketError } from './types.js';

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard bracket order: seed 1 meets the lowest seed, and seeds 1 and 2 can only meet in the
 * final. Returns seeds in slot order, e.g. size 8 → [1, 8, 4, 5, 2, 7, 3, 6].
 */
export function seedPositions(size: number): number[] {
  if (size < 2 || nextPowerOfTwo(size) !== size) {
    throw new BracketError('INVALID_SIZE', `Bracket size must be a power of two ≥ 2 (got ${size})`);
  }
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return order;
}

/** Deterministic Fisher–Yates shuffle with a seeded PRNG, so random seeding is reproducible. */
export function shuffleSeeds<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
