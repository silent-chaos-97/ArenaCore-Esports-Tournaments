import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const rootEnv = resolve(import.meta.dirname, '../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import @swc-node/register/esm-register prisma/seed.ts',
  },
  // `prisma generate` (run on install) needs no database; migrate/seed fail clearly without one.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
