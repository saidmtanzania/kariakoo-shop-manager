# Decision Register — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Last updated | 2026-10-16 |
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
| D-005 | Plans, limits, grace and expiry restrictions | Approved (rules); plan names and prices are data entered by platform staff | 03 (seats), 04 |
| D-006 | Mobile-money provider and confirmation approach | Partly approved: subscriptions use manual confirmation first; provider and POS approach open | 04, 07 |
| D-007 | Negative stock | Approved | 05, 07 |
| D-008 | When wholesale price applies | Proposed | 07 |
| D-009 | Tax / TRA fiscal receipts | Open | 07 (receipts), 09 |
| D-010 | Discount limits | Proposed | 07 |
| D-011 | Returns, refunds and voids policy | Proposed | 07 |
| D-012 | Login identifier (email vs phone) | Proposed (used in Phase 02) | 02 |
| D-013 | Fractional quantities | Approved | 05 |
| D-014 | Purchase orders and partial receiving | Proposed | 06 |
| D-015 | Landed costs on purchases | Proposed | 06 |
| D-016 | Customer credit-limit enforcement | Proposed | 07, 08 |
| D-017 | Partial payments and unallocated receipts | Proposed | 08 |
| D-018 | Sale requires open cashier session | Proposed | 07, 08 |
| D-019 | Trial period | Approved | 04 |
| D-020 | Hosting, data residency, retention | Open | 11 (Phase 01 unaffected) |
| D-021 | Money precision and rounding | Approved | 05, 07 |
| D-022 | Platform support access to shop data | Proposed | 11 |
| A-001 | Modular monolith | Approved (owner plan) | — |
| A-002 | Tenancy model | Proposed (used in Phase 02) | 02 |
| A-003 | Authentication strategy | Proposed (used in Phase 02) | 02 |
| A-004 | API conventions | Proposed | 01 |
| A-005 | Workspace tooling | Proposed | 01 |
| A-006 | Stock concurrency approach | Proposed (used in Phase 05) | 05, 07 |
| A-007 | Outbox for side effects, no Redis initially | Proposed (used in Phase 03) | 03 |
| A-008 | IDs and money representation | Proposed | 01 |
| A-009 | Technology stack | Approved (owner plan) | — |
| A-010 | Vitest instead of Jest | Approved | — |
| A-011 | Linters per app | Proposed (used in Phase 01) | 01 |
| A-012 | Runtime and major versions | Proposed (used in Phase 01) | 01 |
| A-013 | Rate limiting in PostgreSQL | Proposed (used in Phase 02) | 02 |
| A-014 | Sending email over SMTP | Proposed (used in Phase 02) | 02 |
| A-015 | Permission catalog in code, seeded to the database | Proposed (used in Phase 03) | 03 |
| A-016 | Shop owners hold every permission through an owner flag | Proposed (used in Phase 03) | 03 |
| A-017 | Default role templates per shop | Proposed (used in Phase 03) | 03 |
| A-018 | One pending invitation per email, enforced in the service | Proposed (used in Phase 03) | 03 |
| A-019 | Subscription status derived from dates, never stored | Proposed (used in Phase 04) | 04 |
| A-020 | Payment provider adapter, sandbox provider and callback handling | Proposed (used in Phase 04) | 04 |
| A-021 | Platform staff flag set only from the command line | Proposed (used in Phase 04) | 04 |
| A-022 | Entitlement checks in the access guard, answered with 402 | Proposed (used in Phase 04) | 04 |
| A-023 | Who sees buying prices and average cost | Proposed (used in Phase 05) | 05 |
| A-024 | Stock adjustments never take stock below zero | Proposed (used in Phase 05) | 05 |
| A-025 | Product units, prices and archiving rules | Proposed (used in Phase 05) | 05 |
| A-026 | One writer for stock balances and movements | Proposed (used in Phase 05) | 05 |

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

## D-005 Plans, limits, grace and expiry restrictions — Approved

- **Questions:** Plan names and prices (weekly / monthly in TZS)? Which features per plan (seats, products, offline, profit reports, export)? Grace period length (proposal: 3 days)? Restricted mode behaviour (proposal: read-only — no new sales/purchases, but view, export and receive debt payments allowed)? Reminder channel (SMS cost vs email)?
- *Phase 03 (2026-10-15):* seats are counted as members who are not removed plus unexpired pending invitations. Until plans existed, the optional `SEAT_LIMIT` setting applied one limit to every shop. Phase 04 removed it.
- **Decision (approved by Taibi on 2026-10-16, decision card "Approve these subscription rules"):**
  - Grace: 3 days of full access after a paid period ends.
  - Reminders by email: 3 days before full access ends and on the day it ends.
  - After grace (or straight after an unpaid trial), the shop becomes read-only: viewing, exporting and recording customer debt payments stay allowed; new sales, purchases, stock changes and staff invitations are refused.
  - Nothing is deleted, and paying restores access as soon as the payment is confirmed.
  - The values are stored as settings platform staff can edit (grace per plan; trial length and reminder days in billing settings).
- **Not decided by this approval:** plan names, prices and which features each plan includes. Phase 04 stores plans as data that platform staff enter on the platform screen; no price or plan exists until they add one. Feature keys available: `seats`, `products`, `offline_sales`, `profit_reports`, `export`. Only `seats` is enforced in Phase 04; the others are enforced by the phases that build those features. Reminders by SMS are not built (email only).
- **Status:** Approved by Taibi on 2026-10-16 (rules above). **Implemented:** Phase 04.

## D-006 Mobile-money provider and confirmation approach — Partly approved

- **Context:** Tanzanian options include direct operator APIs (Vodacom M-Pesa, Mixx by Yas/Tigo Pesa, Airtel Money, HaloPesa) or aggregators (e.g. Selcom, AzamPay, ClickPesa, DPO, Pesapal). Capabilities (STK push, callbacks, recurring, refunds, settlement) and onboarding requirements (business registration, TIN, licence) must be verified with the provider. Nothing is assumed.
- **Options for POS:** (a) manual reference entry by cashier — no integration, "confirmed" by cashier with audit, optional manager verification; (b) STK push via aggregator — automatic confirmation via callback; (c) both.
- **Options for subscriptions:** STK push via aggregator (recommended) or manual payment with platform-admin confirmation.
- **Proposal:** POS uses (a) in the first release with an explicit `CONFIRMED_BY_CASHIER` attribution; subscriptions use one aggregator; no recurring auto-deduction promised.
- **Decision for subscriptions (approved by Taibi on 2026-10-16, decision card "Manual first"):** until a provider is chosen, shops pay the platform's mobile-money number and enter the transaction reference; platform staff check and confirm it on the platform screen. A provider adapter is in place so STK push can be added once a provider is chosen.
- **Still open:** which provider (or aggregator) to use, and the POS approach for Phase 07. No real provider integration exists, and automatic recurring mobile-money deductions are not supported or promised.
- **Status:** Partly approved (subscriptions: manual first). **Implemented:** Phase 04 (manual provider, adapter interface, sandbox provider for tests).

## D-007 Negative stock — Approved

- **Options:** (1) block negative stock everywhere (online); (2) allow with permission; (3) allow freely.
- **Recommendation:** Block online; allow only for offline-sync exceptions flagged for review.
- **Decision (approved by Taibi on 2026-10-16, decision card "Owner setting"):** stock is blocked from going below zero by default. A shop owner can allow it for the shop, for sales, and products below zero are flagged in reports.
- **How Phase 05 applies it:** the setting is `shops.allow_negative_stock` (default off), changed only by an owner (`PUT /shops/current/inventory/settings`, audited). Phase 05 has no sales, so nothing uses the setting yet; stock adjustments never go below zero whatever the setting (A-024). The inventory summary already counts products below zero. Phase 07 sales will read the setting.
- **Status:** Approved by Taibi on 2026-10-16. **Implemented:** Phase 05 (setting and flag); Phase 07 (sales).

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
- **Status:** Proposed. *Phase 02 (2026-10-15):* built as email and password only; the owner was asked to confirm on 2026-10-15 and has not answered yet. Adding phone login later means a new identifier column and an SMS provider; sessions and shop isolation are unaffected.

## D-013 Fractional quantities — Approved

- **Recommendation:** Support up to 3 decimal places in base units (fabric by metre, goods by kg). Products flag `allow_fraction`; default integer-only.
- **Decision (approved by Taibi on 2026-10-16, decision card "Per unit"):** each unit (kg, metre) can allow up to 3 decimal places; pieces and cartons stay whole numbers.
- **How Phase 05 applies it:** `product_units.allow_fraction` (default false). Quantities are stored as `numeric(18,3)`. A quantity entered in a unit must be whole unless that unit allows fractions (422 `fraction_not_allowed`), and the resulting base quantity must be whole unless the base unit allows fractions (422 `base_fraction_not_allowed`). A unit's conversion must be a whole number of base units when the base unit is whole (`conversion_not_whole`).
- **Status:** Approved by Taibi on 2026-10-16. **Implemented:** Phase 05.

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

## D-019 Trial period — Approved

- **Question:** free trial length (e.g. 7 or 14 days) and which features it includes.
- **Decision:** a 14-day free trial with every feature and no limits, starting when the shop is created. An unpaid trial goes straight to read-only when it ends (grace applies only after a paid period). Paying during the trial adds the paid time after the trial ends. The length is a billing setting platform staff can change; a change applies to shops created afterwards. Shops that existed before Phase 04 started their 14-day trial when the migration ran.
- **Status:** Approved by Taibi on 2026-10-16 (decision card "Approve these subscription rules"). **Implemented:** Phase 04.

## D-020 Hosting, data residency and retention — Open

Hosting choice after cost review; whether personal data must stay in Tanzania or may be hosted abroad under the PDPA 2022; statutory retention of financial records. Requires owner input and possibly legal advice. Not a blocker for Phase 01 (local Docker only).

## D-021 Money precision and rounding — Approved

- **Recommendation:** Currency TZS only; store `numeric(18,2)`; display without decimals; prices entered as whole shillings; rounding half-up per line; average cost `numeric(18,4)`.
- **Decision (approved by Taibi on 2026-10-16, decision card "Whole TSh"):** TZS only. Prices are entered and shown in whole shillings and stored as `numeric(18,2)`. Average cost keeps 4 decimal places; line amounts round half-up.
- **How Phase 05 applies it:** buying, retail and wholesale prices accept whole shillings only (the API refuses cents and a database CHECK backs it up). Average cost is `numeric(18,4)`, computed with integer arithmetic and rounded half-up (`packages/shared/src/decimal.ts`). Line rounding is first used by Phase 07 sales.
- **Status:** Approved by Taibi on 2026-10-16. **Implemented:** Phase 05 (prices, average cost); Phase 07 (sale lines).

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

*Phase 02 (2026-10-15):* built as described: the active shop lives in the server-side session and is re-validated on every request, and `scopedToShop()` confines queries on shop-owned models. **RLS was not added.** Recommendation: keep application-level enforcement now and revisit RLS before the first shop goes live, because it touches every query and connection. The owner was asked on 2026-10-15 (options: approve as built, or add RLS now) and has not answered yet.

## A-003 Authentication strategy — Proposed
Server-side opaque sessions in HttpOnly cookies (see security model §3). Alternative: JWT access + rotating refresh tokens — better for third-party/native clients, harder revocation. Revisit if a native app is planned.

*Phase 02 (2026-10-15):* built as described; details in security model section 3 ("As built in Phase 02"). The CSRF defence is the custom-header option (`X-Requested-With: XMLHttpRequest` on every state-changing request). Awaiting owner approval (asked 2026-10-15).

## A-004 API conventions — Proposed
REST `/api/v1`, OpenAPI, RFC 9457 errors, cursor pagination, `Idempotency-Key`, decimal strings for money.

*Phase 01 (2026-10-15):* implemented `/api/v1` URI versioning, OpenAPI via `@nestjs/swagger` (exported to `docs/api/openapi.json`), RFC 9457 error filter with `code` and `traceId`, and `x-request-id` propagation. Pagination and idempotency arrive with the first endpoints that need them. Still awaiting owner approval.

## A-005 Workspace tooling — Proposed
pnpm workspaces (single lockfile) covering `apps/web`, `backend`, `packages/shared`. Node.js LTS (22.x) [A]. Turborepo optional, not required.

*Phase 01 (2026-10-15):* implemented as described, plus a `tests` workspace package for integration, e2e and architecture tests. Turborepo not added. Still awaiting owner approval.

## A-006 Stock concurrency — Proposed
Conditional `UPDATE ... WHERE quantity >= q` plus deterministic lock ordering at READ COMMITTED; `SELECT ... FOR UPDATE` for cost recalculation; CHECK constraint backstop. Alternative: SERIALIZABLE with retries (simpler reasoning, more retries under load).

*Phase 05 (2026-10-16):* every stock change locks the product's balance row with `SELECT ... FOR UPDATE` (creating it at zero first with `INSERT ... ON CONFLICT DO NOTHING`) at READ COMMITTED, then checks the new balance, updates it and writes the movement in the same transaction. One lock covers both the quantity check and the average-cost update. Phase 05 changes one product per transaction; Phase 06/07 transactions that touch several products must lock them in product-id order to avoid deadlocks. Tested with 20 concurrent removals racing for 10 in stock (exactly 10 succeed). Still awaiting owner approval.

## A-007 Outbox and background work — Proposed
PostgreSQL outbox + worker process (`@nestjs/schedule` or `pg-boss`). No Redis until justified.

*Phase 03 (2026-10-15):* built without a new library. `outbox_messages` rows are written in the same transaction as the change that causes them. An in-process worker (`OUTBOX_WORKER=on`, polling every `OUTBOX_POLL_MS`) claims due rows with `FOR UPDATE SKIP LOCKED`, so several API instances can run it safely; a claim not finished within 60 seconds is picked up again. Failures retry with backoff (5 s, 10 s, 20 s, 40 s) and stop after 5 attempts as `FAILED`. Sent and failed rows keep only the recipient and subject, because email bodies carry single-use tokens. All email (sign-up, password reset, invitations) now goes through it. Still awaiting owner approval; a separate worker process can be split out later by setting `OUTBOX_WORKER=off` on the API.

## A-008 IDs and money representation — Proposed
UUID v7 IDs; Prisma `Decimal` / `decimal.js` in code; strings in JSON; never JS `number` for money.

*Phase 01 (2026-10-15):* `newId()` helper (UUID v7, `uuid` package) and `moneyStringSchema` / `quantityStringSchema` in `packages/shared`. Still awaiting owner approval.

## A-010 Vitest instead of Jest — Approved

- **Context:** The approved stack (A-009) names Jest. NestJS 12, released after the plan was written, is published as ES modules only, and its project generator now ships Vitest. Jest's ES-module support is still experimental (`--experimental-vm-modules`) and needs extra transform setup for Nest's decorators.
- **Options:** (1) Vitest for unit, component and integration tests, keeping Supertest and Playwright; (2) Jest with experimental ESM mode and a decorator-aware transform; (3) pin NestJS 11 (CommonJS) to keep Jest.
- **Recommendation:** Option 1. Vitest's API (`describe`, `it`, `expect`, mocks via `vi`) is Jest-compatible, so the testing strategy is unchanged apart from the runner. Next.js documents Vitest for component tests as well, so the whole repository uses one runner.
- **Consequences:** `docs/architecture/testing-strategy.md` and AGENTS.md mention Vitest where they said Jest. Option 3 would start the project on an older major version.
- **Status:** Approved by Taibi on 2026-10-15 (Option 1).

## A-011 Linters per app — Proposed

- **Decision used:** oxlint for the API, shared package and tests (NestJS 12's default); ESLint with `eslint-config-next` for the web app (Next.js default, includes React hooks and accessibility rules); Prettier for formatting everywhere except Markdown docs.
- **Note:** ESLint stays on 9.x because `eslint-config-next` 16.4 plugins do not yet support ESLint 10; pnpm reports ESLint 9 as deprecated.
- **Status:** Proposed — used in Phase 01. **Date:** 2026-10-15

## A-012 Runtime and major versions — Proposed

- **Decision used:** Node.js 22 LTS, pnpm 10.28, TypeScript 6.0 (TypeScript 7 is not yet supported by typescript-eslint or the Next.js/Nest toolchains), NestJS 12, Next.js 16.4, React 19, Prisma 7.10 with the `@prisma/adapter-pg` driver adapter (Prisma 8 is only a release candidate), PostgreSQL 17, Tailwind CSS 4.
- **Status:** Proposed — used in Phase 01. **Date:** 2026-10-15

## A-013 Rate limiting in PostgreSQL — Proposed

- **Context:** The security model named `@nestjs/throttler` with a PostgreSQL-backed store. The throttler has no maintained PostgreSQL store, and the per-email lockout needs counters that the API can check and reset itself (for example, after a successful sign-in or password reset).
- **Decision used:** a small `RateLimitService` storing fixed-window counters in a `rate_limit_counters` table with one atomic upsert per hit, a `@RateLimit()` decorator for per-IP and per-email limits, and expired rows deleted on roughly 1 in 100 hits. No Redis (consistent with A-007).
- **Alternatives:** `@nestjs/throttler` with its in-memory store (limits reset on restart and are per-process); Redis (another service to run).
- **Consequence:** one extra write per limited request on the auth endpoints only. Revisit if traffic grows enough for this to matter.
- *Phase 03:* invitation sending (50 per hour per IP), invitation preview (30) and acceptance (20) are limited the same way. `RATE_LIMIT_MULTIPLIER` (default 1, logged as a warning when higher) raises every limit for the browser tests only, where all simulated people share one address.
- **Status:** Proposed — used in Phase 02. **Date:** 2026-10-15

## A-014 Sending email over SMTP — Proposed

- **Decision used:** `nodemailer` over SMTP, configured by `SMTP_*` variables, so any provider that offers SMTP (Amazon SES, Mailgun, Brevo, a Tanzanian host) can be used without code changes. Mailpit catches all mail locally and in CI. `MAIL_TRANSPORT=memory` is for automated tests and is refused in production.
- **Interim:** mail is sent after the database change commits, inside the request; a failed send is logged and the user can ask for a new link. The PostgreSQL outbox (A-007) replaces this in Phase 03, where invitations need reliable delivery. *Phase 03:* done; every email is now queued in the outbox and retried.
- **Open:** the production provider and sending domain (needed before launch, with SPF and DKIM records).
- **Status:** Proposed — used in Phase 02. **Date:** 2026-10-15

## A-015 Permission catalog in code, seeded to the database — Proposed

- **Decision used:** the list of permissions lives in `packages/shared/src/permissions.ts` (44 shop permissions, 4 platform permissions) so the API, the web app and the tests share one list. A migration inserts the same rows into the `permissions` table, which roles reference by foreign key. A test fails if the two ever differ. Adding a permission means editing the list and adding a migration.
- **Guard:** a database trigger refuses platform permissions on shop roles, in addition to the API's validation.
- **Alternative:** permissions only in the database, edited by platform staff (more flexible, but code that checks a permission could then refer to one that does not exist).
- **Status:** Proposed — used in Phase 03. **Date:** 2026-10-15

## A-016 Shop owners hold every permission through an owner flag — Proposed

- **Decision used:** `shop_memberships.is_owner` marks owners, who hold every shop permission without needing a role. Only an owner can appoint, demote, suspend, remove or change the roles of another owner, and a shop always keeps at least one active owner. Platform permissions are never granted to shop members.
- **Why:** an "Owner" role that could be edited would let an owner lock themselves out, and a staff member with "manage roles" could edit it.
- **Alternative:** a protected, built-in Owner role (same effect, more special cases in role editing).
- **Status:** Proposed — used in Phase 03. **Date:** 2026-10-15

## A-017 Default role templates per shop — Proposed

- **Decision used:** every new shop starts with three ordinary roles, Manager, Cashier and Storekeeper, whose permissions are listed in `docs/security/permission-catalog.md`. Owners can rename, edit or delete them like any role they create. Staff with "manage roles" can only give out permissions they hold themselves.
- **Status:** Proposed — used in Phase 03. **Date:** 2026-10-15

## A-018 One pending invitation per email, enforced in the service — Proposed

- **Context:** a partial unique index (`UNIQUE (shop_id, email) WHERE status = 'PENDING'`) is the natural guard, but Prisma 7.10 cannot describe partial indexes, so the migration drift check would report it as unexpected.
- **Decision used:** invitation creation, resending and acceptance lock the shop row (`SELECT ... FOR UPDATE`) and check for a pending invitation and the seat count inside that lock. Acceptance also uses a conditional update, so a token can only be used once.
- **Revisit:** when Prisma supports partial indexes, add the index as a second guard.
- **Status:** Proposed — used in Phase 03. **Date:** 2026-10-15

## A-019 Subscription status derived from dates, never stored — Proposed

- **Decision used:** a subscription stores only dates (`trial_ends_at`, `paid_until`, `grace_days`). Its status (TRIALING, ACTIVE, GRACE, RESTRICTED) is computed by one pure function in `packages/shared/src/subscriptions.ts` whenever it is read, so there is no expiry job that could fail to run and no status that can disagree with the payment history.
- **Paid time:** each confirmed payment inserts a `subscription_periods` row. A period starts at the later of now, the trial end and the current paid-until (no back-dating), and lasts one week or one calendar month in UTC (31 January + 1 month = 28/29 February). Periods can only be marked reversed, never edited or deleted (database trigger). A reversal recomputes paid-until from the remaining periods in the order they were confirmed.
- **Status:** Proposed — used in Phase 04. **Date:** 2026-10-16

## A-020 Payment provider adapter, sandbox provider and callback handling — Proposed

- **Decision used:** billing rules live in `PaymentsService`; a provider adapter only starts payments (outside any transaction), verifies callback signatures over the exact bytes received, and looks up a payment's status. Adapters now: `manual` (no callbacks; platform staff confirm) and `sandbox` (HMAC-SHA256 signed callbacks and a status lookup, enabled only by `PAYMENT_SANDBOX_SECRET` and refused in production), used to test the callback path a real provider will use.
- **Callbacks:** every callback is stored in `payment_events`, valid or not, deduplicated by the provider's event id. Only a verified callback can change a payment; changes lock the payment row. A confirmation whose amount or currency differs, a success after a failure, a failure after a confirmation, or a reversal of an unconfirmed payment is flagged for platform review instead of being applied.
- **Reconciliation:** payments still pending after `PAYMENT_RECONCILE_AFTER_MINUTES` are looked up with the provider (outside transactions) and go through the same rules. Manual payments wait for platform staff.
- **Status:** Proposed — used in Phase 04. **Date:** 2026-10-16

## A-021 Platform staff flag set only from the command line — Proposed

- **Decision used:** `users.is_platform_admin` marks platform staff, who can use the `/platform` API and screen (plans, billing settings, payment decisions). No API can set it; it is granted or removed with `pnpm --filter backend platform:admin grant|revoke <email>`, which writes an audit entry. Platform staff are not given shop access by this flag.
- **Revisit:** the four `platform.*` permissions in the catalog can be split across platform roles when there is more than one kind of platform staff.
- **Status:** Proposed — used in Phase 04. **Date:** 2026-10-16

## A-022 Entitlement checks in the access guard, answered with 402 — Proposed

- **Decision used:** a route that records new work declares `@RequireWritable()` (or `@RequireFeature(key)`). The global access guard checks it after the permission check, so billing never grants anything and never reveals billing state to someone without the permission. A read-only shop gets HTTP 402 `subscription_read_only`; a missing plan feature gets 402 `feature_not_in_plan`; a full plan gets 402 `seat_limit_reached`. Phase 04 marks invitation create, resend and accept; later phases mark their own write routes (sales, purchases, stock). Removing staff, changing roles and paying stay allowed when read-only.
- **Status:** Proposed — used in Phase 04. **Date:** 2026-10-16

## A-023 Who sees buying prices and average cost — Proposed

- **Decision used:** buying prices and average cost are shown only to people who can change prices (`products.prices.update`) or read profit (`reports.profit.read`); owners always can. Everyone else gets `null` for those fields. Entering a buying price or a stock cost without that access is refused with 403 `permission_denied`. Retail and wholesale prices are visible to everyone who can read products.
- **Status:** Proposed — used in Phase 05. **Date:** 2026-10-16

## A-024 Stock adjustments never take stock below zero — Proposed

- **Decision used:** D-007 lets an owner allow selling below zero. Phase 05 applies it to sales only: a stock adjustment that would leave the balance below zero is refused (409 `insufficient_stock`) whatever the setting, because a count correction or a loss cannot remove stock that is not recorded.
- **Status:** Proposed — used in Phase 05. **Date:** 2026-10-16

## A-025 Product units, prices and archiving rules — Proposed

- **Decision used:**
  - Each product has one base unit, chosen when it is created and never changed. Other units hold a fixed whole number of base units (for example, a carton of 12 pieces); a unit's conversion cannot be edited once saved, so history stays correct. Units are archived, never deleted. A product can have at most 10 active units.
  - SKUs are unique per shop (case-insensitive); barcodes are unique per shop across all units.
  - Someone with `products.create` can enter the first prices of a new product; later price changes need `products.prices.update` and are kept in a price history.
  - Opening stock needs `inventory.opening` and can be recorded only once, before any other stock change; after that, changes are adjustments (`inventory.adjust`) with a reason, and "Other" needs a note.
  - A product can be archived only when its stock is zero (409 `product_has_stock`). Products are never deleted.
  - The plan feature `products` (D-005) limits active products per shop (402 `product_limit_reached`), checked under a lock on the shop row.
- **Status:** Proposed — used in Phase 05. **Date:** 2026-10-16

## A-026 One writer for stock balances and movements — Proposed

- **Decision used:** only `StockLedgerService` writes `stock_balances` and `stock_movements`; an architecture test fails if any other source file does. Movements, adjustments and price history are append-only (database triggers refuse updates and deletes). Every movement keeps the unit, quantity and conversion the person entered, and the balance after it, so completed records do not change when a unit is edited later. Purchases (Phase 06) and sales (Phase 07) will add their own movement types through the same service.
- **Status:** Proposed — used in Phase 05. **Date:** 2026-10-16

---

## Approval log

| Date | Decision | Approved by | Notes |
|---|---|---|---|
| 2026-10-12 | A-001, A-009 | Owner (project plan message) | Stated directly in the plan. |
| 2026-10-12 | D-001, D-002, D-003, D-004 | Taibi (decision card in project thread) | Approved all four recommended options as written. |
| 2026-10-15 | A-010 | Taibi (decision card in project thread) | Vitest replaces Jest; Supertest and Playwright unchanged. |
| 2026-10-16 | D-006 (subscriptions only) | Taibi (decision card "Manual first") | Manual payment with platform confirmation until a provider is chosen; provider and POS approach still open. |
| 2026-10-16 | D-005, D-019 | Taibi (decision card "Approve these subscription rules") | 14-day trial with all features, 3-day grace after paid periods, email reminders 3 days before and on the day, then read-only; values editable. Plan names and prices not decided. |
| 2026-10-16 | D-007 | Taibi (decision card "Owner setting") | Blocked below zero by default; an owner can allow it per shop for sales; negative balances flagged in reports. |
| 2026-10-16 | D-013 | Taibi (decision card "Per unit") | Each unit can allow up to 3 decimal places; pieces and cartons stay whole. |
| 2026-10-16 | D-021 | Taibi (decision card "Whole TSh") | TZS only; whole-shilling prices stored as numeric(18,2); average cost 4 decimals; lines round half-up. |
