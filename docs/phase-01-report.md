# Phase 01 Report — Repository and Development Environment

| Field | Value |
|---|---|
| Date | 2026-10-15 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |

## 1. What was inspected

`AGENTS.md`, the decision register, migration status, system architecture and testing strategy from Phase 00. No repository or code existed before this phase. Current major versions of every framework were checked on the npm registry before choosing them, and the official NestJS and Next.js project generators were run to follow their current conventions.

## 2. What changed

- **Workspace:** pnpm workspaces with one lockfile; Node.js 22 pinned in `.nvmrc` and `engines`; root scripts for dev, build, lint, typecheck, tests, migrations and OpenAPI export.
- **API (`backend`):** NestJS 12 with:
  - environment validation that stops the process with one clear message;
  - pino structured logging with credential redaction and an `x-request-id` trace id;
  - RFC 9457 problem-details errors;
  - a whitelisting `ValidationPipe`, CORS limited to the web origin, and no `x-powered-by` header;
  - `/api/v1` URI versioning and OpenAPI, with Swagger UI behind a flag and an export to `docs/api/openapi.json`;
  - liveness (`/api/v1/health`) and readiness (`/api/v1/health/ready`, 503 when the database is down) endpoints.
- **Database:** Prisma 7 with the `pg` driver adapter and lazy connections, so the API can start and report "not ready" without a database. One migration enables the `citext` extension. The schema has no business models.
- **Web (`apps/web`):** Next.js 16 with:
  - Tailwind CSS 4 and shadcn/ui foundations (theme tokens, `cn` helper, Badge and Card);
  - TanStack Query and next-intl with English and Kiswahili message files;
  - a status page showing whether the server and database are reachable;
  - `/api/*` forwarded to the API so the browser only talks to one origin, which keeps future session cookies first-party.
- **Shared (`packages/shared`):** Zod contracts for the health responses, plus decimal-string schemas for money and quantities.
- **Tests (`tests`):**
  - Vitest integration tests with Supertest against real PostgreSQL;
  - Playwright smoke tests on desktop Chrome and a Pixel 7 profile;
  - dependency-cruiser architecture rules: no cycles, no web-to-backend imports, private module internals, and the Prisma client usable only by the data-access layer.
- **Containers:**
  - Docker Compose runs postgres, a one-off migrate job, the API, the web app and Mailpit;
  - multi-stage Dockerfiles run as a non-root user, and the web image uses Next.js standalone output.
- **CI:** a GitHub Actions workflow runs format, lint, typecheck, unit tests, architecture tests, migrations on a clean database, a drift check, integration tests, build, Playwright and a report-only dependency audit.
- **Docs:** README, this report, migration status, decision register (A-010 to A-012 added; A-004, A-005 and A-008 annotated), testing strategy and AGENTS.md (runner note).

## 3. Files

About 90 files; the Phase 01 pull request lists them all. Key paths: `backend/src/**`, `backend/prisma/**`, `apps/web/src/**`, `packages/shared/src/**`, `tests/**`, `deploy/docker/*.Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`.

## 4. Database changes

Migration `20261015053259_init_extensions` creates the `citext` extension. No tables.

## 5. Tests executed

All tests were run from a clean clone against a brand-new database. Full table in `docs/migration-status.md`. Totals:

| Suite | Passed |
|---|---|
| Unit (shared) | 12 |
| Unit (backend) | 12 |
| Component (web) | 3 |
| Integration | 8 |
| End-to-end | 4 |

Architecture rules: no violations. Lint, typecheck and format all passed.

## 6. Security and tenant-isolation checks

There are no tenant-scoped endpoints yet. The following were checked:

- Secrets stay out of the repository: only `.env.example`, which holds placeholders, is committed, and `.env*` is ignored.
- Logs redact `authorization`, `cookie`, `set-cookie`, `password` and `token` fields.
- Unexpected errors return a generic 500 with no internal message. A unit test asserts this.
- CORS allows only the configured origin. An integration test asserts this.
- The framework header is removed.
- Containers run as the `node` user.
- An architecture rule keeps the Prisma client inside the data-access layer, so tenant scoping can later be enforced in one place.

## 7. Outstanding issues and decisions

1. **A-010 (approval needed):** Vitest replaces Jest, because NestJS 12 is published as ES modules only. Everything else in the testing plan is unchanged.
2. **A-011 and A-012 (FYI, proposed):** linters per app, and the runtime and version choices. These include PostgreSQL 17 and TypeScript 6.0.
3. **A-004, A-005 and A-008** remain proposed. Phase 01 used them as written.
4. **Not yet run on GitHub:** CI has not run. The Dockerfiles have only been built through a sandbox certificate workaround (see `migration-status.md`).
5. **shadcn/ui CLI:** the registry was unreachable from this sandbox, so the base setup and two components were added by hand in the CLI's standard layout. `pnpm dlx shadcn@latest add <component>` works normally on a developer machine.
6. **ESLint 9:** the web app stays on ESLint 9, which pnpm flags as deprecated, until `eslint-config-next` supports ESLint 10.
7. **Kiswahili strings:** the initial strings in `apps/web/messages/sw.json` should be reviewed by a native speaker.

## 8. Acceptance criteria (AC-01)

| Criterion | Status |
|---|---|
| Clean clone → documented commands install, start PostgreSQL, run Prisma migrate, start API and web | Met (verified) |
| `/api/v1/health` 200; `/api/v1/health/ready` reports DB and returns 503 when DB is down | Met (verified manually and by integration tests) |
| Invalid/missing env stops the API at boot with a clear message | Met (verified) |
| Lint, type-check, unit tests pass in a CI-equivalent command; results recorded | Met locally. GitHub CI is still to run on the first push. |
| Lockfile committed; no secrets in the repository | Met |

## 9. Phase 02 readiness

**Recommended next phase:** Phase 02, authentication and shop isolation.

Before starting it:

- Approve or change **A-003**: server-side sessions in HttpOnly cookies.
- Approve or change **A-002**: application-level tenant scoping, plus a decision on whether to add PostgreSQL Row-Level Security as defence in depth.
- Confirm **D-012**: email and password login only in the first release.
- Choose an email provider for verification and password-reset emails. Mailpit covers local development.
- Accept Phase 01, including A-010.

Phase 02 does not depend on D-005 (plans) or D-006 (payment provider).
