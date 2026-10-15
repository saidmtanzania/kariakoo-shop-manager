import {
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  readinessSchema,
  type Readiness,
} from '@ksm/shared';

/**
 * The browser always calls the API on the same origin under /api; Next.js
 * forwards those requests to the API server (see next.config.ts). This keeps
 * session cookies first-party (decision A-003).
 */
export const API_BASE = '/api/v1';

/** An RFC 9457 problem response, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Calls the API with the session cookie and the CSRF header the API requires
 * on every state-changing request. Returns the parsed JSON body, or
 * undefined for 204 responses.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
      headers: {
        [CSRF_HEADER]: CSRF_HEADER_VALUE,
        ...(init.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Network error');
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = (body ?? {}) as { code?: unknown; detail?: unknown };
    throw new ApiError(
      response.status,
      typeof problem.code === 'string' ? problem.code : 'generic',
      typeof problem.detail === 'string' ? problem.detail : response.statusText,
    );
  }
  return body as T;
}

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
