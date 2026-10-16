# Phase 02 Report — Authentication and Shop Isolation

| Field | Value |
|---|---|
| Date | 2026-10-15 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |
| Branch | `phase-02-auth-tenancy` (stacked on Phase 01, PR #1) |

## 1. What was inspected

AGENTS.md, the security model (sections 3, 4 and 12), the data model (identity and tenancy), acceptance criteria AC-02, the decision register (A-002, A-003, D-012, A-007) and the Phase 01 code. Prisma 7, NestJS 12 and Next.js 16 documentation was checked for client extensions, guards and the App Router.

## 2. What changed

**API (`backend`)**

- **Accounts:** registration, email verification, resend verification, sign-in, sign-out, forgot password and reset password (`/api/v1/auth/*`).
- **Sessions (A-003):** opaque token in an `HttpOnly`, `SameSite=Lax` cookie with the `__Host-` prefix over HTTPS. Only a SHA-256 hash is stored. Idle timeout 12 hours, absolute 7 days. A password reset signs out every device.
- **Shops:** `POST /shops` creates a shop with the caller as owner and makes it active. `GET /shops` lists the caller's shops. `GET` and `PATCH /shops/current` act on the active shop; `PATCH` is owner-only until Phase 03. `GET /shops/current/members` lists the active shop's members. `PUT /auth/session/active-shop` switches shop after a membership check.
- **Shop isolation (A-002):**
  - the active shop lives in the server-side session and the membership is re-checked on every request;
  - no route accepts a shop id;
  - `scopedToShop()` confines Prisma queries on shop-owned models to one shop and refuses unclassified models.
- **Abuse protection:**
  - PostgreSQL-backed rate limits on every public auth endpoint (A-013), plus a 15-minute lock after 10 failed sign-ins for one email;
  - identical answers for known and unknown emails;
  - a required `X-Requested-With` header on state-changing requests (CSRF);
  - deny-by-default access, so only the eight listed routes are public.
- **Audit log:** append-only table (enforced by a database trigger) recording sign-in events, shop creation, shop updates (before and after) and shop switches.
- **Email (A-014):** SMTP through nodemailer. Mailpit catches it locally and in CI. Links carry the token in the URL fragment so it never reaches server logs.

**Web (`apps/web`)**

- Pages: sign-in, register, confirm email (with resend), forgot password, reset password, create shop, and a home page with the active shop, a shop picker and switcher, and sign-out. The status page moved to `/status`.
- Forms use React Hook Form with the shared Zod schemas, so the browser and the API apply the same limits. All text is in English and Kiswahili.

**Shared (`packages/shared`):** auth limits, the CSRF header, Zod schemas for every form, and the session and shop response types.

**Tests**

- Integration (real PostgreSQL), 58 new:
  - registration, verification, sessions, recovery, lockout and rate limits;
  - cross-tenant reads and writes, manipulated identifiers, revoked and suspended memberships, a suspended shop and a non-owner update;
  - the tenant-scoped client, including a check that every Prisma model is classified;
  - a route inventory proving deny-by-default.
- Playwright: full owner journey, refused sign-ins, password reset through real email, and a cross-shop attempt.
- Web unit tests for the API client and token handling.

**Infrastructure:** CI and Docker Compose run Mailpit. `.env.example` documents the session, proxy and mail settings.

**Docs:** this report, migration status, data model, security model (as-built notes), acceptance criteria AC-02, decision register (A-002, A-003 and D-012 annotated; A-013 and A-014 added), README.

## 3. Database changes

Migration `20261015055844_auth_and_tenancy` (additive): enums `UserStatus`, `AuthTokenPurpose`, `BusinessType`, `ShopStatus`, `MembershipStatus`; tables `users`, `sessions`, `auth_tokens`, `shops`, `shop_memberships`, `audit_logs`, `rate_limit_counters`; the `audit_logs_append_only` trigger. Applied to a brand-new database from a clean clone and by the compose migrate job.

## 4. Tests executed

All run from a clean clone against a new database; full commands in `docs/migration-status.md`.

| Suite | Passed |
|---|---|
| Unit (shared) | 16 |
| Unit (backend) | 21 |
| Component and unit (web) | 9 |
| Integration (real PostgreSQL) | 66 |
| End-to-end (desktop and mobile Chromium, real SMTP to Mailpit) | 14 |

Lint, typecheck, format, architecture rules (107 modules, no violations), migration drift check and OpenAPI export all passed. The same 14 end-to-end tests also passed against the Docker Compose stack.

## 5. Security and tenant-isolation checks

The tests in `tests/integration/tenancy.int-spec.ts` show:

- every protected route answers 401 without a session;
- forged, oversized and hash-valued cookies answer 401;
- a user cannot switch into another user's shop, and gets the same 404 as for an unknown shop;
- shop ids in query strings, headers and paths are ignored;
- a `shopId` or `id` in a request body is rejected;
- an active shop planted directly in the session row is refused and cleared;
- removed and suspended memberships, and suspended shops, lose access on the next request;
- staff cannot change shop details;
- one shop's update never touches another shop.

A negative test that disabled the membership check made four of these tests fail, as intended. Other checks:

- `tenant-scope.int-spec.ts` shows the scoped client cannot read, update, move or create rows in another shop, even with an `OR` in the filter.
- Audit rows cannot be updated or deleted.
- Session and password material never appears in responses, and logs already redact cookies and tokens (Phase 01).

## 6. Outstanding issues and decisions

1. **Awaiting your answer** on the Phase 02 decision card:
   - A-003: sessions in a cookie;
   - A-002: application-level isolation, with row-level security left for later;
   - D-012: email-only login;
   - SMTP for email.
   The phase was built on the recommended answers. They stay "Proposed" until you approve them.
2. **A-013 and A-014 (FYI, proposed):** rate limits stored in PostgreSQL; email over SMTP with the provider still to choose.
3. **Production email provider and sending domain** are not chosen yet (needed before launch).
4. **Security headers** (CSP, HSTS and others in security model section 10) are not yet set. Recommended with Phase 11 hardening or earlier if the app is exposed publicly.
5. **TRUST_PROXY:** with the default of 1, the API port must only be reachable through the web app; otherwise clients can choose the IP that rate limits see.
6. **AC-02, automatic enforcement:** cross-tenant tests cover every current shop route. Making the build fail when a new shop route lacks a permission arrives with Phase 03.
7. **Email delivery is inline:** a failed send is logged and the user can request a new link. The outbox (A-007) replaces this in Phase 03.
8. **Kiswahili strings** need review by a native speaker, as in Phase 01.

## 7. Acceptance criteria (AC-02)

| Criterion | Status |
|---|---|
| Register, verify email, login, logout, password reset work end-to-end | Met (integration and Playwright through Mailpit) |
| Argon2id; tokens stored only as hashes and single-use | Met (integration tests check the stored hash and reuse) |
| Login and reset rate-limited; no account enumeration | Met |
| Another shop's resource returns 404 and no data | Met (no route takes a shop id; switching to another shop returns 404) |
| Client-sent `shopId` ignored unless a member | Met (query and header ignored; body rejected; switch validated) |
| Cross-tenant tests for every shop-scoped endpoint, enforced by an architecture test | Partly met: tests exist for every current endpoint; enforcement arrives in Phase 03 |
| Logout invalidates the session server-side | Met |

## 8. Phase 03 readiness

**Recommended next phase:** Phase 03, dynamic roles, permissions and staff invitations.

Before starting it:

- Answer the Phase 02 decision card (A-002, A-003, D-012, email).
- Decide **D-005**, at least the seat limits per plan, because invitations check seats. Without it Phase 03 can build roles and invitations with no seat limit and add the check in Phase 04.
- Approve **A-007** (PostgreSQL outbox), which Phase 03 uses to send invitation emails reliably.
- Accept Phase 01 (PR #1, CI green) and Phase 02.
