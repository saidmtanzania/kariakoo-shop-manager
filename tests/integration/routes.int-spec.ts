import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import {
  ACCESS_LEVEL_KEY,
  OWNER_ONLY_KEY,
  PERMISSION_KEY,
} from '../../backend/src/common/auth/access.decorators.js';
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
  'POST /api/v1/invitations/preview',
].sort();

/**
 * Shop routes that any member may use. Every other shop route must name the
 * permission it needs (or be owner-only), so a new route cannot quietly be
 * open to every member.
 */
const ANY_MEMBER_SHOP_ROUTES = [
  'GET shops/current',
  'GET shops/current/permissions',
].sort();

interface DeclaredRoute {
  route: string;
  level: string | undefined;
  permission: string | undefined;
  ownerOnly: boolean;
}

/** Every controller method with the access it declares. */
function declaredRoutes(app: INestApplication): DeclaredRoute[] {
  const reflector = app.get(Reflector);
  const controllers = [...app.get(ModulesContainer).values()].flatMap((m) => [
    ...m.controllers.values(),
  ]);
  return controllers.flatMap(({ metatype }) => {
    if (!metatype) return [];
    const prefix = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const proto = metatype.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter(
        (name) => name !== 'constructor' && typeof proto[name] === 'function',
      )
      .map((name) => proto[name] as () => unknown)
      .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
      .map((handler) => {
        const method =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as number
          ];
        const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        const targets = [handler, metatype];
        return {
          route: `${method} ${[prefix, path].filter((p) => p && p !== '/').join('/')}`,
          level: reflector.getAllAndOverride<string>(ACCESS_LEVEL_KEY, targets),
          permission: reflector.getAllAndOverride<string>(
            PERMISSION_KEY,
            targets,
          ),
          ownerOnly:
            reflector.getAllAndOverride<boolean>(OWNER_ONLY_KEY, targets) ??
            false,
        };
      });
  });
}

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

  it('every controller method declares who may use it', () => {
    const routes = declaredRoutes(app);
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((r) => !r.level).map((r) => r.route)).toEqual([]);
  });

  it('every shop route names a permission or is owner-only, except the listed ones', () => {
    const open = declaredRoutes(app)
      .filter((r) => r.level === 'shop' && !r.permission && !r.ownerOnly)
      .map((r) => r.route)
      .sort();
    expect(open).toEqual(ANY_MEMBER_SHOP_ROUTES);
  });
});
