import { z } from 'zod';
import { TOURNAMENT_FORMATS } from './enums.js';
import { TOURNAMENT_STATUSES } from './states.js';

const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const bestOf = z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7)]);

/** Fields that make up a tournament's configuration (TOUR-01..06). */
export const tournamentSettingsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(5000).nullable().optional(),
  gameId: z.uuid(),
  region: z.string().trim().min(2).max(30),
  platform: z.string().trim().min(2).max(20).default('PC'),
  format: z.enum(TOURNAMENT_FORMATS),
  teamSize: z.number().int().min(1).max(10),
  maxSubstitutes: z.number().int().min(0).max(5).default(0),
  maxTeams: z.number().int().min(2).max(256),
  bestOf: bestOf.default(1),
  finalsBestOf: bestOf.nullable().optional(),
  grandFinalReset: z.boolean().default(true),
  requireApproval: z.boolean().default(true),
  minAge: z.number().int().min(13).max(99).nullable().optional(),
  registrationOpensAt: dateTime,
  registrationClosesAt: dateTime,
  checkInOpensAt: dateTime.nullable().optional(),
  checkInClosesAt: dateTime.nullable().optional(),
  startsAt: dateTime,
  matchCheckInMinutes: z.number().int().min(0).max(120).default(15),
  rules: z.string().max(50_000).default(''),
  prizeInfo: z.string().trim().max(2000).nullable().optional(),
});

export interface ScheduleFields {
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
  startsAt: Date;
}

/** Cross-field schedule rules shared by create, update and publish. */
export function scheduleIssues(s: ScheduleFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (s.registrationOpensAt >= s.registrationClosesAt) {
    issues.push({
      path: 'registrationClosesAt',
      message: 'Registration must close after it opens',
    });
  }
  if (s.registrationClosesAt > s.startsAt) {
    issues.push({
      path: 'registrationClosesAt',
      message: 'Registration must close before the tournament starts',
    });
  }
  if ((s.checkInOpensAt == null) !== (s.checkInClosesAt == null)) {
    issues.push({
      path: 'checkInOpensAt',
      message: 'Provide both check-in opening and closing times',
    });
  }
  if (s.checkInOpensAt && s.checkInClosesAt) {
    if (s.checkInOpensAt >= s.checkInClosesAt) {
      issues.push({ path: 'checkInClosesAt', message: 'Check-in must close after it opens' });
    }
    if (s.checkInClosesAt > s.startsAt) {
      issues.push({
        path: 'checkInClosesAt',
        message: 'Check-in must close before the tournament starts',
      });
    }
  }
  return issues;
}

export const createTournamentSchema = tournamentSettingsSchema.superRefine((value, ctx) => {
  for (const issue of scheduleIssues(value))
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
});
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

/** Partial update: defaults are stripped so omitted fields stay untouched. */
const updateShape = Object.fromEntries(
  Object.entries(tournamentSettingsSchema.shape).map(([key, field]) => [
    key,
    (field instanceof z.ZodDefault ? field.unwrap() : field).optional(),
  ]),
) as unknown as {
  [K in keyof typeof tournamentSettingsSchema.shape]: z.ZodOptional<
    z.ZodType<z.infer<typeof tournamentSettingsSchema>[K]>
  >;
};

export const updateTournamentSchema = z
  .object(updateShape)
  .extend({ version: z.number().int().min(0) });
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

/** Settings frozen once teams have registered or the event is live. */
export const COMPETITIVE_FIELDS = [
  'gameId',
  'region',
  'platform',
  'format',
  'teamSize',
  'maxSubstitutes',
  'requireApproval',
  'minAge',
] as const;

/** Fields that stay editable while a tournament is in progress. */
export const LIVE_EDITABLE_FIELDS = ['description', 'prizeInfo', 'name'] as const;

export const cloneTournamentSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
});
export type CloneTournamentInput = z.infer<typeof cloneTournamentSchema>;

export const cancelTournamentSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelTournamentInput = z.infer<typeof cancelTournamentSchema>;

export const assignStaffSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['ADMIN', 'REFEREE']),
});
export type AssignStaffInput = z.infer<typeof assignStaffSchema>;

export const listTournamentsQuerySchema = z.object({
  status: z.enum(TOURNAMENT_STATUSES).optional(),
});

export interface TournamentDto {
  id: string;
  organizationId: string;
  gameId: string;
  gameName: string;
  name: string;
  slug: string;
  description: string | null;
  region: string;
  platform: string;
  format: string;
  teamSize: number;
  maxSubstitutes: number;
  maxTeams: number;
  bestOf: number;
  finalsBestOf: number | null;
  grandFinalReset: boolean;
  requireApproval: boolean;
  minAge: number | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  checkInOpensAt: string | null;
  checkInClosesAt: string | null;
  startsAt: string;
  matchCheckInMinutes: number;
  status: string;
  rules: string;
  rulesVersion: number;
  prizeInfo: string | null;
  publishedAt: string | null;
  version: number;
  registrationCounts: Record<string, number>;
  lockedFields: string[];
}
