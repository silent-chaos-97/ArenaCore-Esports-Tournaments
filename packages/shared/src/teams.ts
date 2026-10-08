import { z } from 'zod';
import { emailSchema } from './auth.js';
import { TEAM_MEMBER_ROLES } from './enums.js';

export const updatePlayerSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 country code')
    .nullable()
    .optional(),
  dateOfBirth: z.iso.date().nullable().optional(),
});
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

export const linkGameAccountSchema = z.object({
  gameId: z.uuid(),
  externalPlayerId: z.string().trim().min(2).max(100),
  username: z.string().trim().min(2).max(60),
  region: z.string().trim().max(20).optional(),
});
export type LinkGameAccountInput = z.infer<typeof linkGameAccountSchema>;

export const teamMemberRoleSchema = z.enum(TEAM_MEMBER_ROLES);

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(50),
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,5}$/, 'Tag must be 2-5 letters or digits')
    .optional(),
  gameId: z.uuid().optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  tag: createTeamSchema.shape.tag.unwrap().nullable().optional(),
  logoUrl: z.url().max(500).nullable().optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const inviteTeamMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(['PLAYER', 'SUBSTITUTE', 'MANAGER']).default('PLAYER'),
});
export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;

export const updateTeamMemberSchema = z
  .object({
    role: teamMemberRoleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Nothing to update');
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

export interface GameDto {
  id: string;
  slug: string;
  name: string;
  platform: string;
}

export interface GameAccountDto {
  id: string;
  gameId: string;
  gameName: string;
  externalPlayerId: string;
  username: string;
  region: string | null;
  verificationStatus: string;
}

export interface PlayerProfileDto {
  id: string;
  userId: string;
  displayName: string;
  country: string | null;
  dateOfBirth: string | null;
  status: string;
  gameAccounts: GameAccountDto[];
}

export interface TeamMemberDto {
  id: string;
  playerId: string;
  displayName: string;
  role: string;
  active: boolean;
  joinedAt: string;
}

export interface TeamDto {
  id: string;
  name: string;
  slug: string;
  tag: string | null;
  logoUrl: string | null;
  gameId: string | null;
  captainId: string;
  status: string;
  members: TeamMemberDto[];
}

export interface TeamInviteDto {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  playerName: string;
  role: string;
  status: string;
  createdAt: string;
}
