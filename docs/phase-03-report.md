# Phase 03 Report — Dynamic Roles, Permissions and Staff Invitations

| Field | Value |
|---|---|
| Date | 2026-10-15 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |
| Branch | `phase-03-rbac-invitations` (on top of Phase 02) |

## 1. What was inspected

AGENTS.md sections 7 and 8, the security model (sections 4 to 6 and 12), the data model (authorization and reliability tables), acceptance criteria AC-03, the decision register (D-005, A-007, A-013, A-014) and the Phase 02 code: the access guard, the shop-scoped Prisma client, membership checks, the audit service and the mail service.

## 2. What changed

**API (`backend`)**

- **Permission catalog (A-015):** 44 shop permissions and 4 platform permissions, defined once in `packages/shared` and inserted into the `permissions` table by the migration. A database trigger refuses platform permissions on shop roles. See `docs/security/permission-catalog.md`.
- **Permission checks:** every route now declares who may use it (`@Public`, `@SignedIn`, `@ShopScoped`, `@RequirePermission(code)` or `@OwnerOnly`). A route that declares nothing is refused. Permissions are loaded from the database on every shop request, so changes apply immediately. The signed-in session now lists the caller's permissions for the active shop.
- **Owners (A-016):** owners hold every shop permission through the existing owner flag. Only owners can change other owners or appoint new ones, and a shop always keeps one active owner.
- **Roles (A-017):** each new shop starts with Manager, Cashier and Storekeeper roles, which owners can edit or delete. Custom roles can be created, edited and deleted. A role that is assigned or on a pending invitation cannot be deleted.
- **No escalation:** nobody can create, edit, delete or assign a role, or suspend or remove a member, unless they hold every permission involved.
- **Members:** list, change roles, suspend, reactivate, remove, and appoint or demote owners (`/shops/current/members`).
- **Invitations (`/shops/current/invitations`, `/invitations/preview`, `/invitations/accept`):**
  - 32-byte tokens stored as SHA-256 hashes, valid 7 days and single-use;
  - can be resent (new link, at most 5 times) and cancelled;
  - acceptance needs a signed-in user with the same email;
  - removed members can be invited back;
  - one pending invitation per email (A-018);
  - seats are checked when inviting and accepting (interim `SEAT_LIMIT` setting until plans exist, D-005).
- **Email outbox (A-007):** every email (sign-up, password reset, invitation) is queued in the same transaction as the change and delivered by a worker with retries. Message bodies, which hold one-time links, are removed once sent or abandoned.
- **Audit log:** role, member and invitation changes are recorded, and `GET /shops/current/audit-logs` lists the shop's entries for holders of `audit.read`.
- **Settings:** `OUTBOX_WORKER`, `OUTBOX_POLL_MS`, `SEAT_LIMIT`, and `RATE_LIMIT_MULTIPLIER` (browser tests only; logged as a warning when above 1).

**Web (`apps/web`)**

- **Team page (`/team`):** members with their roles, invite staff, pending invitations (resend, cancel), and roles with a permission editor grouped by area. Buttons appear only when the user has the permission; the API checks every action again.
- **Invitation page (`/invitations/accept`):** shows the shop and inviter, asks the invitee to sign in or create an account with the invited email, then joins the shop. The link is kept for the browser tab while they sign in, and the home page offers to continue.
- Sign-in can return to the page that asked for it (same-site paths only). All new text is in English and Kiswahili, including every permission label.

**Tests:** 61 new integration tests, 2 new browser journeys (on desktop and mobile), and new unit tests for the shared catalog, settings and web helpers. Details below.

**Docs:** this report, permission catalog (new), migration status, data model, security model, acceptance criteria AC-03, decision register (A-015 to A-018 added; A-007, A-013, A-014 and D-005 annotated), README, OpenAPI.

## 3. Database changes

Migration `20261015063853_rbac_and_invitations` (additive):

- enums `PermissionScope`, `InvitationStatus`, `OutboxStatus`;
- tables `permissions` (48 rows), `roles`, `role_permissions`, `membership_roles`, `invitations`, `invitation_roles`, `outbox_messages`;
- composite foreign keys that keep roles, members and invitations inside one shop;
- trigger `role_permissions_shop_scope_only`.

Applied to a brand-new database from a clean clone and by the Docker Compose migrate job. Shops created before this migration have no default roles; there are no production shops yet.

## 4. Tests executed

All run from a clean clone against a new database; full commands in `docs/migration-status.md`.

| Suite | Passed |
|---|---|
| Unit (shared) | 22 |
| Unit (backend) | 23 |
| Component and unit (web) | 14 |
| Integration (real PostgreSQL) | 127 |
| End-to-end (desktop and mobile Chromium, real SMTP to Mailpit) | 18 |

Lint, typecheck, format, architecture rules (129 modules, no violations), migration drift check and OpenAPI export all passed. The same 18 browser tests also passed against the Docker Compose stack.

## 5. Security and tenant-isolation checks

`tests/integration/rbac.int-spec.ts` and `invitations.int-spec.ts` show:

- **Allowed and forbidden:** each protected route is refused to a member whose role lacks its permission (403 `permission_denied`) and allowed to one whose role has only that permission.
- **Changes apply at once:** removing a role, editing a role, suspending or removing a member all take effect on the next request.
- **No escalation:**
  - a role cannot be created or edited with permissions the actor lacks;
  - a role holding more than the actor cannot be edited or deleted by them;
  - a user manager cannot assign the Manager role or suspend or remove someone who holds more than they do;
  - an inviter cannot invite into a role they could not hold.
- **Platform permissions:** never listed to shops, refused by the API, and refused by the database trigger when written directly.
- **Owners:** non-owners with every permission still cannot touch an owner or appoint one; the last owner cannot be removed, suspended or demoted.
- **Cross-tenant:** another shop's role, member and invitation ids answer 404 on every route and are never changed; lists show only the active shop; the database refuses a role from another shop even when written directly.
- **Invitations:**
  - the stored value is the token's hash;
  - unknown, revoked, expired and used tokens are refused with distinct answers;
  - a different account cannot accept;
  - two simultaneous accepts create one membership;
  - resending replaces the old link;
  - the resend and seat limits hold.
- **Outbox:** retries, gives up after 5 attempts, removes message bodies, recovers a crashed claim, and two workers draining together send each message once.

Two deliberate breakages confirmed the tests catch real failures: ignoring the required permission made 12 tests fail, and turning off the escalation check made 6 fail. Both changes were reverted.

## 6. Outstanding issues and decisions

1. **Phase 02 is not in `main`.** PR #1 went into `main`, but PR #2 was merged into the `phase-01-dev-environment` branch (its base at the time). The Phase 03 pull request targets `main`, so it carries Phase 02 as well; merging it brings `main` up to date.
2. **Still awaiting your answer** on the Phase 02 decision card (A-002, A-003, D-012, SMTP email). They stay "Proposed".
3. **New proposals (FYI):** A-015 (catalog in code and database), A-016 (owner flag instead of an Owner role), A-017 (default Manager, Cashier and Storekeeper roles and their permissions) and A-018 (one pending invitation per email, enforced in the service). A-007 (outbox) is now in use.
4. **D-005 seat limits** are still open. Until plans exist, `SEAT_LIMIT` applies one optional limit to all shops (unset means unlimited).
5. **Permission cache:** permissions are read from the database on every shop request. This is two small queries per request; a short cache can be added if load requires it.
6. **Kiswahili strings,** including the new permission labels, need review by a native speaker.
7. **Carried over from Phase 02:** production email provider not chosen; security headers not yet set; the API port must stay private when `TRUST_PROXY` is above 0.

## 7. Acceptance criteria (AC-03)

| Criterion | Status |
|---|---|
| Every protected endpoint declares its permission; a test fails if one does not | Met (`routes.int-spec.ts`) |
| Allowed and forbidden tests for each permission | Met for every permission used by a route today; later phases add theirs |
| An actor cannot create or assign a role with permissions they lack | Met |
| Platform permissions never appear in the shop catalog and cannot be assigned | Met (API and database trigger) |
| Invitation tokens hashed; expired, revoked, used and wrong-email tokens rejected | Met |
| Seat limit enforced at invite and at acceptance | Met with the interim `SEAT_LIMIT` setting |
| Role and membership changes apply on the next request and are audited | Met |
| The last owner cannot be removed or demoted | Met |

## 8. Phase 04 readiness

**Recommended next phase:** Phase 04, plans and subscriptions.

Blockers:

- **D-005** (plan names, prices, features, seat limits, grace period and restricted mode) and **D-019** (trial period) must be decided first.
- **D-006** (mobile-money provider and how payments are confirmed) is needed for paying for a subscription.
- Accept Phase 03 and merge it, which also brings Phase 02 into `main`.
