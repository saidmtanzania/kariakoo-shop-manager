# Decision Register — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Last updated | 2026-10-12 |
| Owner | Taibi (shop-manager product owner) |

Statuses: **Proposed** (recommendation, not approved) · **Approved** (explicit owner approval recorded) · **Superseded** · **Open** (no recommendation yet; needs input).

Business decisions are `D-xxx`; architecture decisions are `A-xxx`. A decision is only marked Approved with the approver and date recorded.

## Summary

| ID | Title | Status | Blocks phase |
|---|---|---|---|
| D-001 | Subscription boundary | Approved | 04 |
| D-002 | Branches | Approved | 05 (schema shape) |
| D-003 | Inventory costing method | Approved | 06, 07, 09 |
| D-004 | Offline sales scope | Approved | 10 (and 07 data shape) |
| D-005 | Plans, limits, grace and expiry restrictions | Open | 03 (seats), 04 |
| D-006 | Mobile-money provider and confirmation approach | Open | 04, 07 |
| D-007 | Negative stock | Proposed | 05 |
| D-008 | When wholesale price applies | Proposed | 07 |
| D-009 | Tax / TRA fiscal receipts | Open | 07 (receipts), 09 |
| D-010 | Discount limits | Proposed | 07 |
| D-011 | Returns, refunds and voids policy | Proposed | 07 |
| D-012 | Login identifier (email vs phone) | Proposed | 02 |
| D-013 | Fractional quantities | Proposed | 05 |
| D-014 | Purchase orders and partial receiving | Proposed | 06 |
| D-015 | Landed costs on purchases | Proposed | 06 |
| D-016 | Customer credit-limit enforcement | Proposed | 07, 08 |
| D-017 | Partial payments and unallocated receipts | Proposed | 08 |
| D-018 | Sale requires open cashier session | Proposed | 07, 08 |
| D-019 | Trial period | Open | 04 |
| D-020 | Hosting, data residency, retention | Open | 11 (Phase 01 unaffected) |
| D-021 | Money precision and rounding | Proposed | 05, 07 |
| D-022 | Platform support access to shop data | Proposed | 11 |
| A-001 | Modular monolith | Approved (owner plan) | — |
| A-002 | Tenancy model | Proposed | 02 |
| A-003 | Authentication strategy | Proposed | 02 |
| A-004 | API conventions | Proposed | 01 |
| A-005 | Workspace tooling | Proposed | 01 |
| A-006 | Stock concurrency approach | Proposed | 05, 07 |
| A-007 | Outbox for side effects, no Redis initially | Proposed | 03 |
| A-008 | IDs and money representation | Proposed | 01 |
| A-009 | Technology stack | Approved (owner plan) | — |
| A-010 | Vitest instead of Jest | Proposed (used in Phase 01) | 01 |
| A-011 | Linters per app | Proposed (used in Phase 01) | 01 |
| A-012 | Runtime and major versions | Proposed (used in Phase 01) | 01 |

---

## D-001 Subscription boundary

- **Context:** An owner may run several shops. Billing must map to entitlements.
- **Options:**
  1. *Each shop has its own subscription* — simple entitlement checks; clear seat limits per shop; owner pays per shop. Owners with many shops pay multiple times; multi-shop discounts would need a later "account" concept.
  2. *One subscription covers all shops of an owner* — attractive for multi-shop owners; entitlements must be computed across shops; ownership transfer and co-owners complicate billing.
- **Recommendation:** Option 1.
- **Consequences:** `subscriptions.shop_id` unique; seat/product limits per shop. An optional "billing account" can be added later without breaking the model.
- **Status:** Approved by Taibi on 2026-10-12 (Option 1).

## D-002 Branches

- **Context:** Some Kariakoo businesses have a shop plus a store (godown) or several stalls.
- **Options:**
  1. *One location for initial release, designed for branches later* — `stock_locations` table exists with one default location; all stock/sales reference `location_id`; no transfers/branch UI.
  2. *Multiple branches from first release* — transfers, per-branch permissions, per-branch reports and cash sessions; significantly more scope and testing.
- **Recommendation:** Option 1.
- **Consequences:** A shop with a separate godown cannot track it separately in the first release (could be modelled as a second shop, without transfers). Migration to branches later adds UI and permissions, not schema rework.
- **Status:** Approved by Taibi on 2026-10-12 (Option 1).

## D-003 Inventory costing method

- **Options:**
  1. *Weighted-average* — one running average per product/location; simple, robust with unit conversions and returns; standard for small retail.
  2. *FIFO* — needs cost layers per receipt, layer consumption on each sale, complex returns/adjustments; more accurate when prices swing.
  3. *Defer costing* — ship without profit/valuation reports until rules are confirmed.
- **Recommendation:** Option 1 (formula in `data-model.md` §12).
- **Consequences:** Profit uses average cost at time of sale; historical snapshots preserved; switching to FIFO later would apply only to future transactions.
- **Status:** Approved by Taibi on 2026-10-12 (Option 1).

## D-004 Offline sales scope

- **Options:**
  1. *Controlled offline sales on one designated device per shop* — limited conflicts; clear review process.
  2. *Multi-device offline sales* — conflicting stock decrements cannot be fully prevented; requires conflict tooling.
  3. *Online-only for initial release* — simplest; unusable during outages.
- **Recommendation:** Option 1.
- **Sub-questions (proposed defaults):** offline payment methods = cash and manually referenced mobile money; credit sales offline = **not allowed** initially (customer limits cannot be checked); max offline queue = 24 hours or 500 sales before forcing sync [A]; stock insufficient at sync → `NEEDS_REVIEW` with negative-stock exception movement (sale is not discarded, because goods have physically left).
- **Consequences:** Requires `pos_devices`, device credentials, sync endpoint, review UI; other devices are online-only.
- **Status:** Approved by Taibi on 2026-10-12 (Option 1, including the proposed sub-question defaults for D-004).

## D-005 Plans, limits, grace and expiry restrictions — Open

- **Questions:** Plan names and prices (weekly / monthly in TZS)? Which features per plan (seats, products, offline, profit reports, export)? Grace period length (proposal: 3 days)? Restricted mode behaviour (proposal: read-only — no new sales/purchases, but view, export and receive debt payments allowed)? Reminder channel (SMS cost vs email)?
- **Status:** Open. Needed before Phase 04 (seat limits used by Phase 03 can default to "unlimited" until decided).

## D-006 Mobile-money provider and confirmation approach — Open

- **Context:** Tanzanian options include direct operator APIs (Vodacom M-Pesa, Mixx by Yas/Tigo Pesa, Airtel Money, HaloPesa) or aggregators (e.g. Selcom, AzamPay, ClickPesa, DPO, Pesapal). Capabilities (STK push, callbacks, recurring, refunds, settlement) and onboarding requirements (business registration, TIN, licence) must be verified with the provider. Nothing is assumed.
- **Options for POS:** (a) manual reference entry by cashier — no integration, "confirmed" by cashier with audit, optional manager verification; (b) STK push via aggregator — automatic confirmation via callback; (c) both.
- **Options for subscriptions:** STK push via aggregator (recommended) or manual payment with platform-admin confirmation.
- **Proposal:** POS uses (a) in the first release with an explicit `CONFIRMED_BY_CASHIER` attribution; subscriptions use one aggregator; no recurring auto-deduction promised.
- **Status:** Open — provider research and owner choice required.

## D-007 Negative stock

- **Options:** (1) block negative stock everywhere (online); (2) allow with permission; (3) allow freely.
- **Recommendation:** Block online; allow only for offline-sync exceptions flagged for review.
- **Status:** Proposed.

## D-008 When wholesale price applies

- **Options:** (1) cashier chooses retail/wholesale per sale or line; (2) automatic by customer type; (3) automatic by quantity threshold.
- **Recommendation:** (1) cashier chooses, with default retail and per-line override; wholesale selection audited. Unit choice (carton vs piece) is independent of price type.
- **Status:** Proposed.

## D-009 Tax / TRA fiscal receipts — Open

- **Context:** VAT-registered businesses in Tanzania must issue fiscal receipts through EFD/VFD systems. Integration requirements and whether target shops are VAT-registered are unknown.
- **Proposal:** Out of scope for initial release; receipts state "Not a fiscal receipt" if required; revisit after pilot. **Needs owner/legal confirmation.**
- **Status:** Open.

## D-010 Discount limits

- **Recommendation:** Discounts require `sales.discount`; shop setting for maximum discount % per sale for non-owners (default 10 %) [A]; above limit requires owner/manager approval (online) or is rejected.
- **Status:** Proposed.

## D-011 Returns, refunds and voids policy

- **Recommendation:** Returns allowed within a shop-configurable window (default 7 days) with `sales.refund`; refund to original method or customer credit; "void" only for same-session sales before receipt hand-over, still recorded as compensating entries; no restocking fee initially. A sale whose mobile-money payment fails remains with an outstanding balance until another payment is taken or it is voided.
- **Status:** Proposed.

## D-012 Login identifier

- **Recommendation:** Email + password for initial release (invitations are by email per plan). Phone/SMS OTP login is a later option (SMS cost, SIM-swap risk).
- **Consequence:** Staff without email cannot be invited; owner may need to create emails for them. **Owner should confirm this is acceptable for Kariakoo staff.**
- **Status:** Proposed.

## D-013 Fractional quantities

- **Recommendation:** Support up to 3 decimal places in base units (fabric by metre, goods by kg). Products flag `allow_fraction`; default integer-only.
- **Status:** Proposed.

## D-014 Purchase orders and partial receiving

- **Recommendation:** No PO workflow in the first release; a purchase is recorded when goods arrive (draft → received). Partial receiving not supported initially; record what actually arrived.
- **Status:** Proposed.

## D-015 Landed costs

- **Recommendation:** Optional "extra costs" on a purchase (transport, porters) allocated to items by value and included in unit cost. Alternative: record as expenses only (simpler, understates COGS).
- **Status:** Proposed (owner preference needed).

## D-016 Credit-limit enforcement

- **Recommendation:** Off by default; when enabled per customer, a sale exceeding the limit requires `customers.credit.manage` override (audited).
- **Status:** Proposed.

## D-017 Partial payments and unallocated receipts

- **Recommendation:** Partial payments allowed; payments auto-allocate oldest-first; unallocated remainder kept as customer credit (negative balance) usable later.
- **Status:** Proposed.

## D-018 Sale requires open cashier session

- **Recommendation:** Yes for sales with cash payment; shop setting to relax for owner-only shops.
- **Status:** Proposed.

## D-019 Trial period — Open

Free trial length (e.g. 7 or 14 days) and which features it includes.

## D-020 Hosting, data residency and retention — Open

Hosting choice after cost review; whether personal data must stay in Tanzania or may be hosted abroad under the PDPA 2022; statutory retention of financial records. Requires owner input and possibly legal advice. Not a blocker for Phase 01 (local Docker only).

## D-021 Money precision and rounding

- **Recommendation:** Currency TZS only; store `numeric(18,2)`; display without decimals; prices entered as whole shillings; rounding half-up per line; average cost `numeric(18,4)`.
- **Status:** Proposed.

## D-022 Platform support access

- **Recommendation:** Platform admins can view shop metadata and billing; viewing business records requires a logged reason; actions visible to the shop owner in the audit log.
- **Status:** Proposed.

---

## A-001 Modular monolith — Approved
Owner plan §1 "Start with a modular monolith". **Date:** 2026-10-12.

## A-009 Technology stack — Approved
NestJS + Next.js + PostgreSQL + Prisma, Tailwind + shadcn/ui, TanStack Query, RHF + Zod, Dexie/IndexedDB, Jest/Supertest/Playwright, Docker Compose. Source: owner plan §1. **Date:** 2026-10-12.

## A-002 Tenancy model — Proposed
Shared schema with `shop_id`; application-layer enforcement via `ShopContext` + Prisma extension; PostgreSQL RLS considered as defence in depth in Phase 02. Alternative (schema-per-tenant) rejected: migrations and reporting complexity for many small shops.

## A-003 Authentication strategy — Proposed
Server-side opaque sessions in HttpOnly cookies (see security model §3). Alternative: JWT access + rotating refresh tokens — better for third-party/native clients, harder revocation. Revisit if a native app is planned.

## A-004 API conventions — Proposed
REST `/api/v1`, OpenAPI, RFC 9457 errors, cursor pagination, `Idempotency-Key`, decimal strings for money.

*Phase 01 (2026-10-15):* implemented `/api/v1` URI versioning, OpenAPI via `@nestjs/swagger` (exported to `docs/api/openapi.json`), RFC 9457 error filter with `code` and `traceId`, and `x-request-id` propagation. Pagination and idempotency arrive with the first endpoints that need them. Still awaiting owner approval.

## A-005 Workspace tooling — Proposed
pnpm workspaces (single lockfile) covering `apps/web`, `backend`, `packages/shared`. Node.js LTS (22.x) [A]. Turborepo optional, not required.

*Phase 01 (2026-10-15):* implemented as described, plus a `tests` workspace package for integration, e2e and architecture tests. Turborepo not added. Still awaiting owner approval.

## A-006 Stock concurrency — Proposed
Conditional `UPDATE ... WHERE quantity >= q` plus deterministic lock ordering at READ COMMITTED; `SELECT ... FOR UPDATE` for cost recalculation; CHECK constraint backstop. Alternative: SERIALIZABLE with retries (simpler reasoning, more retries under load).

## A-007 Outbox and background work — Proposed
PostgreSQL outbox + worker process (`@nestjs/schedule` or `pg-boss`). No Redis until justified.

## A-008 IDs and money representation — Proposed
UUID v7 IDs; Prisma `Decimal` / `decimal.js` in code; strings in JSON; never JS `number` for money.

*Phase 01 (2026-10-15):* `newId()` helper (UUID v7, `uuid` package) and `moneyStringSchema` / `quantityStringSchema` in `packages/shared`. Still awaiting owner approval.

## A-010 Vitest instead of Jest — Proposed

- **Context:** The approved stack (A-009) names Jest. NestJS 12, released after the plan was written, is published as ES modules only, and its project generator now ships Vitest. Jest's ES-module support is still experimental (`--experimental-vm-modules`) and needs extra transform setup for Nest's decorators.
- **Options:** (1) Vitest for unit, component and integration tests, keeping Supertest and Playwright; (2) Jest with experimental ESM mode and a decorator-aware transform; (3) pin NestJS 11 (CommonJS) to keep Jest.
- **Recommendation:** Option 1. Vitest's API (`describe`, `it`, `expect`, mocks via `vi`) is Jest-compatible, so the testing strategy is unchanged apart from the runner. Next.js documents Vitest for component tests as well, so the whole repository uses one runner.
- **Consequences:** `docs/architecture/testing-strategy.md` and AGENTS.md mention Vitest where they said Jest. Option 3 would start the project on an older major version.
- **Status:** Proposed — used in Phase 01, awaiting owner approval. **Date:** 2026-10-15

## A-011 Linters per app — Proposed

- **Decision used:** oxlint for the API, shared package and tests (NestJS 12's default); ESLint with `eslint-config-next` for the web app (Next.js default, includes React hooks and accessibility rules); Prettier for formatting everywhere except Markdown docs.
- **Note:** ESLint stays on 9.x because `eslint-config-next` 16.4 plugins do not yet support ESLint 10; pnpm reports ESLint 9 as deprecated.
- **Status:** Proposed — used in Phase 01. **Date:** 2026-10-15

## A-012 Runtime and major versions — Proposed

- **Decision used:** Node.js 22 LTS, pnpm 10.28, TypeScript 6.0 (TypeScript 7 is not yet supported by typescript-eslint or the Next.js/Nest toolchains), NestJS 12, Next.js 16.4, React 19, Prisma 7.10 with the `@prisma/adapter-pg` driver adapter (Prisma 8 is only a release candidate), PostgreSQL 17, Tailwind CSS 4.
- **Status:** Proposed — used in Phase 01. **Date:** 2026-10-15

---

## Approval log

| Date | Decision | Approved by | Notes |
|---|---|---|---|
| 2026-10-12 | A-001, A-009 | Owner (project plan message) | Stated directly in the plan. |
| 2026-10-12 | D-001, D-002, D-003, D-004 | Taibi (decision card in project thread) | Approved all four recommended options as written. |
