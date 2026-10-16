import type { INestApplication } from '@nestjs/common';
import { lastMailTo, signedInUser, uniqueEmail, type Client } from './auth.js';

export interface Owner {
  agent: Client;
  shopId: string;
}

/** Id of a role in the caller's active shop, by name. */
export async function roleId(agent: Client, name: string): Promise<string> {
  const res = await agent.get('/api/v1/shops/current/roles').expect(200);
  const role = (res.body.roles as { id: string; name: string }[]).find(
    (r) => r.name === name,
  );
  if (!role) throw new Error(`No role named ${name}`);
  return role.id;
}

/** Creates a custom role in the owner's active shop and returns its id. */
export async function createRole(
  owner: Owner,
  name: string,
  permissions: string[],
): Promise<string> {
  const res = await owner.agent
    .post('/api/v1/shops/current/roles')
    .send({ name, permissions })
    .expect(201);
  return res.body.id as string;
}

/** Invites an address and returns the token from the emailed link. */
export async function invite(
  app: INestApplication,
  inviter: Client,
  email: string,
  roleIds: string[],
): Promise<{ invitationId: string; token: string }> {
  const res = await inviter
    .post('/api/v1/shops/current/invitations')
    .send({ email, roleIds })
    .expect(201);
  const { token } = await lastMailTo(app, email);
  if (!token) throw new Error('No invitation email');
  return { invitationId: res.body.id as string, token };
}

/**
 * Brings a new person into the owner's shop through the real invitation
 * flow: invite, register, verify, sign in, accept.
 */
export async function joinWithRoles(
  app: INestApplication,
  owner: Owner,
  label: string,
  roleIds: string[],
) {
  const email = uniqueEmail(label);
  const { token } = await invite(app, owner.agent, email, roleIds);
  const member = await signedInUser(app, label, email);
  await member.agent
    .post('/api/v1/invitations/accept')
    .send({ token })
    .expect(200);
  const members = await owner.agent
    .get('/api/v1/shops/current/members')
    .expect(200);
  const row = (
    members.body.members as { userId: string; membershipId: string }[]
  ).find((m) => m.userId === member.userId);
  if (!row) throw new Error('Member not found after accepting');
  return { ...member, membershipId: row.membershipId };
}
