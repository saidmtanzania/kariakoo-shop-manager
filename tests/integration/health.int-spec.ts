import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readinessSchema } from '@ksm/shared';
import { createTestApp } from './helpers/app.js';

describe('Health endpoints (real PostgreSQL)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health answers without touching the database', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /api/v1/health/ready reports the database up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(readinessSchema.parse(res.body)).toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('applied the initial migration (citext extension present)', async () => {
    const { PrismaService } =
      await import('../../backend/src/database/prisma.service.js');
    const prisma = app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'citext'`;
    expect(rows).toHaveLength(1);
  });

  it('unknown routes return RFC 9457 problem details with a trace id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .set('x-request-id', 'trace-abc-123')
      .expect(404)
      .expect('content-type', /application\/problem\+json/);
    expect(res.body).toMatchObject({
      status: 404,
      code: 'not_found',
      instance: '/api/v1/does-not-exist',
      traceId: 'trace-abc-123',
    });
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('allows CORS only for the configured web origin', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );

    const other = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not advertise the framework', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Health endpoints (database unavailable)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Port 1 on localhost refuses connections immediately.
    app = await createTestApp({
      DATABASE_URL: 'postgresql://ksm:wrong@127.0.0.1:1/ksm?schema=public',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('liveness still answers 200', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('readiness answers 503 with the database marked down', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503);
    expect(readinessSchema.parse(res.body)).toMatchObject({
      status: 'unavailable',
      checks: { database: 'down' },
    });
  });
});
