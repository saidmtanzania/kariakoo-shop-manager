import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.js';
import { CSRF, resetDatabase } from './helpers/auth.js';

/**
 * Deny by default: every route requires a session unless it is on this list.
 * Adding a public route means adding it here, which makes the change visible
 * in review.
 */
const PUBLIC_ROUTES = [
  'GET /api/v1/health',
  'GET /api/v1/health/ready',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/resend-verification',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
].sort();

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

function listRoutes(app: INestApplication): string[] {
  const express = app.getHttpAdapter().getInstance() as {
    router: { stack: Layer[] };
  };
  // Skips Nest's catch-all not-found route (a wildcard path).
  return express.router.stack.flatMap((layer) =>
    layer.route && !/[{*]/.test(layer.route.path)
      ? Object.keys(layer.route.methods)
          .filter((m) => m !== '_all')
          .map((m) => `${m.toUpperCase()} ${layer.route!.path}`)
      : [],
  );
}

describe('Route inventory (deny by default)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
  });
  afterAll(() => app.close());

  it('finds the API routes', () => {
    expect(listRoutes(app).length).toBeGreaterThan(PUBLIC_ROUTES.length);
  });

  it('every route outside the public list answers 401 without a session', async () => {
    const reachable: string[] = [];
    for (const route of listRoutes(app)) {
      const [method, path] = route.split(' ') as [string, string];
      const url = path.replace(/:\w+/g, '00000000-0000-7000-8000-000000000000');
      const res = await request(app.getHttpServer())
        [method.toLowerCase() as 'get'](url)
        .set(CSRF)
        .send({});
      if (res.status !== 401) reachable.push(route);
    }
    expect(reachable.sort()).toEqual(PUBLIC_ROUTES);
  });
});
