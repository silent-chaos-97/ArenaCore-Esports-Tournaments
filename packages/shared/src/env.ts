import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
  MFA_ISSUER: z.string().default('ArenaCore'),
  /** AUTH-02: Owner/Admin actions require an MFA-verified session when enabled. */
  MFA_ENFORCED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Key material for encrypting secrets at rest (e.g. TOTP seeds). */
  DATA_ENCRYPTION_KEY: z.string().min(32),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('dev'),
  S3_SECRET_KEY: z.string().default('dev'),
  S3_EVIDENCE_BUCKET: z.string().default('arenacore-evidence'),
  S3_ASSETS_BUCKET: z.string().default('arenacore-assets'),
  /** Shared secret used to verify game-provider webhook signatures (HMAC-SHA256). */
  GAME_WEBHOOK_SECRET: z.string().min(16).default('dev-game-webhook-secret'),
  /** Optional platform-wide Discord webhook for organizer alerts (per-org webhooks are post-MVP). */
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('ArenaCore <no-reply@arenacore.local>'),
  DISABLE_RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid API environment:\n${issues}`);
  }
  return result.data;
}
