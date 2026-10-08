export type Side = 'A' | 'B';
export type BracketSide = 'W' | 'L' | 'GF';
export type Format = 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';

/** Where a match slot's participant comes from. */
export type SlotSource =
  | { type: 'seed'; seed: number }
  | { type: 'winner'; match: string }
  | { type: 'loser'; match: string }
  /** Grand-final reset: the participant who played `side` in `match` (only if a reset is needed). */
  | { type: 'rematch'; match: string; side: Side };

export interface Edge {
  match: string;
  side: Side;
}

export interface PlannedMatch {
  key: string;
  bracket: BracketSide;
  round: number;
  position: number;
  sources: { A: SlotSource; B: SlotSource };
  winnerTo: Edge | null;
  loserTo: Edge | null;
}

export interface PlannedRound {
  bracket: BracketSide;
  number: number;
  name: string;
}

export interface BracketPlan {
  format: Format;
  participants: number;
  /** Bracket size: next power of two ≥ participants. */
  size: number;
  grandFinalReset: boolean;
  rounds: PlannedRound[];
  matches: PlannedMatch[];
}

export type ParticipantId = string;

export type Slot =
  | { state: 'pending' }
  | { state: 'filled'; id: ParticipantId }
  /** Structurally no participant will ever arrive (bye, or nobody left upstream). */
  | { state: 'empty' };

export type MatchStatus =
  /** Waiting for at least one participant. */
  | 'pending'
  /** Both participants known; awaiting a result. */
  | 'ready'
  | 'completed'
  /** Only one participant could ever arrive; they advance without playing. */
  | 'walkover'
  /** No participants, or a grand-final reset that was not needed. */
  | 'void';

export interface MatchState {
  A: Slot;
  B: Slot;
  status: MatchStatus;
  winner: Side | null;
}

export interface BracketState {
  matches: Record<string, MatchState>;
}

export interface Placement {
  participant: ParticipantId;
  placement: number | null;
  wins: number;
  losses: number;
  eliminated: boolean;
}

export class BracketError extends Error {
  constructor(
    readonly code:
      'UNKNOWN_MATCH' | 'NOT_READY' | 'ALREADY_DECIDED' | 'INVALID_SEEDING' | 'INVALID_SIZE',
    message: string,
  ) {
    super(message);
    this.name = 'BracketError';
  }
}
