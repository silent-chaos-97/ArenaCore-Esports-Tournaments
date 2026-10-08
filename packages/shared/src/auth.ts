import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Invalid email address' }));

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const displayNameSchema = z.string().trim().min(2).max(40);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Code must be 6 digits');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  mfaCode: otpCodeSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaCodeBodySchema = z.object({ code: otpCodeSchema });
export type MfaCodeInput = z.infer<typeof mfaCodeBodySchema>;

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  playerId: string | null;
  memberships: MembershipSummary[];
}

export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  MFA_ENROLMENT_REQUIRED: 'MFA_ENROLMENT_REQUIRED',
  SESSION_INVALID: 'SESSION_INVALID',
} as const;
