import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../backend/src/app.module.js';
import { configureApp } from '../../../backend/src/app.setup.js';

/** Default to the docker compose database; CI overrides DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ksm:ksm_local_password@localhost:5432/ksm?schema=public';

/**
 * Boots the real API (same pipeline as main.ts) against the given database.
 * Environment is set before the module compiles because config is validated
 * when the ConfigModule provider is created.
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    WEB_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'false',
    MAIL_TRANSPORT: 'memory',
    // Tests deliver queued email explicitly with drainOutbox().
    OUTBOX_WORKER: 'off',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  // Listening once lets supertest reuse the server; otherwise each request
  // opens and closes its own, and overlapping requests break.
  await app.listen(0, '127.0.0.1');
  return app;
}
