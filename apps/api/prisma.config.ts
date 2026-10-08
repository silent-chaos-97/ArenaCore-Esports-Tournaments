import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

const rootEnv = resolve(import.meta.dirname, '../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import @swc-node/register/esm-register prisma/seed.ts',
  },
  datasource: { url: env('DATABASE_URL') },
});
