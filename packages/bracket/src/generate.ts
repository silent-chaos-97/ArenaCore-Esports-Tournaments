import { nextPowerOfTwo, seedPositions } from './seeding.js';
import {
  BracketError,
  type BracketPlan,
  type Edge,
  type PlannedMatch,
  type PlannedRound,
  type Side,
} from './types.js';

export const matchKey = (bracket: 'W' | 'L', round: number, position: number) =>
  `${bracket}${round}-${position}`;
export const GRAND_FINAL = 'GF1';
export const GRAND_FINAL_RESET = 'GF2';

class PlanBuilder {
  readonly matches = new Map<string, PlannedMatch>();
  readonly rounds: PlannedRound[] = [];

  add(match: Omit<PlannedMatch, 'winnerTo' | 'loserTo'>): void {
    this.matches.set(match.key, { ...match, winnerTo: null, loserTo: null });
  }

  /** Records the outbound edge on the source match for every winner/loser source. */
  link(): void {
    for (const match of this.matches.values()) {
      for (const side of ['A', 'B'] as Side[]) {
        const source = match.sources[side];
        if (source.type !== 'winner' && source.type !== 'loser') continue;
        const from = this.matches.get(source.match)!;
        const edge: Edge = { match: match.key, side };
        if (source.type === 'winner') from.winnerTo = edge;
        else from.loserTo = edge;
      }
    }
  }
}

function assertParticipants(n: number, min: number): void {
  if (!Number.isInteger(n) || n < min || n > 1024) {
    throw new BracketError('INVALID_SIZE', `Need between ${min} and 1024 participants (got ${n})`);
  }
}

function singleEliminationRoundName(matchesInRound: number): string {
  if (matchesInRound === 1) return 'Final';
  if (matchesInRound === 2) return 'Semifinals';
  if (matchesInRound === 4) return 'Quarterfinals';
  return `Round of ${matchesInRound * 2}`;
}

/** Builds the winners bracket shared by both formats. Returns the number of rounds. */
function buildWinnersBracket(
  b: PlanBuilder,
  size: number,
  names: (round: number, matches: number, total: number) => string,
): number {
  const positions = seedPositions(size);
  const rounds = Math.log2(size);
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    b.rounds.push({ bracket: 'W', number: r, name: names(r, count, rounds) });
    for (let i = 1; i <= count; i++) {
      b.add({
        key: matchKey('W', r, i),
        bracket: 'W',
        round: r,
        position: i,
        sources:
          r === 1
            ? {
                A: { type: 'seed', seed: positions[2 * i - 2]! },
                B: { type: 'seed', seed: positions[2 * i - 1]! },
              }
            : {
                A: { type: 'winner', match: matchKey('W', r - 1, 2 * i - 1) },
                B: { type: 'winner', match: matchKey('W', r - 1, 2 * i) },
              },
      });
    }
  }
  return rounds;
}

export function generateSingleElimination(participants: number): BracketPlan {
  assertParticipants(participants, 2);
  const size = nextPowerOfTwo(participants);
  const b = new PlanBuilder();
  buildWinnersBracket(b, size, (_r, count) => singleEliminationRoundName(count));
  b.link();
  return {
    format: 'SINGLE_ELIMINATION',
    participants,
    size,
    grandFinalReset: false,
    rounds: b.rounds,
    matches: [...b.matches.values()],
  };
}

/**
 * Double elimination: winners bracket, a losers bracket of 2·(k−1) rounds that alternates
 * "minor" rounds (losers-bracket survivors play each other) with "major" rounds (survivors meet
 * fresh drop-downs, in alternating order to avoid immediate rematches), then a grand final with
 * an optional bracket reset.
 */
export function generateDoubleElimination(
  participants: number,
  options: { grandFinalReset?: boolean } = {},
): BracketPlan {
  assertParticipants(participants, 2);
  const grandFinalReset = options.grandFinalReset ?? true;
  const size = nextPowerOfTwo(participants);
  const b = new PlanBuilder();
  const k = buildWinnersBracket(b, size, (r, _count, total) =>
    r === total ? 'Upper Final' : `Upper Round ${r}`,
  );
  const wbFinal = matchKey('W', k, 1);

  let lbChampionSource: { type: 'winner' | 'loser'; match: string };
  if (k === 1) {
    lbChampionSource = { type: 'loser', match: wbFinal };
  } else {
    const lbRounds = 2 * (k - 1);
    const lbName = (r: number) => (r === lbRounds ? 'Lower Final' : `Lower Round ${r}`);

    const firstCount = size / 4;
    b.rounds.push({ bracket: 'L', number: 1, name: lbName(1) });
    for (let j = 1; j <= firstCount; j++) {
      b.add({
        key: matchKey('L', 1, j),
        bracket: 'L',
        round: 1,
        position: j,
        sources: {
          A: { type: 'loser', match: matchKey('W', 1, 2 * j - 1) },
          B: { type: 'loser', match: matchKey('W', 1, 2 * j) },
        },
      });
    }

    for (let m = 1; m <= k - 1; m++) {
      const major = 2 * m;
      const count = size / 2 ** (m + 1);
      b.rounds.push({ bracket: 'L', number: major, name: lbName(major) });
      for (let j = 1; j <= count; j++) {
        const dropFrom = m % 2 === 1 ? count + 1 - j : j;
        b.add({
          key: matchKey('L', major, j),
          bracket: 'L',
          round: major,
          position: j,
          sources: {
            A: { type: 'winner', match: matchKey('L', major - 1, j) },
            B: { type: 'loser', match: matchKey('W', m + 1, dropFrom) },
          },
        });
      }
      if (m <= k - 2) {
        const minor = major + 1;
        const minorCount = count / 2;
        b.rounds.push({ bracket: 'L', number: minor, name: lbName(minor) });
        for (let j = 1; j <= minorCount; j++) {
          b.add({
            key: matchKey('L', minor, j),
            bracket: 'L',
            round: minor,
            position: j,
            sources: {
              A: { type: 'winner', match: matchKey('L', major, 2 * j - 1) },
              B: { type: 'winner', match: matchKey('L', major, 2 * j) },
            },
          });
        }
      }
    }
    lbChampionSource = { type: 'winner', match: matchKey('L', lbRounds, 1) };
  }

  b.rounds.push({ bracket: 'GF', number: 1, name: 'Grand Final' });
  b.add({
    key: GRAND_FINAL,
    bracket: 'GF',
    round: 1,
    position: 1,
    sources: { A: { type: 'winner', match: wbFinal }, B: lbChampionSource },
  });
  if (grandFinalReset) {
    b.rounds.push({ bracket: 'GF', number: 2, name: 'Grand Final Reset' });
    b.add({
      key: GRAND_FINAL_RESET,
      bracket: 'GF',
      round: 2,
      position: 1,
      sources: {
        A: { type: 'rematch', match: GRAND_FINAL, side: 'A' },
        B: { type: 'rematch', match: GRAND_FINAL, side: 'B' },
      },
    });
  }
  b.link();
  return {
    format: 'DOUBLE_ELIMINATION',
    participants,
    size,
    grandFinalReset,
    rounds: b.rounds,
    matches: [...b.matches.values()],
  };
}

export function generateBracket(
  format: BracketPlan['format'],
  participants: number,
  options: { grandFinalReset?: boolean } = {},
): BracketPlan {
  return format === 'SINGLE_ELIMINATION'
    ? generateSingleElimination(participants)
    : generateDoubleElimination(participants, options);
}
