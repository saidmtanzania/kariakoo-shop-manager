# Phase 00 Report — Requirements and Architecture

| Field | Value |
|---|---|
| Date | 2026-10-12 |
| Phase status | **Complete** — D-001 to D-004 approved by Taibi on 2026-10-12 |

## 1. End-of-phase report

1. **Inspected:** the project's shared files (empty — no prior code, docs or migrations); no Git repository is attached to the project; the owner's updated project plan.
2. **Changed:** created the Phase 00 documentation set and the master instructions file.
3. **Files created:**
   - `AGENTS.md`
   - `docs/requirements/product-requirements.md`
   - `docs/requirements/user-workflows.md`
   - `docs/requirements/acceptance-criteria.md`
   - `docs/architecture/system-architecture.md`
   - `docs/architecture/data-model.md`
   - `docs/architecture/testing-strategy.md`
   - `docs/security/security-model.md`
   - `docs/decisions/decision-register.md`
   - `docs/migration-status.md`
   - `docs/phase-00-report.md` (this file)
   - Empty folders `docs/api/`, `docs/runbooks/` reserved for later phases.
4. **Database changes:** none.
5. **Tests executed:** none; no code exists in this phase.
6. **Security and tenant-isolation checks:** design-level only — security model §4 defines enforcement; data model §14 checks that every shop-owned table carries `shop_id` and that composite FKs prevent cross-shop references.
7. **Outstanding issues:** see §3.
8. **Acceptance criteria (AC-00):** documents exist and are consistent ✔; labelling ✔; traceability ✔ (data model §13); owner approval of D-001–D-004 ✔ (2026-10-12); no code created ✔.
9. **Next phase:** Phase 01; blockers in §2.

## 2. Implementation-readiness assessment

| Area | Ready? | Notes |
|---|---|---|
| Phase 01 (repo + environment) | **Ready** once a Git repository exists (D-001–D-004 approved) | Phase 01 depends only on A-004, A-005, A-008 (proposed defaults are safe to adopt). Hosting (D-020) is not needed for local Docker. |
| Phase 02 (auth, tenancy) | Nearly | Needs A-002 (RLS yes/no) and A-003 confirmed, D-012 (email-only login) confirmed. |
| Phase 03 (RBAC, invitations) | Nearly | Permission catalog drafted; seat limits default to unlimited until D-005. Email-sending provider to choose (any SMTP/transactional service). |
| Phase 04 (subscriptions) | **Not ready** | D-005 plans/prices/grace, D-006 payment provider, D-019 trial. Provider research and merchant onboarding take calendar time — start early. |
| Phase 05 (products, inventory) | Ready after D-002, D-007, D-013, D-021 approved | |
| Phase 06 (purchases) | Ready after D-003, D-014, D-015 | |
| Phase 07 (sales/POS) | Not ready | D-006 (POS mobile money), D-008, D-009 (fiscal receipts), D-010, D-011, D-016, D-018. |
| Phase 08 (credit, cash) | Ready after D-017, D-018 | |
| Phase 09 (reports) | Ready after D-003 | |
| Phase 10 (offline) | Ready after D-004 sub-questions | |
| Phase 11–12 | Not ready | D-020 hosting/data residency/retention; pilot shop identified. |

**Feasibility check:** the logical model supports all 16 workflows (data model §13). Financial atomicity, overselling prevention, idempotency and tenant isolation have a concrete, implementable design (system architecture §4.4–4.5, §5). No design blockers found.

**Risks:**
- Mobile-money integration (onboarding, callbacks, reconciliation) is the largest external dependency.
- TRA fiscal-receipt obligations could change POS scope if target shops are VAT-registered.
- Email-only invitations may not fit staff who lack email (D-012).
- Low-end Android performance with large catalogues offline needs early measurement.

## 3. Unresolved business questions

**Approved 2026-10-12:**

1. D-001 — Each shop has its own subscription? (recommended: yes)
2. D-002 — One location in the first release, designed for branches later? (recommended: yes)
3. D-003 — Weighted-average costing? (recommended: yes)
4. D-004 — Controlled offline sales on one device, cash and manual mobile money only, no offline credit sales? (recommended: yes)

**Needed before later phases:**

5. D-005 — Plan names, weekly and monthly prices, features and limits per plan, grace-period length, what restricted mode blocks, reminder channel (SMS or email).
6. D-006 — Which mobile-money provider or aggregator? For POS, is manual reference entry acceptable in the first release?
7. D-009 — Are target shops VAT-registered or required to issue EFD/VFD fiscal receipts?
8. D-012 — Is email-only login acceptable for Kariakoo staff?
9. D-008 — Should cashiers choose wholesale vs retail price, or should it follow customer type or quantity?
10. D-010, D-011 — Discount limit for staff; return window and refund rules.
11. D-013 — Are goods sold in fractions (metres, kilograms)?
12. D-015 — Should transport/porter costs be added to stock cost?
13. D-016, D-017, D-018 — credit limits, partial payments/unallocated receipts, mandatory cashier session.
14. D-019 — Trial length.
15. D-020 — Hosting budget, data residency, record retention.
16. Is there a pilot shop, and roughly how many products, staff and daily sales does it have? (sizes performance targets NFR-1/2)

## 4. Exact Phase 01 prompt

Copy this into the coding agent after the decisions above (at least D-001 to D-004) are approved and a Git repository has been created with this `docs/` folder and `AGENTS.md` committed.

```text
Implement Phase 01 — Repository and development environment — of Kariakoo Shop Manager, using the approved Phase 00 documents.

Before changing anything, read AGENTS.md, docs/decisions/decision-register.md, docs/migration-status.md, docs/architecture/system-architecture.md and docs/architecture/testing-strategy.md, and inspect the whole repository. Report what already exists.

Scope (do not exceed it):
1. Workspace: pnpm workspaces with a single committed lockfile, Node.js LTS pinned (.nvmrc and "engines"), covering apps/web (Next.js, TypeScript, App Router), backend (NestJS, TypeScript) and packages/shared (safe shared types/Zod schemas only). Follow the repository layout in AGENTS.md and the plan (apps/web, backend/src/{common,database,modules}, packages/shared, tests/{integration,e2e,architecture}, deploy/docker, docs, scripts).
2. Backend: NestJS app with global /api/v1 prefix, configuration module with environment validation that fails fast at boot, structured JSON logging (nestjs-pino) without secrets, a global exception filter returning RFC 9457 problem details, global ValidationPipe (whitelist, forbidNonWhitelisted), OpenAPI via @nestjs/swagger served in development and exported to docs/api/openapi.json, and health endpoints: GET /api/v1/health (liveness) and GET /api/v1/health/ready (checks PostgreSQL, returns 503 when unavailable). No business modules.
3. Database: Prisma in backend/prisma with PostgreSQL datasource, a PrismaService with graceful shutdown, and one initial migration containing only infrastructure tables that later phases need generically (none is acceptable — if you add any, justify it in the decision register). Money will be numeric and IDs UUID v7 per A-008; add a small helper or note for this but no business tables.
4. Frontend: Next.js with Tailwind CSS and shadcn/ui initialised, TanStack Query provider, React Hook Form + Zod installed only if used by the placeholder page, i18n scaffolding with en and sw message files, a placeholder page that calls the API health endpoint and shows connected/disconnected states. No business screens.
5. Docker Compose for local development: postgres (pinned major version, named volume, healthcheck), api, worker placeholder only if needed (otherwise omit), web, and mailpit for future email testing. Dockerfiles under deploy/docker. .env.example documenting every variable with safe placeholder values; .gitignore excluding real env files.
6. Quality tooling: ESLint and Prettier shared config, TypeScript strict mode everywhere, type-check scripts, and root scripts: dev, build, lint, typecheck, test, test:integration, test:e2e, db:migrate, db:reset.
7. Tests: one Jest unit test for the backend (config validation), one Supertest integration test hitting /api/v1/health/ready against the Compose PostgreSQL, one frontend component test, one Playwright smoke test that loads the web app and sees the API status, and one architecture test scaffold (e.g. dependency-cruiser) that will later enforce module boundaries.
8. CI workflow file (GitHub Actions) running install with frozen lockfile, lint, typecheck, unit tests, PostgreSQL service + migrations + integration tests, and builds. Do not add deployment.

Verification (run these yourself and record the real output):
- Clean clone → pnpm install --frozen-lockfile
- docker compose up -d → all services healthy
- prisma migrate deploy against a clean database
- pnpm lint, pnpm typecheck, pnpm test, pnpm test:integration, pnpm test:e2e, pnpm build
- Stop PostgreSQL and confirm /health/ready returns 503
- Start the API with a missing required env var and confirm it fails fast with a clear message

Use maintained, compatible dependency versions and install nothing that is not used. Keep secrets out of source control.

Finish by updating docs/migration-status.md (commands, dates, pass/fail counts, anything not run and why), the decision register (mark A-004, A-005, A-008 as approved only if the owner confirmed them; otherwise leave them proposed and note what you used), and README.md with setup instructions. Then give the end-of-phase report required by AGENTS.md §13 and assess Phase 02 readiness. Do not start Phase 02.
```
