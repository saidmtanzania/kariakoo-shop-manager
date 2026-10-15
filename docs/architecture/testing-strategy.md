# Testing Strategy — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-12 |

## 1. Principles

- Tests are evidence. A phase is complete only when relevant tests have **actually run** and results (command, date, pass/fail counts) are recorded in `docs/migration-status.md`. [C]
- Financial, stock, authorization and tenant-isolation behaviour are release-blocking.
- Integration tests run against a real PostgreSQL (Docker), never SQLite or mocks, because constraints, locking and numeric behaviour matter.

## 2. Test layers

| Layer | Tool | Scope | Location |
|---|---|---|---|
| Unit | Vitest [A-010] | Pure domain rules: unit conversion, weighted-average cost, cash expected math, allocation rules, payment state machine, permission resolution | `backend/src/**/*.spec.ts`, `packages/shared` |
| API integration | Vitest + Supertest + PostgreSQL | Endpoints through guards to DB; transactions, constraints, idempotency, tenant isolation | `tests/integration` |
| Concurrency | Vitest + parallel requests / multiple Prisma clients | Overselling, double receipt, double allocation | `tests/integration/concurrency` |
| Architecture | dependency-cruiser + custom Vitest metadata tests | Module boundaries; every route has a permission or `@Public`; shop-scoped controllers have `ShopContextGuard` | `tests/architecture` |
| Frontend unit/component | Vitest + Testing Library | Forms, cart math display, state badges | `apps/web` |
| End-to-end | Playwright | Critical workflows in a browser, incl. mobile viewport and offline emulation | `tests/e2e` |
| Migration | Prisma migrate on empty DB + seed | Clean apply, no drift (`prisma migrate diff`) | CI script |
| Performance | k6 or autocannon [A] | POS search and sale creation under realistic volumes | `tests/performance` (Phase 11) |

## 3. Test data

- Factories/builders per module creating data through services (so invariants hold).
- Every integration test creates **two shops** with users and data by default, so isolation is always exercised.
- No shared mutable fixtures between tests; truncate or transactional rollback per test file; unique schema per test worker for parallelism [A].
- Money fixtures use the plan's examples (carton 12 pieces, 24,000 / 2,500; split 3,000 + 2,000).

## 4. Critical test catalogue

### Sales and inventory
- Carton sale reduces 12 base units; piece sale reduces 1.
- Snapshots unchanged after later price/cost edits.
- Duplicate idempotency key → single sale; mismatched payload → 409.
- N parallel sales on limited stock → no oversell, balance ≥ 0.
- Deadlock safety: two sales with the same products in opposite order both complete or one fails cleanly.
- Split payment with pending mobile money → paid_confirmed excludes pending.
- Callback confirm, duplicate callback, failed, expired, reversal transitions.
- Refund: partial, full, over-refund rejected, restock vs write-off.
- Ledger reconciliation query returns no differences after each scenario.

### Purchases
- Weighted-average cost cases incl. receipt into zero/negative stock.
- Double receive rejected; cancellation reverses.

### Credit and cash
- Allocation over payment/outstanding rejected; concurrent allocations.
- Expected cash computation; closed session immutable.

### RBAC and tenancy
- Allowed and forbidden test per permission (table-driven from the catalog).
- Escalation attempts: create role with unheld permission; assign platform permission; modify system Owner role; remove last owner.
- Invitations: expired, revoked, reused, wrong email, seat limit.
- Cross-tenant: read by ID, list leakage, write to other shop's ID, reference other shop's entity in payload, export/report/sync scope.

### Subscriptions
- Redirect without callback does not activate; invalid signature rejected; duplicate callback idempotent; delayed callback; grace and restriction; data still readable after expiry.

### Offline (Phase 10)
- Queue survives reload/restart; repeated sync idempotent; rejection displayed; stale prices; insufficient stock → review; revoked device; interrupted mid-sync (some succeeded, some not).

## 5. Security testing

- Automated authz/tenancy suites above.
- Rate-limit tests on auth endpoints.
- Header/CORS checks in integration tests.
- Dependency audit (`pnpm audit`) and secret scanning in CI.
- Phase 11 manual review against the security model.

## 6. Continuous integration [A]

Pipeline (Phase 01): install (frozen lockfile) → lint → type-check → unit → start PostgreSQL service → migrate → integration + architecture → build web/api → Playwright smoke. Hosting for CI (GitHub Actions) depends on the repository being created.

## 7. Recording results

Each phase appends to `docs/migration-status.md`: date, commit, commands run, totals (passed/failed/skipped), known failures with reasons. "Not run" is recorded as not run.
