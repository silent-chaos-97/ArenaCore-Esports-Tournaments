import { z } from 'zod';
import { REGISTRATION_STATUSES } from './states.js';

export const rosterEntrySchema = z.object({
  playerId: z.uuid(),
  role: z.enum(['CAPTAIN', 'PLAYER', 'SUBSTITUTE']),
});
export type RosterEntry = z.infer<typeof rosterEntrySchema>;

const rosterSchema = z
  .array(rosterEntrySchema)
  .min(1)
  .max(20)
  .refine(
    (r) => new Set(r.map((m) => m.playerId)).size === r.length,
    'Each player may appear only once',
  );

export const submitRegistrationSchema = z.object({
  teamId: z.uuid(),
  members: rosterSchema,
  acceptRules: z.literal(true, { message: 'You must accept the tournament rules' }),
  rulesVersion: z.number().int().min(1),
});
export type SubmitRegistrationInput = z.infer<typeof submitRegistrationSchema>;

export const updateRosterSchema = submitRegistrationSchema.omit({ teamId: true });
export type UpdateRosterInput = z.infer<typeof updateRosterSchema>;

export const rejectRegistrationSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type RejectRegistrationInput = z.infer<typeof rejectRegistrationSchema>;

export const listRegistrationsQuerySchema = z.object({
  status: z.enum(REGISTRATION_STATUSES).optional(),
});

export interface RosterValidationError {
  code:
    | 'NOT_TEAM_MEMBER'
    | 'INACTIVE_MEMBER'
    | 'STARTER_COUNT'
    | 'TOO_MANY_SUBSTITUTES'
    | 'MISSING_GAME_ACCOUNT'
    | 'UNDER_MIN_AGE'
    | 'MISSING_DATE_OF_BIRTH'
    | 'PLAYER_SUSPENDED'
    | 'ALREADY_ON_ROSTER'
    | 'CAPTAIN_COUNT';
  message: string;
  playerId?: string;
}

export interface RegistrationMemberDto {
  playerId: string;
  displayName: string;
  role: string;
  gameAccountId: string | null;
  gameUsername: string | null;
}

export interface RegistrationDto {
  id: string;
  tournamentId: string;
  tournamentName: string;
  teamId: string;
  teamName: string;
  status: string;
  seed: number | null;
  rulesVersion: number | null;
  validationErrors: RosterValidationError[];
  rejectionReason: string | null;
  checkedInAt: string | null;
  createdAt: string;
  version: number;
  members: RegistrationMemberDto[];
}
