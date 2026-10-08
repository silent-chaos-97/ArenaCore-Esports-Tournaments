export const ORG_ROLES = ['OWNER', 'ADMIN', 'REFEREE', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
/** Roles that must have MFA enabled before performing privileged actions (AUTH-02). */
export const MFA_REQUIRED_ROLES: readonly OrgRole[] = ['OWNER', 'ADMIN'];

export const TOURNAMENT_FORMATS = ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export const TEAM_MEMBER_ROLES = ['CAPTAIN', 'MANAGER', 'PLAYER', 'SUBSTITUTE'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const RESULT_SOURCES = ['GAME_API', 'PARTICIPANT', 'ADMIN'] as const;
export type ResultSource = (typeof RESULT_SOURCES)[number];

export const DISPUTE_REASONS = [
  'INCORRECT_RESULT',
  'OPPONENT_NO_SHOW',
  'DISCONNECT',
  'SERVER_FAILURE',
  'RULE_VIOLATION',
  'SUSPECTED_CHEATING',
  'INELIGIBLE_PLAYER',
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const EVIDENCE_KINDS = [
  'SCREENSHOT',
  'MATCH_ID',
  'GAME_LOG',
  'CHAT',
  'VIDEO_LINK',
  'DESCRIPTION',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'REGISTRATION_APPROVED',
  'REGISTRATION_REJECTED',
  'CHECK_IN_OPENED',
  'MATCH_STARTING_SOON',
  'OPPONENT_READY',
  'MATCH_RESCHEDULED',
  'RESULT_CONFIRMED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'ADVANCED',
  'ELIMINATED',
  'TEAM_INVITE',
  'STAFF_INVITE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
