import { readinessSchema, type Readiness } from '@ksm/shared';

/**
 * The browser always calls the API on the same origin under /api; Next.js
 * forwards those requests to the API server (see next.config.ts). This keeps
 * session cookies first-party (decision A-003).
 */
export const API_BASE = '/api/v1';

/** Readiness answers 503 with a valid body when the database is down. */
export async function fetchReadiness(signal?: AbortSignal): Promise<Readiness> {
  const response = await fetch(`${API_BASE}/health/ready`, {
    signal,
    cache: 'no-store',
  });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Unexpected status ${response.status}`);
  }
  return readinessSchema.parse(await response.json());
}
