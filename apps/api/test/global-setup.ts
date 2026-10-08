import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repo-root .env so integration tests reach the compose services. */
export default function setup(): void {
  const envFile = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
