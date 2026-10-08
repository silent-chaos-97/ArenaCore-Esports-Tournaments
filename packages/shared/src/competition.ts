import { z } from 'zod';

export const tournamentCheckInSchema = z.object({ teamId: z.uuid() });
export type TournamentCheckInInput = z.infer<typeof tournamentCheckInSchema>;

export const setSeedingSchema = z.object({
  order: z
    .array(z.uuid())
    .min(2)
    .refine((ids) => new Set(ids).size === ids.length, 'Each registration may appear only once'),
});
export type SetSeedingInput = z.infer<typeof setSeedingSchema>;

export const randomizeSeedingSchema = z.object({ seed: z.number().int().min(1).optional() });
export type RandomizeSeedingInput = z.infer<typeof randomizeSeedingSchema>;

export const scheduleMatchSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  reason: z.string().trim().max(300).optional(),
});
export type ScheduleMatchInput = z.infer<typeof scheduleMatchSchema>;

export interface MatchSideDto {
  registrationId: string;
  teamId: string;
  teamName: string;
  seed: number | null;
  checkedIn: boolean;
}

export interface MatchSummaryDto {
  id: string;
  key: string;
  tournamentId: string;
  bracket: 'W' | 'L' | 'GF';
  round: number;
  roundName: string;
  position: number;
  status: string;
  bestOf: number;
  scheduledAt: string | null;
  checkInOpensAt: string | null;
  checkInDeadline: string | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerSlot: 'A' | 'B' | null;
  isBye: boolean;
  version: number;
  a: MatchSideDto | null;
  b: MatchSideDto | null;
  winnerToMatchId: string | null;
  loserToMatchId: string | null;
}

export interface RoundDto {
  id: string;
  bracket: 'W' | 'L' | 'GF';
  number: number;
  name: string;
  bestOf: number;
  matches: MatchSummaryDto[];
}

export interface StageDto {
  id: string;
  name: string;
  format: string;
  status: string;
  rounds: RoundDto[];
}

export interface StandingDto {
  registrationId: string;
  teamId: string;
  teamName: string;
  seed: number | null;
  wins: number;
  losses: number;
  placement: number | null;
  eliminated: boolean;
}

export interface BracketDto {
  tournamentId: string;
  status: string;
  championTeamId: string | null;
  stages: StageDto[];
}
