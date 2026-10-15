import pg from 'pg';

/**
 * Every browser session in a run comes from the same address, so clear the
 * per-IP sign-up and sign-in counters left by earlier runs. Nothing else is
 * reset: tests use unique emails and never depend on an empty database.
 */
export default async function globalSetup(): Promise<void> {
  const client = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://ksm:ksm_local_password@localhost:5432/ksm?schema=public',
  });
  await client.connect();
  try {
    await client.query('DELETE FROM rate_limit_counters');
  } finally {
    await client.end();
  }
}
