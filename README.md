# Kariakoo Shop Manager

A shop-management PWA for wholesalers and retailers in Kariakoo, Dar es Salaam: sales, stock, purchases, customer credit, cashier closing, staff permissions and subscriptions.

> **Status:** Phase 03 (roles, permissions and staff invitations). Accounts, shops, staff invitations, custom roles and the Team screen work; subscriptions come next, then products, stock and sales. See [`docs/migration-status.md`](docs/migration-status.md) for progress and [`AGENTS.md`](AGENTS.md) for the engineering rules every change follows.

## Stack

| Part | Technology |
|---|---|
| Web app (`apps/web`) | Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, next-intl (English, Kiswahili) |
| API (`backend`) | NestJS 12 (ESM), TypeScript, Prisma 7 with the `pg` driver adapter, pino logging, OpenAPI |
| Database | PostgreSQL 17 |
| Shared contracts (`packages/shared`) | Zod schemas and types that are safe for both sides |
| Tests (`tests`) | Vitest + Supertest (integration), Playwright (end-to-end), dependency-cruiser (architecture) |
| Tooling | pnpm workspaces, Docker Compose, oxlint (API), ESLint (web), Prettier, GitHub Actions |

## Prerequisites

- Node.js 22 (`.nvmrc`) with Corepack enabled: `corepack enable`
- pnpm 10.28 or later (Corepack installs the pinned version)
- Docker with Compose v2

## First-time setup

```bash
cp .env.example .env            # local placeholders only, never real secrets
pnpm install                    # also generates the Prisma client
docker compose up -d postgres mailpit   # PostgreSQL on :5432, Mailpit on :1025 / :8025
pnpm db:migrate                 # apply migrations
pnpm dev                        # API on :4000, web on :3000
```

Open http://localhost:3000 and create an account. The confirmation email arrives in Mailpit at http://localhost:8025. http://localhost:3000/status shows whether the server and database are reachable. Swagger UI is at http://localhost:4000/api/docs when `SWAGGER_ENABLED=true`.

## Running everything in containers

```bash
docker compose up -d --build
```

This starts PostgreSQL, a one-off migration job, the API, the web app and Mailpit (email catcher, UI on http://localhost:8025). The web container forwards `/api/*` to the API, so the browser only ever talks to one origin.

## Scripts (run from the repository root)

| Command | What it does |
|---|---|
| `pnpm dev` | Builds shared contracts, then runs the API and web app in watch mode |
| `pnpm build` | Production builds of shared, API and web |
| `pnpm lint` | oxlint (API, shared, tests) and ESLint (web) |
| `pnpm typecheck` | TypeScript checks in every package |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm test` | Unit and component tests |
| `pnpm test:integration` | API tests against a real PostgreSQL (needs `docker compose up -d postgres` and `pnpm db:migrate`) |
| `pnpm test:architecture` | Module-boundary rules |
| `pnpm test:e2e` | Playwright tests on desktop and mobile Chromium (needs PostgreSQL, Mailpit and `pnpm build`) |
| `pnpm db:migrate` | `prisma migrate deploy` |
| `pnpm db:reset` | Drops and recreates the local database, then reapplies migrations |
| `pnpm openapi:export` | Writes `docs/api/openapi.json` (run after `pnpm build`) |

Creating a new migration during development: `pnpm --filter backend db:migrate:dev --name <change>`.

## API conventions

- Everything is under `/api/v1`.
- Errors are RFC 9457 problem details (`application/problem+json`) with a stable `code` and a `traceId` that matches the `x-request-id` response header.
- `GET /api/v1/health` is liveness. `GET /api/v1/health/ready` checks the database and answers `503` when it is unreachable.
- Money and quantities travel as decimal strings, never JSON numbers.
- Sign-in uses a session cookie. Every request that changes something must send `X-Requested-With: XMLHttpRequest`.
- Shop routes act on the active shop stored in the session (`/shops/current`); no route takes a shop id. See the [security model](docs/security/security-model.md).
- Every route declares who may use it (`@Public`, `@SignedIn`, `@ShopScoped`, `@RequirePermission`, `@OwnerOnly`); a route that declares nothing is refused. Permissions are listed in the [permission catalog](docs/security/permission-catalog.md).
- Email is queued in the `outbox_messages` table with the change that causes it and delivered by an in-process worker with retries (`OUTBOX_WORKER`, `OUTBOX_POLL_MS`).

## Repository layout

```
apps/web/            Next.js PWA
backend/             NestJS API (src/common, src/config, src/database, src/modules)
backend/prisma/      Prisma schema and migrations
packages/shared/     Shared, non-sensitive contracts
tests/               integration, e2e and architecture tests
deploy/docker/       Dockerfiles
docs/                Requirements, architecture, security, decisions, status
```

## Documentation

Start with [`AGENTS.md`](AGENTS.md), then the [decision register](docs/decisions/decision-register.md). Requirements, workflows and acceptance criteria are in [`docs/requirements`](docs/requirements); architecture, data model and testing strategy in [`docs/architecture`](docs/architecture).
