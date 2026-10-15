import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the repository-root .env for local development when it exists.
 * Containers and CI pass real environment variables instead. Already-set
 * variables are never overridden.
 */
export function loadLocalEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  const file = resolve(import.meta.dirname, '..', '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
