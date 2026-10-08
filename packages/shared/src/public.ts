import { z } from 'zod';

export const PUBLIC_TOURNAMENT_PHASES = ['upcoming', 'live', 'completed'] as const;

export const discoverTournamentsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  game: z.string().trim().max(60).optional(),
  region: z.string().trim().max(30).optional(),
  phase: z.enum(PUBLIC_TOURNAMENT_PHASES).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscoverTournamentsQuery = z.infer<typeof discoverTournamentsQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(60),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const publicMatchesQuerySchema = z.object({
  phase: z.enum(PUBLIC_TOURNAMENT_PHASES).optional(),
});

export interface PublicTournamentSummary {
  id: string;
  slug: string;
  name: string;
  gameName: string;
  gameSlug: string;
  region: string;
  format: string;
  teamSize: number;
  maxTeams: number;
  registeredTeams: number;
  status: string;
  startsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  organizationName: string;
  organizationSlug: string;
  prizeInfo: string | null;
}

export interface PublicTournamentDetail extends PublicTournamentSummary {
  description: string | null;
  rules: string;
  rulesVersion: number;
  bestOf: number;
  finalsBestOf: number | null;
  maxSubstitutes: number;
  minAge: number | null;
  checkInOpensAt: string | null;
  checkInClosesAt: string | null;
  registrationOpen: boolean;
  championTeamId: string | null;
}

export interface PublicTeamEntry {
  registrationId: string;
  teamId: string;
  teamName: string;
  tag: string | null;
  logoUrl: string | null;
  seed: number | null;
  status: string;
}

export interface TeamHistoryEntry {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  roundName: string;
  opponentTeamId: string | null;
  opponentName: string | null;
  scoreFor: number | null;
  scoreAgainst: number | null;
  result: 'WIN' | 'LOSS';
  forfeit: boolean;
  completedAt: string | null;
}

export interface TeamProfileDto {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
  logoUrl: string | null;
  members: { playerId: string; displayName: string; role: string }[];
  record: { wins: number; losses: number; tournaments: number; titles: number };
  history: TeamHistoryEntry[];
}

export interface LeaderboardRow {
  rank: number;
  teamId: string;
  teamName: string;
  tournaments: number;
  titles: number;
  wins: number;
  losses: number;
  bestPlacement: number | null;
}
