'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  inviteSchema,
  PERMISSION_MODULES,
  ROLE_LIMITS,
  type InvitationView,
  type InviteInput,
  type MemberView,
  type PermissionInfo,
  type RoleView,
  type SessionInfo,
} from '@ksm/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Field } from '@/components/forms/field';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { can, errorKey, SESSION_KEY, useSession } from '@/lib/session';

const TEAM_KEY = ['team'] as const;

/**
 * The shop's staff, invitations and roles. What is shown follows the
 * session's permissions; the API checks every action again.
 */
export function TeamView() {
  const t = useTranslations('Team');
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.data === null) router.replace('/login');
    else if (session.data && !session.data.activeShopId) router.replace('/');
  }, [session.data, router]);

  const info = session.data;
  if (!info?.activeShopId) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('title')}…
      </p>
    );
  }

  return (
    <div className="grid w-full max-w-2xl gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">{t('back')}</Link>
        </Button>
      </header>
      {can(info, 'users.read') ? (
        <>
          <MembersSection info={info} />
          {can(info, 'users.invite') ? <InviteSection /> : null}
          <InvitationsSection info={info} />
          <RolesSection info={info} />
        </>
      ) : (
        <Alert>{t('noAccess')}</Alert>
      )}
    </div>
  );
}

function useTeamQuery<T>(name: string, path: string) {
  return useQuery({
    queryKey: [...TEAM_KEY, name],
    queryFn: ({ signal }) => apiFetch<T>(path, { signal }),
  });
}

function useRoles() {
  return useTeamQuery<{ roles: RoleView[] }>('roles', '/shops/current/roles');
}

/** Runs a change, shows its error, and refreshes the team and session. */
function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setPending(true);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorKey(err));
      return false;
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TEAM_KEY }),
        queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
      ]);
      setPending(false);
    }
  };
  return { run, error, pending };
}

function ErrorAlert({ code }: { code: string | null }) {
  const t = useTranslations('Errors');
  return code ? <Alert variant="destructive">{t(code)}</Alert> : null;
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>
            <h2 className="text-lg font-semibold">{title}</h2>
          </CardTitle>
          {action}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-3">{children}</CardContent>
    </Card>
  );
}

/** Checkbox list used for role and permission choices. */
function CheckList<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-8 items-center gap-2 text-sm"
          htmlFor={`${name}-${o.value}`}
        >
          <input
            id={`${name}-${o.value}`}
            type="checkbox"
            className="size-4"
            checked={value.includes(o.value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, o.value]
                  : value.filter((v) => v !== o.value),
              )
            }
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

// ---- Members ----

function MembersSection({ info }: { info: SessionInfo }) {
  const t = useTranslations('Team');
  const members = useTeamQuery<{ members: MemberView[] }>(
    'members',
    '/shops/current/members',
  );
  const active = (members.data?.members ?? []).filter(
    (m) => m.status !== 'REMOVED',
  );
  return (
    <Section title={t('members')}>
      <ul className="grid divide-y" data-testid="members">
        {active.map((m) => (
          <MemberRow key={m.membershipId} member={m} info={info} />
        ))}
      </ul>
    </Section>
  );
}

function MemberRow({
  member,
  info,
}: {
  member: MemberView;
  info: SessionInfo;
}) {
  const t = useTranslations('Team');
  const { run, error, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isSelf = member.userId === info.user.id;
  const actorIsOwner = Boolean(
    info.memberships.find((m) => m.shopId === info.activeShopId)?.isOwner,
  );
  const canManage =
    can(info, 'users.manage') && !isSelf && (actorIsOwner || !member.isOwner);
  const base = `/shops/current/members/${member.membershipId}`;

  return (
    <li className="grid gap-2 py-3" data-testid={`member-${member.email}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="font-medium">
            {member.fullName}
            {isSelf ? ` (${t('you')})` : ''}
          </span>
          <span className="text-muted-foreground text-sm">{member.email}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {member.isOwner ? <Badge>{t('owner')}</Badge> : null}
          {member.status !== 'ACTIVE' ? (
            <Badge variant="destructive">{t(`status.${member.status}`)}</Badge>
          ) : null}
          {member.isOwner ? null : member.roles.length === 0 ? (
            <Badge variant="outline">{t('noRoles')}</Badge>
          ) : (
            member.roles.map((r) => (
              <Badge key={r.id} variant="secondary">
                {r.name}
              </Badge>
            ))
          )}
        </div>
      </div>
      <ErrorAlert code={error} />
      {editing ? (
        <RolePicker
          name={`member-${member.membershipId}`}
          initial={member.roles.map((r) => r.id)}
          submitLabel={t('saveRoles')}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSubmit={async (roleIds) => {
            if (
              await run(() =>
                apiFetch(`${base}/roles`, { method: 'PUT', body: { roleIds } }),
              )
            ) {
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {canManage && !member.isOwner ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {t('editRoles')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void run(() =>
                  apiFetch(`${base}/status`, {
                    method: 'PUT',
                    body: {
                      status:
                        member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                    },
                  }),
                )
              }
            >
              {member.status === 'ACTIVE' ? t('suspend') : t('reactivate')}
            </Button>
          ) : null}
          {canManage ? (
            confirmRemove ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    void run(() => apiFetch(base, { method: 'DELETE' }))
                  }
                >
                  {t('confirmRemove', { name: member.fullName })}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmRemove(false)}
                >
                  {t('cancel')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRemove(true)}
              >
                {t('remove')}
              </Button>
            )
          ) : null}
          {actorIsOwner && member.status === 'ACTIVE' ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void run(() =>
                  apiFetch(`${base}/owner`, {
                    method: 'PUT',
                    body: { isOwner: !member.isOwner },
                  }),
                )
              }
            >
              {member.isOwner ? t('removeOwner') : t('makeOwner')}
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

function RolePicker({
  name,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  name: string;
  initial: string[];
  submitLabel: string;
  pending: boolean;
  onSubmit: (roleIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations('Team');
  const roles = useRoles();
  const [selected, setSelected] = useState(initial);
  return (
    <div className="grid gap-3">
      <CheckList
        name={name}
        legend={t('inviteRoles')}
        options={(roles.data?.roles ?? []).map((r) => ({
          value: r.id,
          label: r.name,
        }))}
        value={selected}
        onChange={setSelected}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => void onSubmit(selected)}
        >
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

// ---- Invitations ----

function InviteSection() {
  const t = useTranslations();
  const roles = useRoles();
  const { run, error } = useAction();
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleIds: [] },
  });
  const { errors, isSubmitting } = form.formState;
  const roleIds = useWatch({ control: form.control, name: 'roleIds' });

  const onSubmit = form.handleSubmit(async (values) => {
    setSent(null);
    if (
      await run(() =>
        apiFetch('/shops/current/invitations', {
          method: 'POST',
          body: values,
        }),
      )
    ) {
      setSent(values.email);
      form.reset();
    }
  });

  return (
    <Section title={t('Team.inviteTitle')} description={t('Team.inviteHint')}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {sent ? <Alert>{t('Team.inviteSent', { email: sent })}</Alert> : null}
        <ErrorAlert code={error} />
        <Field
          id="invite-email"
          type="email"
          autoComplete="off"
          label={t('Fields.email')}
          error={errors.email && t('Validation.email')}
          {...form.register('email')}
        />
        <CheckList
          name="invite-role"
          legend={t('Team.inviteRoles')}
          options={(roles.data?.roles ?? []).map((r) => ({
            value: r.id,
            label: r.name,
          }))}
          value={roleIds}
          onChange={(next) =>
            form.setValue('roleIds', next, { shouldValidate: true })
          }
        />
        {errors.roleIds ? (
          <p className="text-destructive text-sm">{t('Team.selectRole')}</p>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {t('Team.sendInvite')}
        </Button>
      </form>
    </Section>
  );
}

function InvitationsSection({ info }: { info: SessionInfo }) {
  const t = useTranslations('Team');
  const invitations = useTeamQuery<{ invitations: InvitationView[] }>(
    'invitations',
    '/shops/current/invitations',
  );
  const rows = invitations.data?.invitations ?? [];
  return (
    <Section title={t('invitations')}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noInvitations')}</p>
      ) : (
        <ul className="grid divide-y" data-testid="invitations">
          {rows.map((inv) => (
            <InvitationRow
              key={inv.id}
              invitation={inv}
              canInvite={can(info, 'users.invite')}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function InvitationRow({
  invitation,
  canInvite,
}: {
  invitation: InvitationView;
  canInvite: boolean;
}) {
  const t = useTranslations('Team');
  const format = useFormatter();
  const { run, error, pending } = useAction();
  const [resent, setResent] = useState(false);
  const open =
    invitation.status === 'PENDING' || invitation.status === 'EXPIRED';
  const base = `/shops/current/invitations/${invitation.id}`;
  return (
    <li
      className="grid gap-2 py-3"
      data-testid={`invitation-${invitation.email}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="font-medium">{invitation.email}</span>
          <span className="text-muted-foreground text-sm">
            {invitation.roles.map((r) => r.name).join(', ')}
            {invitation.status === 'PENDING'
              ? ` · ${t('expires', { date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'medium' }) })}`
              : ''}
          </span>
        </div>
        <Badge
          variant={invitation.status === 'PENDING' ? 'default' : 'secondary'}
        >
          {t(`invitationStatus.${invitation.status}`)}
        </Badge>
      </div>
      <ErrorAlert code={error} />
      {resent ? <Alert>{t('resent')}</Alert> : null}
      {canInvite && open ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              setResent(false);
              if (
                await run(() => apiFetch(`${base}/resend`, { method: 'POST' }))
              )
                setResent(true);
            }}
          >
            {t('resend')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              void run(() => apiFetch(`${base}/revoke`, { method: 'POST' }))
            }
          >
            {t('revoke')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// ---- Roles ----

function RolesSection({ info }: { info: SessionInfo }) {
  const t = useTranslations('Team');
  const roles = useRoles();
  const [creating, setCreating] = useState(false);
  const canManage = can(info, 'roles.manage');
  return (
    <Section
      title={t('roles')}
      action={
        canManage && !creating ? (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            {t('newRole')}
          </Button>
        ) : null
      }
    >
      {creating ? <RoleEditor onDone={() => setCreating(false)} /> : null}
      <ul className="grid divide-y" data-testid="roles">
        {(roles.data?.roles ?? []).map((role) => (
          <RoleRow key={role.id} role={role} canManage={canManage} />
        ))}
      </ul>
    </Section>
  );
}

function RoleRow({ role, canManage }: { role: RoleView; canManage: boolean }) {
  const t = useTranslations('Team');
  const [editing, setEditing] = useState(false);
  const { run, error, pending } = useAction();
  if (editing) {
    return (
      <li className="py-3">
        <RoleEditor role={role} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="grid gap-2 py-3" data-testid={`role-${role.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="font-medium">{role.name}</span>
          <span className="text-muted-foreground text-sm">
            {t('memberCount', { count: role.memberCount })} ·{' '}
            {t('permissionCount', { count: role.permissions.length })}
          </span>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              {t('editRole')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void run(() =>
                  apiFetch(`/shops/current/roles/${role.id}`, {
                    method: 'DELETE',
                  }),
                )
              }
            >
              {t('deleteRole')}
            </Button>
          </div>
        ) : null}
      </div>
      <ErrorAlert code={error} />
    </li>
  );
}

function RoleEditor({ role, onDone }: { role?: RoleView; onDone: () => void }) {
  const t = useTranslations();
  const catalog = useTeamQuery<{ permissions: PermissionInfo[] }>(
    'permissions',
    '/shops/current/permissions',
  );
  const { run, error, pending } = useAction();
  const [name, setName] = useState(role?.name ?? '');
  const [permissions, setPermissions] = useState<string[]>(
    role?.permissions ?? [],
  );
  const [nameError, setNameError] = useState(false);
  const idBase = role ? `role-${role.id}` : 'role-new';

  const byModule = PERMISSION_MODULES.map((module) => ({
    module,
    options: (catalog.data?.permissions ?? [])
      .filter((p) => p.module === module)
      .map((p) => ({
        value: p.code as string,
        label: t(`Permissions.${p.code}`),
      })),
  })).filter((g) => g.options.length > 0);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > ROLE_LIMITS.nameMax) {
          setNameError(true);
          return;
        }
        setNameError(false);
        const body = { name: trimmed, permissions };
        const ok = await run(() =>
          role
            ? apiFetch(`/shops/current/roles/${role.id}`, {
                method: 'PUT',
                body,
              })
            : apiFetch('/shops/current/roles', { method: 'POST', body }),
        );
        if (ok) onDone();
      }}
    >
      <ErrorAlert code={error} />
      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-name`}>{t('Team.roleName')}</Label>
        <Input
          id={`${idBase}-name`}
          value={name}
          maxLength={ROLE_LIMITS.nameMax}
          aria-invalid={nameError || undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {nameError ? (
          <p className="text-destructive text-sm">
            {t('Team.roleNameRequired')}
          </p>
        ) : null}
      </div>
      <p className="text-sm font-medium">{t('Team.rolePermissions')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {byModule.map((group) => (
          <CheckList
            key={group.module}
            name={`${idBase}-perm`}
            legend={t(`PermissionModules.${group.module}`)}
            options={group.options}
            value={permissions}
            onChange={setPermissions}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('Team.saveRole')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('Team.cancel')}
        </Button>
      </div>
    </form>
  );
}
