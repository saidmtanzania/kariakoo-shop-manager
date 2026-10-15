import type { INestApplication } from '@nestjs/common';
import {
  DEFAULT_ROLE_TEMPLATES,
  PERMISSIONS,
  SHOP_PERMISSIONS,
} from '@ksm/shared';
import { PrismaService } from '../../backend/src/database/prisma.service.js';
import { createTestApp } from './helpers/app.js';
import { ownerWithShop, resetDatabase } from './helpers/auth.js';
import { createRole, invite, joinWithRoles, roleId } from './helpers/team.js';

/**
 * Roles and permissions (Phase 03, security model section 6). Permissions
 * come from the database on every request; owners hold every shop
 * permission; nobody can grant what they do not hold.
 */
describe('Roles and permissions (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Awaited<ReturnType<typeof ownerWithShop>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    owner = await ownerWithShop(app, 'owner', 'Owner Traders');
  });
  afterAll(() => app.close());

  const join = (label: string, roleIds: string[]) =>
    joinWithRoles(app, owner, label, roleIds);

  describe('permission catalog', () => {
    it('the database catalog matches the code catalog exactly', async () => {
      const rows = await prisma.permission.findMany({
        orderBy: { code: 'asc' },
      });
      expect(
        rows.map((r) => ({ code: r.code, module: r.module, scope: r.scope })),
      ).toEqual(
        [...PERMISSIONS]
          .map((p) => ({ code: p.code, module: p.module, scope: p.scope }))
          .sort((a, b) => (a.code < b.code ? -1 : 1)),
      );
    });

    it('lists only shop permissions to shops', async () => {
      const res = await owner.agent
        .get('/api/v1/shops/current/permissions')
        .expect(200);
      const codes = (res.body.permissions as { code: string }[]).map(
        (p) => p.code,
      );
      expect(codes.sort()).toEqual([...SHOP_PERMISSIONS].sort());
      expect(codes.some((c) => c.startsWith('platform.'))).toBe(false);
    });

    it('the database refuses platform permissions on a shop role', async () => {
      const id = await roleId(owner.agent, 'Manager');
      await expect(
        prisma.rolePermission.create({
          data: {
            shopId: owner.shopId,
            roleId: id,
            permissionCode: 'platform.shops.manage',
          },
        }),
      ).rejects.toThrow(/cannot be granted to a shop role/);
    });
  });

  describe('default roles and session permissions', () => {
    it('a new shop starts with the Manager, Cashier and Storekeeper roles', async () => {
      const res = await owner.agent
        .get('/api/v1/shops/current/roles')
        .expect(200);
      const roles = res.body.roles as { name: string; permissions: string[] }[];
      expect(roles.map((r) => r.name).sort()).toEqual([
        'Cashier',
        'Manager',
        'Storekeeper',
      ]);
      for (const template of DEFAULT_ROLE_TEMPLATES) {
        const role = roles.find((r) => r.name === template.name)!;
        expect(role.permissions.sort()).toEqual(
          [...template.permissions].sort(),
        );
      }
    });

    it('owners hold every shop permission; a cashier holds only the role permissions', async () => {
      const ownerSession = await owner.agent
        .get('/api/v1/auth/session')
        .expect(200);
      expect(ownerSession.body.permissions.sort()).toEqual(
        [...SHOP_PERMISSIONS].sort(),
      );

      const cashier = await join('cashier', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      const session = await cashier.agent
        .get('/api/v1/auth/session')
        .expect(200);
      const template = DEFAULT_ROLE_TEMPLATES.find((t) => t.key === 'cashier')!;
      expect(session.body.permissions.sort()).toEqual(
        [...template.permissions].sort(),
      );
    });

    it('a member with two roles holds the union of both', async () => {
      const a = await createRole(owner, 'Reader', ['users.read']);
      const b = await createRole(owner, 'Auditor', ['audit.read']);
      const member = await join('both', [a, b]);
      const session = await member.agent
        .get('/api/v1/auth/session')
        .expect(200);
      expect(session.body.permissions.sort()).toEqual([
        'audit.read',
        'users.read',
      ]);
    });
  });

  describe('allowed and forbidden operations', () => {
    /** Each protected route, the permission it needs, and a request body. */
    const ROUTES = [
      {
        perm: 'users.read',
        method: 'get',
        path: '/api/v1/shops/current/members',
        ok: 200,
      },
      {
        perm: 'users.read',
        method: 'get',
        path: '/api/v1/shops/current/roles',
        ok: 200,
      },
      {
        perm: 'users.read',
        method: 'get',
        path: '/api/v1/shops/current/invitations',
        ok: 200,
      },
      {
        perm: 'audit.read',
        method: 'get',
        path: '/api/v1/shops/current/audit-logs',
        ok: 200,
      },
      {
        perm: 'settings.manage',
        method: 'patch',
        path: '/api/v1/shops/current',
        body: { name: 'Renamed' },
        ok: 200,
      },
      {
        perm: 'roles.manage',
        method: 'post',
        path: '/api/v1/shops/current/roles',
        body: { name: 'Empty', permissions: [] },
        ok: 201,
      },
    ] as const;

    it.each(ROUTES)('$method $path needs $perm', async (route) => {
      const holder = await join('holder', [
        await createRole(owner, 'Only', [route.perm]),
      ]);
      const other = await join('other', [
        await createRole(owner, 'Other', [
          route.perm === 'users.read' ? 'audit.read' : 'users.read',
        ]),
      ]);

      const denied = await other.agent[route.method](route.path).send(
        'body' in route ? route.body : undefined,
      );
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('permission_denied');

      const allowed = await holder.agent[route.method](route.path).send(
        'body' in route ? route.body : undefined,
      );
      expect(allowed.status).toBe(route.ok);
    });

    it('a member with no roles can open the shop but nothing protected', async () => {
      const member = await join('noroles', [
        await createRole(owner, 'Temp', []),
      ]);
      await member.agent.get('/api/v1/shops/current').expect(200);
      await member.agent.get('/api/v1/shops/current/permissions').expect(200);
      const res = await member.agent
        .get('/api/v1/shops/current/members')
        .expect(403);
      expect(res.body.code).toBe('permission_denied');
    });

    it('removing a role applies on the very next request', async () => {
      const reader = await createRole(owner, 'Reader', ['users.read']);
      const empty = await createRole(owner, 'Empty', []);
      const member = await join('changing', [reader]);
      await member.agent.get('/api/v1/shops/current/members').expect(200);

      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/roles`)
        .send({ roleIds: [empty] })
        .expect(200);
      await member.agent.get('/api/v1/shops/current/members').expect(403);
    });

    it('editing a role changes what its members can do immediately', async () => {
      const reader = await createRole(owner, 'Reader', ['users.read']);
      const member = await join('edited', [reader]);
      await member.agent.get('/api/v1/shops/current/audit-logs').expect(403);
      await owner.agent
        .put(`/api/v1/shops/current/roles/${reader}`)
        .send({ name: 'Reader', permissions: ['users.read', 'audit.read'] })
        .expect(200);
      await member.agent.get('/api/v1/shops/current/audit-logs').expect(200);
    });

    it('suspended and removed members lose access at once', async () => {
      const member = await join('suspended', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(204);
      const res = await member.agent.get('/api/v1/shops/current').expect(403);
      expect(res.body.code).toBe('shop_access_revoked');

      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/status`)
        .send({ status: 'ACTIVE' })
        .expect(204);
      await member.agent
        .put('/api/v1/auth/session/active-shop')
        .send({ shopId: owner.shopId })
        .expect(204);
      await member.agent.get('/api/v1/shops/current').expect(200);

      await owner.agent
        .delete(`/api/v1/shops/current/members/${member.membershipId}`)
        .expect(204);
      await member.agent.get('/api/v1/shops/current').expect(403);
      const members = await owner.agent
        .get('/api/v1/shops/current/members')
        .expect(200);
      const row = members.body.members.find(
        (m: { membershipId: string }) => m.membershipId === member.membershipId,
      );
      expect(row?.status ?? 'REMOVED').toBe('REMOVED');
      expect(row?.roles ?? []).toEqual([]);
    });
  });

  describe('privilege escalation', () => {
    async function roleManager() {
      return join('rolemgr', [
        await createRole(owner, 'Role admin', ['roles.manage', 'users.read']),
      ]);
    }

    it('cannot create a role with permissions the creator does not hold', async () => {
      const mgr = await roleManager();
      const res = await mgr.agent
        .post('/api/v1/shops/current/roles')
        .send({ name: 'Super', permissions: ['users.read', 'settings.manage'] })
        .expect(403);
      expect(res.body.code).toBe('permission_escalation');
      await mgr.agent
        .post('/api/v1/shops/current/roles')
        .send({ name: 'Viewer', permissions: ['users.read'] })
        .expect(201);
    });

    it('cannot grant itself more by editing its own role', async () => {
      const mgr = await roleManager();
      const own = await roleId(owner.agent, 'Role admin');
      const res = await mgr.agent
        .put(`/api/v1/shops/current/roles/${own}`)
        .send({
          name: 'Role admin',
          permissions: ['roles.manage', 'users.read', 'users.manage'],
        })
        .expect(403);
      expect(res.body.code).toBe('permission_escalation');
    });

    it('cannot edit or delete a role that holds permissions it lacks', async () => {
      const mgr = await roleManager();
      const manager = await roleId(owner.agent, 'Manager');
      const edit = await mgr.agent
        .put(`/api/v1/shops/current/roles/${manager}`)
        .send({ name: 'Manager', permissions: ['users.read'] })
        .expect(403);
      expect(edit.body.code).toBe('permission_escalation');
      const del = await mgr.agent
        .delete(`/api/v1/shops/current/roles/${manager}`)
        .expect(403);
      expect(del.body.code).toBe('permission_escalation');
    });

    it('rejects platform and unknown permissions on a role', async () => {
      for (const code of ['platform.shops.manage', 'made.up']) {
        const res = await owner.agent
          .post('/api/v1/shops/current/roles')
          .send({ name: `Bad ${code}`, permissions: [code] })
          .expect(400);
        expect(res.body.code).toBe('bad_request');
      }
    });

    it('a user manager cannot assign roles beyond their own permissions', async () => {
      const userMgr = await join('usermgr', [
        await createRole(owner, 'People', ['users.read', 'users.manage']),
      ]);
      const target = await join('target', [
        await createRole(owner, 'Empty', []),
      ]);
      const res = await userMgr.agent
        .put(`/api/v1/shops/current/members/${target.membershipId}/roles`)
        .send({ roleIds: [await roleId(owner.agent, 'Manager')] })
        .expect(403);
      expect(res.body.code).toBe('permission_escalation');
    });

    it('a user manager cannot suspend or strip someone who holds more than they do', async () => {
      const userMgr = await join('usermgr', [
        await createRole(owner, 'People', ['users.read', 'users.manage']),
      ]);
      const manager = await join('manager', [
        await roleId(owner.agent, 'Manager'),
      ]);
      const res = await userMgr.agent
        .put(`/api/v1/shops/current/members/${manager.membershipId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(403);
      expect(res.body.code).toBe('permission_escalation');
      await userMgr.agent
        .delete(`/api/v1/shops/current/members/${manager.membershipId}`)
        .expect(403);
    });

    it('nobody but an owner can change, remove or appoint an owner', async () => {
      const all = await createRole(owner, 'Everything', [...SHOP_PERMISSIONS]);
      const admin = await join('admin', [all]);
      const ownerRow = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members.find((m: { isOwner: boolean }) => m.isOwner);

      const suspend = await admin.agent
        .put(`/api/v1/shops/current/members/${ownerRow.membershipId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(403);
      expect(suspend.body.code).toBe('owner_protected');
      const roles = await admin.agent
        .put(`/api/v1/shops/current/members/${ownerRow.membershipId}/roles`)
        .send({ roleIds: [all] })
        .expect(403);
      expect(roles.body.code).toBe('owner_protected');

      const appoint = await admin.agent
        .put(`/api/v1/shops/current/members/${admin.membershipId}/owner`)
        .send({ isOwner: true })
        .expect(403);
      expect(appoint.body.code).toBe('owner_required');
    });

    it('the last active owner cannot be removed, suspended or demoted', async () => {
      const ownerRow = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members[0];
      for (const req of [
        owner.agent
          .put(`/api/v1/shops/current/members/${ownerRow.membershipId}/owner`)
          .send({ isOwner: false }),
        owner.agent
          .put(`/api/v1/shops/current/members/${ownerRow.membershipId}/status`)
          .send({ status: 'SUSPENDED' }),
        owner.agent.delete(
          `/api/v1/shops/current/members/${ownerRow.membershipId}`,
        ),
      ]) {
        const res = await req;
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('last_owner');
      }
    });

    it('an owner can appoint a second owner, who can then step the first one down', async () => {
      const member = await join('coowner', [
        await roleId(owner.agent, 'Cashier'),
      ]);
      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/owner`)
        .send({ isOwner: true })
        .expect(200);
      const session = await member.agent
        .get('/api/v1/auth/session')
        .expect(200);
      expect(session.body.permissions.length).toBe(SHOP_PERMISSIONS.length);

      const first = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members.find((m: { userId: string }) => m.userId === owner.userId);
      await member.agent
        .put(`/api/v1/shops/current/members/${first.membershipId}/owner`)
        .send({ isOwner: false })
        .expect(200);
      await owner.agent.get('/api/v1/shops/current/members').expect(403);
    });
  });

  describe('role management', () => {
    it('refuses duplicate names, ignoring case', async () => {
      const res = await owner.agent
        .post('/api/v1/shops/current/roles')
        .send({ name: 'manager', permissions: [] })
        .expect(409);
      expect(res.body.code).toBe('role_name_taken');
    });

    it('refuses to delete a role that is assigned or on a pending invitation', async () => {
      const used = await createRole(owner, 'Used', ['users.read']);
      await join('user', [used]);
      expect(
        (
          await owner.agent
            .delete(`/api/v1/shops/current/roles/${used}`)
            .expect(409)
        ).body.code,
      ).toBe('role_in_use');

      const invited = await createRole(owner, 'Invited', ['users.read']);
      await invite(app, owner.agent, 'later@example.test', [invited]);
      expect(
        (
          await owner.agent
            .delete(`/api/v1/shops/current/roles/${invited}`)
            .expect(409)
        ).body.code,
      ).toBe('role_in_use');

      const unused = await createRole(owner, 'Unused', []);
      await owner.agent
        .delete(`/api/v1/shops/current/roles/${unused}`)
        .expect(204);
    });

    it('records role and member changes in the audit log', async () => {
      const role = await createRole(owner, 'Audited', ['users.read']);
      await owner.agent
        .put(`/api/v1/shops/current/roles/${role}`)
        .send({ name: 'Audited', permissions: ['audit.read'] })
        .expect(200);
      const member = await join('audited', [role]);
      await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/status`)
        .send({ status: 'SUSPENDED' })
        .expect(204);

      const res = await owner.agent
        .get('/api/v1/shops/current/audit-logs?limit=50')
        .expect(200);
      const actions = (res.body.entries as { action: string }[]).map(
        (e) => e.action,
      );
      for (const action of [
        'role.created',
        'role.updated',
        'invitation.created',
        'invitation.accepted',
        'member.suspended',
      ]) {
        expect(actions).toContain(action);
      }
      // The list shows who did what; the before and after values stay in the table.
      const updated = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'role.updated', entityId: role },
      });
      expect(updated.before).toMatchObject({ permissions: ['users.read'] });
      expect(updated.after).toMatchObject({ permissions: ['audit.read'] });
    });

    it('pages through the audit log with a cursor', async () => {
      for (let i = 0; i < 3; i += 1) await createRole(owner, `Paged ${i}`, []);
      const first = await owner.agent
        .get('/api/v1/shops/current/audit-logs?limit=2')
        .expect(200);
      expect(first.body.entries).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();
      const second = await owner.agent
        .get(
          `/api/v1/shops/current/audit-logs?limit=2&cursor=${first.body.nextCursor}`,
        )
        .expect(200);
      const ids = [...first.body.entries, ...second.body.entries].map(
        (e: { id: string }) => e.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('cross-tenant access', () => {
    it('ids from another shop are not found, never changed', async () => {
      const other = await ownerWithShop(app, 'rival', 'Rival Wholesale');
      const theirRole = await roleId(other.agent, 'Cashier');
      const { invitationId: theirInvite } = await invite(
        app,
        other.agent,
        'rivalstaff@example.test',
        [theirRole],
      );
      const theirMember = (
        await other.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members[0];

      const attempts = [
        owner.agent
          .put(`/api/v1/shops/current/roles/${theirRole}`)
          .send({ name: 'Hijacked', permissions: [] }),
        owner.agent.delete(`/api/v1/shops/current/roles/${theirRole}`),
        owner.agent
          .put(
            `/api/v1/shops/current/members/${theirMember.membershipId}/status`,
          )
          .send({ status: 'SUSPENDED' }),
        owner.agent
          .put(
            `/api/v1/shops/current/members/${theirMember.membershipId}/owner`,
          )
          .send({ isOwner: false }),
        owner.agent.delete(
          `/api/v1/shops/current/members/${theirMember.membershipId}`,
        ),
        owner.agent.post(
          `/api/v1/shops/current/invitations/${theirInvite}/revoke`,
        ),
        owner.agent.post(
          `/api/v1/shops/current/invitations/${theirInvite}/resend`,
        ),
      ];
      for (const attempt of attempts) expect((await attempt).status).toBe(404);

      // Their role cannot be assigned to our staff or put on our invitations.
      const member = await join('ours', [await roleId(owner.agent, 'Cashier')]);
      const assign = await owner.agent
        .put(`/api/v1/shops/current/members/${member.membershipId}/roles`)
        .send({ roleIds: [theirRole] })
        .expect(404);
      expect(assign.body.code).toBe('role_not_found');
      const inv = await owner.agent
        .post('/api/v1/shops/current/invitations')
        .send({ email: 'x@example.test', roleIds: [theirRole] })
        .expect(404);
      expect(inv.body.code).toBe('role_not_found');

      const roles = (
        await other.agent.get('/api/v1/shops/current/roles').expect(200)
      ).body.roles;
      expect(roles.map((r: { name: string }) => r.name)).toContain('Cashier');
      const invites = (
        await other.agent.get('/api/v1/shops/current/invitations').expect(200)
      ).body.invitations;
      expect(invites[0].status).toBe('PENDING');
    });

    it('lists only the active shop’s roles, members, invitations and audit entries', async () => {
      const other = await ownerWithShop(app, 'rival', 'Rival Wholesale');
      await createRole(other, 'Rival only', []);
      await invite(app, other.agent, 'rivalstaff@example.test', [
        await roleId(other.agent, 'Cashier'),
      ]);

      const roles = (
        await owner.agent.get('/api/v1/shops/current/roles').expect(200)
      ).body.roles;
      expect(roles.map((r: { name: string }) => r.name)).not.toContain(
        'Rival only',
      );
      const invites = (
        await owner.agent.get('/api/v1/shops/current/invitations').expect(200)
      ).body.invitations;
      expect(invites).toEqual([]);
      const members = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members;
      expect(members).toHaveLength(1);
      const audit = (
        await owner.agent.get('/api/v1/shops/current/audit-logs').expect(200)
      ).body.entries;
      expect(
        audit.every(
          (e: { action: string }) => e.action !== 'invitation.created',
        ),
      ).toBe(true);
    });

    it('a role row cannot point at another shop, even written directly', async () => {
      const other = await ownerWithShop(app, 'rival', 'Rival Wholesale');
      const theirRole = await roleId(other.agent, 'Cashier');
      const ours = (
        await owner.agent.get('/api/v1/shops/current/members').expect(200)
      ).body.members[0];
      await expect(
        prisma.membershipRole.create({
          data: {
            shopId: owner.shopId,
            membershipId: ours.membershipId,
            roleId: theirRole,
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.rolePermission.create({
          data: {
            shopId: owner.shopId,
            roleId: theirRole,
            permissionCode: 'users.read',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
