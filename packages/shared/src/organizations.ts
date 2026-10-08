import { z } from 'zod';
import { emailSchema } from './auth.js';
import { paginationSchema, slugSchema } from './common.js';
import { ORG_ROLES } from './enums.js';

export const orgRoleSchema = z.enum(ORG_ROLES);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const inviteStaffSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema,
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const acceptInviteSchema = z.object({ token: z.string().min(20).max(200) });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeMemberRoleSchema = z.object({ role: orgRoleSchema });
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const auditQuerySchema = paginationSchema.extend({
  entity: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}
