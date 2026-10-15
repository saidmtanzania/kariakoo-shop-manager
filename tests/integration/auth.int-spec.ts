import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { hashToken } from '../../backend/src/common/crypto/tokens.js';
import { createTestApp } from './helpers/app.js';
import {
  client,
  lastMailTo,
  PASSWORD,
  resetDatabase,
  signedInUser,
  uniqueEmail,
} from './helpers/auth.js';

const ACCEPTED_MESSAGE =
  'If the details are valid, we have sent an email with the next step.';

describe('Authentication (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDatabase(app));
  afterAll(() => app.close());

  describe('registration and email verification', () => {
    it('registers, emails a verification link and stores only hashes', async () => {
      const email = uniqueEmail('reg');
      const res = await client(app)
        .post('/api/v1/auth/register')
        .send({ fullName: 'Asha Juma', email, password: PASSWORD })
        .expect(202);
      expect(res.body).toEqual({ message: ACCEPTED_MESSAGE });

      const { mail, token } = lastMailTo(app, email);
      expect(mail?.subject).toMatch(/confirm/i);
      expect(mail?.text).toContain('http://localhost:3000/verify-email#token=');
      expect(token).toBeDefined();

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(user.emailVerifiedAt).toBeNull();
      const stored = await prisma.authToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(stored.tokenHash).toBe(hashToken(token!));
    });

    it('answers a duplicate registration the same way and emails the owner instead', async () => {
      const email = uniqueEmail('dup');
      const body = { fullName: 'First', email, password: PASSWORD };
      await client(app).post('/api/v1/auth/register').send(body).expect(202);
      const second = await client(app)
        .post('/api/v1/auth/register')
        .send({ ...body, fullName: 'Attacker', email: email.toUpperCase() })
        .expect(202);
      expect(second.body).toEqual({ message: ACCEPTED_MESSAGE });
      expect(await prisma.user.count()).toBe(1);
      expect(lastMailTo(app, email).mail?.subject).toMatch(
        /already have an account/i,
      );
    });

    it('rejects invalid input with problem details', async () => {
      const res = await client(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: '',
          email: 'not-an-email',
          password: 'short',
          isPlatformAdmin: true,
        })
        .expect(400);
      expect(res.body.code).toBe('bad_request');
    });

    it('blocks sign-in until the email is verified, and verification tokens are single-use', async () => {
      const email = uniqueEmail('verify');
      const agent = client(app);
      await agent
        .post('/api/v1/auth/register')
        .send({ fullName: 'V', email, password: PASSWORD })
        .expect(202);

      const blocked = await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(blocked.body.code).toBe('email_not_verified');

      const { token } = lastMailTo(app, email);
      await agent.post('/api/v1/auth/verify-email').send({ token }).expect(204);
      const reused = await agent
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(400);
      expect(reused.body.code).toBe('invalid_or_expired_token');

      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(204);
    });

    it('rejects an expired verification token', async () => {
      const email = uniqueEmail('expired');
      await client(app)
        .post('/api/v1/auth/register')
        .send({ fullName: 'E', email, password: PASSWORD });
      const { token } = lastMailTo(app, email);
      await prisma.authToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await client(app)
        .post('/api/v1/auth/verify-email')
        .send({ token })
        .expect(400);
    });

    it('resend-verification invalidates the previous link', async () => {
      const email = uniqueEmail('resend');
      await client(app)
        .post('/api/v1/auth/register')
        .send({ fullName: 'R', email, password: PASSWORD });
      const first = lastMailTo(app, email).token;
      await client(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email })
        .expect(202);
      const second = lastMailTo(app, email).token;
      expect(second).not.toBe(first);
      await client(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: first })
        .expect(400);
      await client(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: second })
        .expect(204);
    });
  });

  describe('sessions', () => {
    it('sets an HttpOnly SameSite=Lax session cookie holding an opaque token', async () => {
      const { email } = await signedInUser(app, 'cookie');
      const res = await client(app)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(204);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^ksm_session=[\w-]{43};/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\//);

      const raw = cookie.match(/^ksm_session=([\w-]+);/)![1]!;
      const stored = await prisma.session.findMany({
        where: { tokenHash: hashToken(raw) },
      });
      expect(stored).toHaveLength(1);
      expect(await prisma.session.count({ where: { tokenHash: raw } })).toBe(0);
    });

    it('returns the session for a signed-in user', async () => {
      const { agent, email } = await signedInUser(app, 'me');
      const res = await agent.get('/api/v1/auth/session').expect(200);
      expect(res.body).toMatchObject({
        user: { email },
        activeShopId: null,
        memberships: [],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash/);
    });

    it('gives the same answer for an unknown email and a wrong password', async () => {
      const { email } = await signedInUser(app, 'enum');
      const wrong = await client(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong password' })
        .expect(401);
      const unknown = await client(app)
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('nobody'), password: 'wrong password' })
        .expect(401);
      expect(wrong.body.code).toBe('invalid_credentials');
      expect(unknown.body.code).toBe('invalid_credentials');
      expect(wrong.body.detail).toBe(unknown.body.detail);
    });

    it('logout revokes the session server-side', async () => {
      const { agent } = await signedInUser(app, 'logout');
      const login = await prisma.session.findFirstOrThrow({
        where: { revokedAt: null },
      });
      await agent.post('/api/v1/auth/logout').expect(204);
      await agent.get('/api/v1/auth/session').expect(401);
      const after = await prisma.session.findUniqueOrThrow({
        where: { id: login.id },
      });
      expect(after.revokedAt).not.toBeNull();
    });

    it('rejects idle-expired, absolutely-expired and revoked sessions', async () => {
      const { agent, userId } = await signedInUser(app, 'expiry');
      await prisma.session.updateMany({
        where: { userId },
        data: { idleExpiresAt: new Date(Date.now() - 1) },
      });
      await agent.get('/api/v1/auth/session').expect(401);

      const second = await signedInUser(app, 'absolute');
      await prisma.session.updateMany({
        where: { userId: second.userId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      await second.agent.get('/api/v1/auth/session').expect(401);

      const third = await signedInUser(app, 'revoked');
      await prisma.session.updateMany({
        where: { userId: third.userId },
        data: { revokedAt: new Date() },
      });
      await third.agent.get('/api/v1/auth/session').expect(401);
    });

    it('rejects a disabled user even with a live session', async () => {
      const { agent, userId } = await signedInUser(app, 'disabled');
      await prisma.user.update({
        where: { id: userId },
        data: { status: 'DISABLED' },
      });
      await agent.get('/api/v1/auth/session').expect(401);
    });
  });

  describe('password recovery', () => {
    it('resets the password, signs out every device and the link works once', async () => {
      const { agent, email } = await signedInUser(app, 'reset');
      const res = await client(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(202);
      expect(res.body).toEqual({ message: ACCEPTED_MESSAGE });
      const { token, mail } = lastMailTo(app, email);
      expect(mail?.text).toContain('/reset-password#token=');

      const newPassword = 'a brand new passphrase';
      await client(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: newPassword })
        .expect(204);
      await agent.get('/api/v1/auth/session').expect(401);
      await client(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'another one!' })
        .expect(400);

      await client(app)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      await client(app)
        .post('/api/v1/auth/login')
        .send({ email, password: newPassword })
        .expect(204);
      expect(lastMailTo(app, email).mail?.subject).toMatch(
        /password was changed/i,
      );
    });

    it('answers the same way for an unknown email and sends nothing', async () => {
      const res = await client(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: uniqueEmail('ghost') })
        .expect(202);
      expect(res.body).toEqual({ message: ACCEPTED_MESSAGE });
      expect(await prisma.authToken.count()).toBe(0);
    });

    it('does not accept a verification token as a reset token', async () => {
      const email = uniqueEmail('purpose');
      await client(app)
        .post('/api/v1/auth/register')
        .send({ fullName: 'P', email, password: PASSWORD });
      const { token } = lastMailTo(app, email);
      await client(app)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'new password!' })
        .expect(400);
    });
  });

  describe('abuse protection', () => {
    it('locks an email after 10 failed sign-ins, even with the right password', async () => {
      const { email } = await signedInUser(app, 'lock');
      for (let i = 0; i < 10; i++) {
        await client(app)
          .post('/api/v1/auth/login')
          .send({ email, password: `wrong-${i}-pass` })
          .expect(401);
      }
      const locked = await client(app)
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(429);
      expect(locked.body.code).toBe('rate_limited');
    });

    it('limits sign-in attempts per IP address with Retry-After', async () => {
      let last: request.Response | undefined;
      for (let i = 0; i < 21; i++) {
        last = await client(app)
          .post('/api/v1/auth/login')
          .send({ email: uniqueEmail(`ip${i}`), password: 'whatever pass' });
      }
      expect(last!.status).toBe(429);
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('limits password-reset emails per address', async () => {
      const { email } = await signedInUser(app, 'flood');
      for (let i = 0; i < 3; i++) {
        await client(app)
          .post('/api/v1/auth/password/forgot')
          .send({ email })
          .expect(202);
      }
      await client(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email })
        .expect(429);
    });
  });

  describe('CSRF defence', () => {
    it('rejects state-changing requests without the X-Requested-With header', async () => {
      const { agent } = await signedInUser(app, 'csrf');
      const cookie = (await prisma.session.count()) > 0;
      expect(cookie).toBe(true);
      // A plain cross-site form post cannot set custom headers.
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .type('form')
        .send({ fullName: 'X', email: uniqueEmail('csrf'), password: PASSWORD })
        .expect(403);
      expect(res.body.code).toBe('csrf_header_missing');
      // Safe methods do not need it.
      await agent
        .get('/api/v1/auth/session')
        .unset('x-requested-with')
        .expect(200);
    });
  });

  it('writes an audit trail for sign-in events', async () => {
    const { email, userId } = await signedInUser(app, 'audit');
    await client(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'bad password' })
      .expect(401);
    const actions = (
      await prisma.auditLog.findMany({
        where: { actorUserId: userId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(actions).toEqual([
      'auth.registered',
      'auth.email_verified',
      'auth.login',
      'auth.login_failed',
    ]);
  });

  it('audit logs cannot be changed or deleted', async () => {
    await signedInUser(app, 'immutable');
    await expect(
      prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'x'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_logs`),
    ).rejects.toThrow(/append-only/);
  });
});
