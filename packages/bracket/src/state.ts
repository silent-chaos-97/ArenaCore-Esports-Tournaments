import { GRAND_FINAL, GRAND_FINAL_RESET } from './generate.js';
import {
  BracketError,
  type BracketPlan,
  type BracketState,
  type MatchState,
  type ParticipantId,
  type PlannedMatch,
  type Placement,
  type Side,
  type Slot,
} from './types.js';

const PENDING: Slot = { state: 'pending' };
const EMPTY: Slot = { state: 'empty' };
const other = (side: Side): Side => (side === 'A' ? 'B' : 'A');

/** Indexed view over a plan; cheap to build and reused by every operation. */
class Graph {
  readonly byKey: Map<string, PlannedMatch>;
  constructor(readonly plan: BracketPlan) {
    this.byKey = new Map(plan.matches.map((m) => [m.key, m]));
  }
  get(key: string): PlannedMatch {
    const m = this.byKey.get(key);
    if (!m) throw new BracketError('UNKNOWN_MATCH', `Unknown match ${key}`);
    return m;
  }
}

function clone(state: BracketState): BracketState {
  return {
    matches: Object.fromEntries(
      Object.entries(state.matches).map(([k, m]) => [
        k,
        { A: { ...m.A }, B: { ...m.B }, status: m.status, winner: m.winner },
      ]),
    ),
  };
}

/** Mutable working copy used inside a single operation. */
class Engine {
  readonly touched = new Set<string>();

  constructor(
    readonly graph: Graph,
    readonly state: BracketState,
  ) {}

  m(key: string): MatchState {
    return this.state.matches[key]!;
  }

  setSlot(key: string, side: Side, slot: Slot): void {
    this.m(key)[side] = slot;
    this.touched.add(key);
    this.evaluate(key);
  }

  /** Resolves a match whose slots are both determined: ready, walkover or void. */
  evaluate(key: string): void {
    const match = this.m(key);
    if (match.status !== 'pending') return;
    const { A, B } = match;
    if (A.state === 'pending' || B.state === 'pending') return;
    if (A.state === 'filled' && B.state === 'filled') {
      match.status = 'ready';
      this.touched.add(key);
      return;
    }
    if (A.state === 'empty' && B.state === 'empty') {
      match.status = 'void';
      this.touched.add(key);
      this.propagate(key, EMPTY, EMPTY);
      return;
    }
    const side: Side = A.state === 'filled' ? 'A' : 'B';
    match.status = 'walkover';
    match.winner = side;
    this.touched.add(key);
    this.propagate(key, match[side], EMPTY);
  }

  propagate(key: string, winner: Slot, loser: Slot): void {
    const planned = this.graph.get(key);
    if (planned.winnerTo) this.setSlot(planned.winnerTo.match, planned.winnerTo.side, winner);
    if (planned.loserTo) this.setSlot(planned.loserTo.match, planned.loserTo.side, loser);
    if (key === GRAND_FINAL && this.state.matches[GRAND_FINAL_RESET]) this.resolveReset();
  }

  /** The reset is only played when the lower-bracket champion (side B) wins the first grand final. */
  resolveReset(): void {
    const gf = this.m(GRAND_FINAL);
    const reset = this.m(GRAND_FINAL_RESET);
    this.touched.add(GRAND_FINAL_RESET);
    if (gf.status === 'completed' && gf.winner === 'B') {
      reset.A = { ...gf.A };
      reset.B = { ...gf.B };
      reset.status = 'ready';
    } else {
      reset.A = EMPTY;
      reset.B = EMPTY;
      reset.status = 'void';
    }
  }

  /** Clears a match's outcome and everything downstream that depended on it. */
  clear(key: string): void {
    const match = this.m(key);
    const planned = this.graph.get(key);
    match.winner = null;
    match.status = match.A.state === 'filled' && match.B.state === 'filled' ? 'ready' : 'pending';
    this.touched.add(key);
    const targets = [planned.winnerTo, planned.loserTo].filter((e) => e !== null);
    for (const edge of targets) {
      this.m(edge.match)[edge.side] = PENDING;
      this.clearDownstream(edge.match);
    }
    if (key === GRAND_FINAL && this.state.matches[GRAND_FINAL_RESET]) {
      const reset = this.m(GRAND_FINAL_RESET);
      reset.A = PENDING;
      reset.B = PENDING;
      reset.winner = null;
      reset.status = 'pending';
      this.touched.add(GRAND_FINAL_RESET);
    }
  }

  private clearDownstream(key: string): void {
    const match = this.m(key);
    if (match.status === 'pending' || match.status === 'ready') {
      match.status = 'pending';
      match.winner = null;
      this.touched.add(key);
      return;
    }
    this.clear(key);
    match.status = 'pending';
  }
}

/**
 * Builds the initial state. `seeding[i]` holds the participant with seed i+1. Byes resolve
 * immediately, cascading walkovers and voids through the bracket.
 */
export function createState(plan: BracketPlan, seeding: readonly ParticipantId[]): BracketState {
  if (seeding.length !== plan.participants || new Set(seeding).size !== seeding.length) {
    throw new BracketError(
      'INVALID_SEEDING',
      `Expected ${plan.participants} distinct participants`,
    );
  }
  const state: BracketState = {
    matches: Object.fromEntries(
      plan.matches.map((m) => [
        m.key,
        { A: PENDING, B: PENDING, status: 'pending', winner: null } satisfies MatchState,
      ]),
    ),
  };
  const engine = new Engine(new Graph(plan), state);
  for (const m of plan.matches) {
    for (const side of ['A', 'B'] as Side[]) {
      const source = m.sources[side];
      if (source.type !== 'seed') continue;
      const id = seeding[source.seed - 1];
      engine.setSlot(m.key, side, id === undefined ? EMPTY : { state: 'filled', id });
    }
  }
  return state;
}

export interface ApplyOutcome {
  state: BracketState;
  /** False when the identical result had already been applied (idempotent replay). */
  changed: boolean;
  /** Matches whose slots or status changed, including the reported match. */
  affected: string[];
  /** Matches that became playable because of this result. */
  ready: string[];
}

export function applyResult(
  plan: BracketPlan,
  state: BracketState,
  key: string,
  winner: Side,
): ApplyOutcome {
  const graph = new Graph(plan);
  graph.get(key);
  const current = state.matches[key]!;
  if (current.status === 'completed') {
    if (current.winner === winner) return { state, changed: false, affected: [], ready: [] };
    throw new BracketError(
      'ALREADY_DECIDED',
      `${key} already has a different result; reset it first`,
    );
  }
  if (current.status !== 'ready')
    throw new BracketError('NOT_READY', `${key} is not ready to be played (${current.status})`);

  const before = new Set(
    Object.entries(state.matches)
      .filter(([, m]) => m.status === 'ready')
      .map(([k]) => k),
  );
  const next = clone(state);
  const engine = new Engine(graph, next);
  const match = next.matches[key]!;
  match.status = 'completed';
  match.winner = winner;
  engine.touched.add(key);
  engine.propagate(key, match[winner], match[other(winner)]);
  const ready = [...engine.touched].filter(
    (k) => next.matches[k]!.status === 'ready' && !before.has(k),
  );
  return { state: next, changed: true, affected: [...engine.touched], ready };
}

/** Undoes a played result and every downstream outcome that depended on it. */
export function resetResult(
  plan: BracketPlan,
  state: BracketState,
  key: string,
): { state: BracketState; affected: string[] } {
  const graph = new Graph(plan);
  graph.get(key);
  if (state.matches[key]!.status !== 'completed') {
    throw new BracketError('NOT_READY', `${key} has no played result to reset`);
  }
  const next = clone(state);
  const engine = new Engine(graph, next);
  engine.clear(key);
  return { state: next, affected: [...engine.touched] };
}

export function participantsOf(match: MatchState): {
  A: ParticipantId | null;
  B: ParticipantId | null;
} {
  return {
    A: match.A.state === 'filled' ? match.A.id : null,
    B: match.B.state === 'filled' ? match.B.id : null,
  };
}

export function winnerOf(match: MatchState): ParticipantId | null {
  if (!match.winner) return null;
  const slot = match[match.winner];
  return slot.state === 'filled' ? slot.id : null;
}

export function loserOf(match: MatchState): ParticipantId | null {
  if (match.status !== 'completed' || !match.winner) return null;
  const slot = match[other(match.winner)];
  return slot.state === 'filled' ? slot.id : null;
}

export function champion(plan: BracketPlan, state: BracketState): ParticipantId | null {
  if (plan.format === 'SINGLE_ELIMINATION') {
    const finalRound = Math.log2(plan.size);
    return winnerOf(state.matches[`W${finalRound}-1`]!);
  }
  const gf = state.matches[GRAND_FINAL]!;
  const reset = state.matches[GRAND_FINAL_RESET];
  if (reset?.status === 'completed') return winnerOf(reset);
  if (gf.status !== 'completed' && gf.status !== 'walkover') return null;
  if (gf.winner === 'A' || !reset) return winnerOf(gf);
  return null;
}

export function isComplete(plan: BracketPlan, state: BracketState): boolean {
  return champion(plan, state) !== null;
}

/** Index of the elimination "group" a match belongs to, or null if losing there does not eliminate. */
function eliminationGroup(plan: BracketPlan, m: PlannedMatch): number | null {
  if (plan.format === 'SINGLE_ELIMINATION') return m.round;
  if (m.bracket === 'L') return m.round;
  if (m.bracket === 'GF') return 10_000;
  return null;
}

/**
 * Wins/losses and placements. Teams eliminated in the same round share a placement
 * (standard competition ranking), e.g. both semifinal losers place 3rd.
 */
export function standings(
  plan: BracketPlan,
  state: BracketState,
  participants: readonly ParticipantId[],
): Placement[] {
  const groupSize = new Map<number, number>();
  for (const m of plan.matches) {
    const group = eliminationGroup(plan, m);
    if (group === null) continue;
    const s = state.matches[m.key]!;
    const eliminates =
      m.bracket === 'GF'
        ? m.key === GRAND_FINAL
        : s.status !== 'void' &&
          s.status !== 'walkover' &&
          s.A.state !== 'empty' &&
          s.B.state !== 'empty';
    if (eliminates) groupSize.set(group, (groupSize.get(group) ?? 0) + 1);
  }
  const groups = [...groupSize.keys()].sort((a, b) => a - b);
  const placementForGroup = new Map<number, number>();
  let eliminatedSoFar = 0;
  for (const g of groups) {
    eliminatedSoFar += groupSize.get(g)!;
    placementForGroup.set(g, plan.participants - eliminatedSoFar + 1);
  }

  const rows = new Map<ParticipantId, Placement>(
    participants.map((p) => [
      p,
      { participant: p, placement: null, wins: 0, losses: 0, eliminated: false },
    ]),
  );
  for (const m of plan.matches) {
    const s = state.matches[m.key]!;
    if (s.status !== 'completed') continue;
    const winner = winnerOf(s);
    const loser = loserOf(s);
    if (winner) rows.get(winner)!.wins += 1;
    if (!loser) continue;
    const row = rows.get(loser)!;
    row.losses += 1;
    const group = eliminationGroup(plan, m);
    const eliminatesHere =
      group !== null &&
      (m.key !== GRAND_FINAL || s.winner === 'A' || !state.matches[GRAND_FINAL_RESET]);
    if (eliminatesHere) {
      row.eliminated = true;
      row.placement = placementForGroup.get(group)!;
    }
  }
  const winner = champion(plan, state);
  if (winner) rows.get(winner)!.placement = 1;
  return [...rows.values()];
}
