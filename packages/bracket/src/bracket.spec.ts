import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyResult,
  champion,
  createState,
  generateBracket,
  generateDoubleElimination,
  generateSingleElimination,
  loserOf,
  resetResult,
  seedPositions,
  shuffleSeeds,
  standings,
  type BracketPlan,
  type BracketState,
  type Format,
  type Side,
} from './index.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Plays every ready match with winners chosen by `pick` until nothing is playable. */
function playOut(
  plan: BracketPlan,
  state: BracketState,
  pick: (key: string, state: BracketState) => Side,
) {
  let current = state;
  const played: string[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    const next = Object.keys(current.matches).find((k) => current.matches[k]!.status === 'ready');
    if (!next) break;
    current = applyResult(plan, current, next, pick(next, current)).state;
    played.push(next);
  }
  return { state: current, played };
}

const formatArb = fc.constantFrom<Format>('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION');
const scenarioArb = fc.record({
  n: fc.integer({ min: 2, max: 40 }),
  format: formatArb,
  reset: fc.boolean(),
  coin: fc.infiniteStream(fc.boolean()),
});

function setup({ n, format, reset }: { n: number; format: Format; reset: boolean }) {
  const plan = generateBracket(format, n, { grandFinalReset: reset });
  return { plan, participants: ids(n), state: createState(plan, ids(n)) };
}

describe('seeding', () => {
  it('produces the standard order', () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedPositions(2)).toEqual([1, 2]);
  });

  it('pairs every first-round match to sum to size+1 and keeps 1 and 2 apart until the final', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (k) => {
        const size = 2 ** k;
        const order = seedPositions(size);
        for (let i = 0; i < size; i += 2) expect(order[i]! + order[i + 1]!).toBe(size + 1);
        expect(order.indexOf(1) < size / 2).not.toBe(order.indexOf(2) < size / 2);
      }),
    );
  });

  it('shuffles deterministically', () => {
    expect(shuffleSeeds(ids(8), 42)).toEqual(shuffleSeeds(ids(8), 42));
    expect(shuffleSeeds(ids(8), 42).sort()).toEqual(ids(8).sort());
  });
});

describe('plan generation', () => {
  it('single elimination has size-1 matches over log2(size) rounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 200 }), (n) => {
        const plan = generateSingleElimination(n);
        expect(plan.matches).toHaveLength(plan.size - 1);
        expect(plan.rounds).toHaveLength(Math.log2(plan.size));
        expect(plan.rounds.at(-1)!.name).toBe('Final');
      }),
    );
  });

  it('double elimination has 2·size-2 matches plus an optional reset', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 200 }), fc.boolean(), (n, reset) => {
        const plan = generateDoubleElimination(n, { grandFinalReset: reset });
        const expected = plan.size === 2 ? 2 : plan.size - 1 + (plan.size - 2) + 1;
        expect(plan.matches).toHaveLength(expected + (reset ? 1 : 0));
      }),
    );
  });

  it('every edge points at a source that names it back (the bracket is a consistent DAG)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), formatArb, (n, format) => {
        const plan = generateBracket(format, n);
        const byKey = new Map(plan.matches.map((m) => [m.key, m]));
        for (const m of plan.matches) {
          for (const [edge, type] of [
            [m.winnerTo, 'winner'],
            [m.loserTo, 'loser'],
          ] as const) {
            if (!edge) continue;
            const source = byKey.get(edge.match)!.sources[edge.side];
            expect(source).toEqual({ type, match: m.key });
          }
        }
      }),
    );
  });
});

describe('byes', () => {
  it('top seeds receive the byes and advance without playing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), formatArb, (n, format) => {
        const plan = generateBracket(format, n);
        const state = createState(plan, ids(n));
        const byes = plan.size - n;
        const walkedOver = plan.matches
          .filter(
            (m) =>
              m.bracket === 'W' && m.round === 1 && state.matches[m.key]!.status === 'walkover',
          )
          .map((m) => {
            const s = state.matches[m.key]!;
            return (s[s.winner!] as { id: string }).id;
          })
          .sort();
        expect(walkedOver).toEqual(ids(byes).sort());
      }),
    );
  });

  it('no ready match ever has an unresolved participant', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { plan, state } = setup(s);
        const it = s.coin[Symbol.iterator]();
        let current = state;
        for (;;) {
          for (const m of Object.values(current.matches)) {
            if (m.status === 'ready') {
              expect(m.A.state).toBe('filled');
              expect(m.B.state).toBe('filled');
            }
          }
          const next = Object.keys(current.matches).find(
            (k) => current.matches[k]!.status === 'ready',
          );
          if (!next) break;
          current = applyResult(plan, current, next, it.next().value ? 'A' : 'B').state;
        }
      }),
    );
  });
});

describe('playing a full bracket', () => {
  it('always ends with exactly one champion and nothing left to play', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { plan, state } = setup(s);
        const it = s.coin[Symbol.iterator]();
        const { state: final } = playOut(plan, state, () => (it.next().value ? 'A' : 'B'));
        expect(champion(plan, final)).not.toBeNull();
        expect(
          Object.values(final.matches).some((m) => m.status === 'pending' || m.status === 'ready'),
        ).toBe(false);
      }),
    );
  });

  it('eliminates every non-champion exactly once (SE) or after exactly two losses (DE with reset)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { plan, state, participants } = setup({ ...s, reset: true });
        const it = s.coin[Symbol.iterator]();
        const { state: final } = playOut(plan, state, () => (it.next().value ? 'A' : 'B'));
        const losses = new Map(participants.map((p) => [p, 0]));
        for (const m of Object.values(final.matches)) {
          const loser = loserOf(m);
          if (loser) losses.set(loser, losses.get(loser)! + 1);
        }
        const winner = champion(plan, final)!;
        for (const p of participants) {
          if (p === winner) {
            expect(losses.get(p)).toBeLessThan(s.format === 'SINGLE_ELIMINATION' ? 1 : 2);
          } else {
            expect(losses.get(p)).toBe(s.format === 'SINGLE_ELIMINATION' ? 1 : 2);
          }
        }
      }),
    );
  });

  it('assigns consistent competition-style placements once complete', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { plan, state, participants } = setup(s);
        const it = s.coin[Symbol.iterator]();
        const { state: final } = playOut(plan, state, () => (it.next().value ? 'A' : 'B'));
        const rows = standings(plan, final, participants);
        const placements = rows.map((r) => r.placement);
        expect(placements.every((p) => p !== null)).toBe(true);
        expect(placements.filter((p) => p === 1)).toHaveLength(1);
        for (const p of placements) {
          const better = placements.filter((q) => q! < p!).length;
          expect(p).toBe(better + 1);
        }
        expect(rows.find((r) => r.placement === 1)!.participant).toBe(champion(plan, final));
      }),
    );
  });

  it('when the better seed always wins, seeds 1 and 2 finish first and second', () => {
    for (const format of ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as const) {
      const plan = generateBracket(format, 8);
      const participants = ids(8);
      const seedOf = (id: string) => Number(id.slice(1));
      const { state } = playOut(plan, createState(plan, participants), (key, current) => {
        const m = current.matches[key]!;
        const [a, b] = [m.A, m.B].map((slot) => seedOf((slot as { id: string }).id));
        return a! < b! ? 'A' : 'B';
      });
      expect(champion(plan, state)).toBe('p1');
      const rows = standings(plan, state, participants);
      const second = rows.find((r) => r.placement === 2)!;
      expect(seedOf(second.participant)).toBe(2);
    }
  });
});

describe('result application', () => {
  it('is idempotent and rejects conflicting results', () => {
    const plan = generateSingleElimination(4);
    const state = createState(plan, ids(4));
    const once = applyResult(plan, state, 'W1-1', 'A');
    const twice = applyResult(plan, once.state, 'W1-1', 'A');
    expect(twice.changed).toBe(false);
    expect(twice.state).toBe(once.state);
    expect(() => applyResult(plan, once.state, 'W1-1', 'B')).toThrow(/different result/);
    expect(() => applyResult(plan, state, 'W2-1', 'A')).toThrow(/not ready/);
  });

  it('never mutates its input', () => {
    const plan = generateDoubleElimination(6);
    const state = createState(plan, ids(6));
    const snapshot = JSON.stringify(state);
    const ready = Object.keys(state.matches).find((k) => state.matches[k]!.status === 'ready')!;
    applyResult(plan, state, ready, 'B');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('reports newly playable matches', () => {
    const plan = generateSingleElimination(4);
    let state = createState(plan, ids(4));
    state = applyResult(plan, state, 'W1-1', 'A').state;
    const outcome = applyResult(plan, state, 'W1-2', 'B');
    expect(outcome.ready).toEqual(['W2-1']);
  });

  it('plays the grand-final reset only when the lower-bracket champion wins', () => {
    const plan = generateDoubleElimination(4);
    const base = playOut(plan, createState(plan, ids(4)), (k) => (k === 'GF1' ? 'A' : 'A'));
    expect(base.state.matches.GF2!.status).toBe('void');
    const upset = playOut(plan, createState(plan, ids(4)), (k) => (k === 'GF1' ? 'B' : 'A'));
    expect(upset.state.matches.GF2!.status).toBe('completed');
  });
});

describe('resetting results', () => {
  it('reset + replay of the same result restores the original state', () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (s, choice) => {
        const { plan, state } = setup(s);
        const it = s.coin[Symbol.iterator]();
        const winners = new Map<string, Side>();
        const { state: final, played } = playOut(plan, state, (k) => {
          const w: Side = it.next().value ? 'A' : 'B';
          winners.set(k, w);
          return w;
        });
        if (played.length === 0) return;
        const target = played[choice % played.length]!;
        const { state: cleared, affected } = resetResult(plan, final, target);
        expect(affected).toContain(target);
        expect(cleared.matches[target]!.status).toBe('ready');
        const { state: replayed } = playOut(plan, cleared, (k) => winners.get(k)!);
        expect(replayed).toEqual(final);
      }),
      { numRuns: 200 },
    );
  });

  it('clears downstream matches that depended on the reset result', () => {
    const plan = generateSingleElimination(4);
    const { state } = playOut(plan, createState(plan, ids(4)), () => 'A');
    const { state: cleared, affected } = resetResult(plan, state, 'W1-1');
    expect(affected.sort()).toEqual(['W1-1', 'W2-1']);
    expect(cleared.matches['W2-1']).toMatchObject({
      status: 'pending',
      winner: null,
      A: { state: 'pending' },
    });
    expect(champion(plan, cleared)).toBeNull();
  });
});
