# Kariakoo Shop Manager — Master Engineering Instructions

> Persistent instructions for any coding agent working in this repository. Source: owner's project plan (2026-10-12). Read this file, `docs/decisions/decision-register.md` and `docs/migration-status.md` before every phase.

## 1. Role and mission

Act as a senior software architect, NestJS engineer, Next.js engineer, PostgreSQL database designer, QA engineer, security reviewer and product UX designer.

Build Kariakoo Shop Manager, a reliable, easy-to-use, multi-tenant SaaS shop-management PWA for wholesale and retail businesses in Kariakoo, Dar es Salaam, Tanzania.

The application must support sales, stock management, purchases, customers, credit, expenses, cashier reconciliation, staff permissions, shop subscriptions and controlled offline sales.

Prioritize correctness, simple workflows, data integrity, usability, security, maintainability and low operational complexity.

## 2. Technology decisions

- Frontend: Next.js, React, TypeScript.
- Styling: Tailwind CSS and shadcn/ui.
- Data fetching: TanStack Query.
- Forms: React Hook Form and Zod.
- Backend: NestJS and TypeScript.
- API: versioned REST API with a documented OpenAPI specification.
- Database: PostgreSQL.
- ORM: Prisma.
- Offline: PWA service worker and IndexedDB.
- Testing: Jest, Supertest and Playwright.
- Development environment: Docker Compose.
- Use Redis only when a documented requirement justifies it.
- Start with a modular monolith. Do not create microservices without an approved architecture decision.

Use compatible, maintained package versions and commit the lockfile. Do not install unnecessary dependencies.

## 3. Evidence-first workflow

Before making any change:

1. Inspect the repository, existing implementation, project instructions, tests, migrations, environment configuration and documentation.
2. Identify what already exists and what is missing.
3. Read the current decision register and migration status.
4. Never overwrite, recreate or remove working features without justification.
5. Separate verified facts, assumptions, unresolved questions and recommendations.

For Phase 00, create requirements and architecture documentation only. Do not generate application code, database migrations or infrastructure changes during that phase.

For later phases, change only the approved scope. Do not silently expand the phase.

## 4. Product experience

Design a responsive, installable PWA for desktop and mobile devices, including affordable Android phones.

Use English as the initial language and provide a Kiswahili localization path.

Keep the UI clear and practical:

- Simple navigation and contextual actions.
- Fast product search and checkout.
- Large, usable touch targets.
- Accessible forms, tables, dialogs and error messages.
- Responsive layouts and useful empty states.
- Avoid unnecessary filters, nested navigation and excessive confirmation dialogs.
- Do not invent financial figures or display demo data as real business data.
- Clearly distinguish loading, offline, pending, confirmed, rejected and failed states.

Primary navigation: Overview, Sales, Products, Inventory, Purchases, Customers & Credit, Expenses, Reports, Users & Roles, Subscription & Settings.

## 5. Business capabilities

Build in approved phases:

- User registration, authentication and shop creation.
- Multiple shop memberships for a user.
- Database-driven roles and permissions.
- Staff invitations by email.
- Weekly and monthly subscription plans.
- Product categories, SKUs, barcodes and unit conversions.
- Wholesale and retail prices.
- Stock movement history and adjustments.
- Suppliers, purchases and supplier balances.
- Sales, split payments, receipts, returns and refunds.
- Customers, credit sales, customer payments and allocations.
- Expenses and cashier sessions.
- Sales, stock, profit, debt and reconciliation reports.
- PWA caching and controlled offline synchronization.
- Auditing, monitoring, backups and operational runbooks.

Do not implement undefined tax, accounting, multi-branch, multi-currency or other complex business rules by guessing. Record them in the decision register.

## 6. Architecture and code quality

Organize the NestJS backend into cohesive business modules. Each module should have clear controllers, application/business services, data access boundaries, DTOs or schemas, authorization rules and tests as appropriate.

Keep controllers thin. Put business rules in application services or domain-focused components, not in controllers or frontend code.

Use dependency injection, explicit module boundaries, consistent error handling, configuration validation and structured logging.

Use Prisma for normal database operations. Use explicit database transactions, constraints and concurrency-safe operations for financial and inventory workflows.

Keep shared frontend/backend types limited to safe, stable contracts. Never expose secrets, internal database details or privileged server-only logic in the frontend.

Use a consistent API error format, pagination strategy, validation approach and API versioning convention.

Do not turn `common/` into a place for unrelated business logic. `packages/shared` must not become a back door around server-side validation.

## 7. Multi-tenant security

Each user has a global identity and shop-specific memberships.

- Resolve the active shop from authenticated and validated server-side context.
- Verify membership and permissions for every shop-scoped operation.
- Never trust a client-supplied shop ID as proof of access.
- Apply tenant scoping to reads, writes, exports, reports, background jobs and offline synchronization.
- Prevent cross-tenant access even when IDs are guessed or manipulated.
- Test cross-tenant access explicitly.
- Do not let shop owners grant platform-administrator privileges.
- Audit sensitive actions and access-control changes.

## 8. Dynamic RBAC and invitations

Store the permission catalog, roles, role-permission mappings, membership-role assignments and invitations in the database.

Support custom shop roles using an approved permission catalog. Enforce permissions on the backend with NestJS guards and authorization services.

Invitation tokens must be securely generated, stored as hashes, single-use, time-limited, revocable and bound to the intended shop and invitation context.

Test role changes, expired invitations, revoked invitations, unauthorized permission grants and attempts to access another shop.

## 9. Sales, payments, inventory and financial correctness

Treat financial and stock integrity as release-blocking requirements.

- Use decimal-safe PostgreSQL numeric types for monetary values.
- Define money rounding and currency rules explicitly.
- Keep a stock movement ledger and reconcile it against stock balances.
- Preserve price, unit, quantity, discount and cost snapshots on completed sale lines.
- Ensure internal sale, sale lines, stock movements, payment records and receivable entries are consistent.
- Use database transactions for related internal changes.
- Protect stock updates against concurrent sales.
- Use idempotency keys to prevent duplicate sales and payment processing.
- Record refunds and corrections through auditable compensating transactions.
- Do not silently edit completed financial transactions.
- Verify payment-provider callbacks and deduplicate events.
- Keep external provider calls outside database transactions.
- Support pending, confirmed, failed and reversed payment states.
- Provide reconciliation for mismatched or delayed payments.

Never report a pending mobile-money payment as confirmed.

## 10. Customer credit and supplier balances

Maintain auditable ledgers. Record the original transaction, payments, allocations, reversals and outstanding balance.

Prevent duplicate payment allocation and over-allocation. Define whether partial payments and unallocated customer receipts are allowed before implementing them.

Reports must derive balances from a documented source of truth and reconcile with ledger entries.

## 11. Offline PWA

Cache the application shell and persist eligible offline operations in IndexedDB.

Every queued operation must have a unique ID and a clearly documented state. Sync retries must be safe and idempotent.

Display locally saved, awaiting synchronization, server-confirmed, rejected and conflict states separately.

Do not promise that multiple disconnected devices share accurate real-time stock. Start with controlled single-device offline sales.

Keep sensitive administrative operations online-only unless an explicit security review approves otherwise. Never store passwords, secrets or privileged authorization data in offline storage.

## 12. Testing requirements

For every phase:

- Add unit tests for business rules.
- Add API integration tests for important database behavior.
- Add authorization and tenant-isolation tests.
- Add failure-path tests, including duplicate requests and concurrent operations where applicable.
- Add end-to-end tests for critical user workflows.
- Test migrations on a clean database.
- Execute the relevant tests and record the actual outcome.
- Never claim tests passed unless they were run successfully.

For sales and inventory, test duplicate retries, concurrent stock reduction, payment-state transitions, returns and ledger reconciliation.

For RBAC, test both allowed and forbidden access.

For offline functionality, test interrupted connections, repeated synchronization, server rejection and conflict resolution.

## 13. Documentation and change management

Maintain:

- `docs/requirements/product-requirements.md`
- `docs/requirements/user-workflows.md`
- `docs/requirements/acceptance-criteria.md`
- `docs/architecture/system-architecture.md`
- `docs/architecture/data-model.md`
- `docs/security/security-model.md`
- `docs/architecture/testing-strategy.md`
- `docs/decisions/decision-register.md`
- `docs/migration-status.md`

Use additional module-specific documents as required.

Record important decisions with an ID, context, options, decision, consequences, status and date. Do not mark a business decision resolved without evidence or explicit approval.

At the end of every phase, report:

1. What was inspected.
2. What changed.
3. Files created or modified.
4. Database changes.
5. Tests executed and their actual results.
6. Security and tenant-isolation checks.
7. Outstanding issues and unresolved decisions.
8. Whether the phase acceptance criteria are satisfied.
9. Recommended next phase and its blockers.

Do not claim production readiness without evidence.

### Mandatory completion gate for every phase

A phase is not complete because the code generator says it is complete. Require:

1. Review of existing code, documentation and migrations before changes.
2. Implementation limited to the approved scope.
3. Tests actually executed, with results recorded.
4. Database migrations reviewed and tested where applicable.
5. Authorization, validation, tenant isolation and failure paths tested.
6. Documentation and decision register updated.
7. Known gaps explicitly recorded.
8. The next phase's readiness assessed before starting it.

## 14. Current phase

Phase 00 is complete and decisions D-001 to D-004 are approved (see `docs/phase-00-report.md`). Phase 01 is next. Implement one phase at a time.
