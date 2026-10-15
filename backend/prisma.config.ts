import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma no longer loads .env automatically. Load the repository-root .env
// for local development when it exists; CI and containers pass real env vars.
const rootEnv = resolve(import.meta.dirname, '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not need a database, so a missing DATABASE_URL is
  // only an error for commands that connect (migrate, db).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
