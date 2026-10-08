import { defineMachine } from './state-machine.js';

export const TOURNAMENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const tournamentMachine = defineMachine<TournamentStatus>('tournament', {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['DRAFT', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  /** Re-opened only when a referee overturns a result that decided the champion. */
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
});

export const REGISTRATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'VALIDATION_FAILED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHECKED_IN',
  'WITHDRAWN',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const registrationMachine = defineMachine<RegistrationStatus>('registration', {
  DRAFT: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'VALIDATION_FAILED', 'WITHDRAWN'],
  VALIDATION_FAILED: ['SUBMITTED', 'WITHDRAWN'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: ['CHECKED_IN', 'WITHDRAWN'],
  REJECTED: [],
  CHECKED_IN: ['WITHDRAWN'],
  WITHDRAWN: [],
});

export const MATCH_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'CHECK_IN_OPEN',
  'CHECK_IN_EXPIRED',
  'NO_SHOW_REVIEW',
  'READY',
  'IN_PROGRESS',
  'RESULT_PENDING',
  'DISPUTED',
  'COMPLETED',
  'FORFEITED',
  'CANCELLED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** PENDING = waiting for participants from upstream matches. */
export const matchMachine = defineMachine<MatchStatus>('match', {
  PENDING: ['SCHEDULED', 'COMPLETED', 'CANCELLED'],
  SCHEDULED: ['CHECK_IN_OPEN', 'COMPLETED', 'FORFEITED', 'CANCELLED'],
  CHECK_IN_OPEN: ['READY', 'CHECK_IN_EXPIRED', 'COMPLETED', 'FORFEITED', 'CANCELLED'],
  CHECK_IN_EXPIRED: ['NO_SHOW_REVIEW'],
  NO_SHOW_REVIEW: ['READY', 'FORFEITED', 'COMPLETED', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'RESULT_PENDING', 'COMPLETED', 'FORFEITED', 'CANCELLED'],
  IN_PROGRESS: ['RESULT_PENDING', 'COMPLETED', 'DISPUTED', 'FORFEITED', 'CANCELLED'],
  RESULT_PENDING: ['COMPLETED', 'DISPUTED', 'FORFEITED', 'CANCELLED'],
  DISPUTED: ['COMPLETED', 'FORFEITED', 'CANCELLED'],
  COMPLETED: ['DISPUTED'],
  FORFEITED: ['DISPUTED'],
  CANCELLED: [],
});

export const MATCH_FINAL_STATUSES: readonly MatchStatus[] = ['COMPLETED', 'FORFEITED', 'CANCELLED'];

export const DISPUTE_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'INVESTIGATING',
  'RESOLVED',
  'WITHDRAWN',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const disputeMachine = defineMachine<DisputeStatus>('dispute', {
  OPEN: ['ASSIGNED', 'RESOLVED', 'WITHDRAWN'],
  ASSIGNED: ['ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'WITHDRAWN'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: [],
  WITHDRAWN: [],
});
