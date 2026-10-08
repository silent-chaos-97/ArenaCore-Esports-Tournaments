import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

/**
 * Loads the repo-root .env, points DATABASE_URL at a dedicated `<db>_test` database,
 * creates it when missing and applies migrations. Workers inherit the env.
 */
export default async function setup(): Promise<void> {
  const envFile = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const url = new URL(process.env.DATABASE_URL!);
  const dbName = `${url.pathname.slice(1)}_test`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  url.pathname = `/${dbName}`;
  process.env.DATABASE_URL = url.toString();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: resolve(import.meta.dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}
