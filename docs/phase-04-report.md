# Phase 04 Report — Plans and Subscriptions

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |
| Branch | `phase-04-subscriptions` (from `main` after Phase 03 was merged) |
| Decisions applied | D-005 and D-019 (approved 2026-10-16), D-006 for subscriptions: manual confirmation first (approved 2026-10-16) |

## 1. What was inspected

AGENTS.md sections 5, 7, 9 and 12, the decision register (D-001, D-005, D-006, D-019, A-007, A-008), the data model (section 4, subscription and billing), the security model (sections 5, 6, 8 and 13), acceptance criteria AC-04, and the Phase 03 code: the access guard and its decorators, the shop-scoped Prisma client, the invitation seat check, the outbox and the audit service.

## 2. What changed

**API (`backend`)**

- **Plans (D-005):** plans are data that platform staff add and edit: name, weekly or monthly, price in TZS, grace days, display order, whether shops can choose it, and features (`seats`, `products`, `offline_sales`, `profit_reports`, `export`, each on/off with an optional limit). No plan or price is in the code or the database seed.
- **Subscriptions (D-001, D-019, A-019):** each shop has one. A new shop starts a 14-day trial with every feature. The status (free trial, active, grace, read-only) is calculated from three dates whenever it is read, never stored, so there is no expiry job that can fail and no status that can disagree with the payments.
- **Paid periods:** each confirmed payment adds one week or one calendar month, starting after the trial or time already paid for, or from now if both are over (late payments are not back-dated). Periods can only be marked reversed, never edited or deleted (database trigger).
- **Manual payments (D-006):** a shop chooses a plan, pays the platform's mobile-money number and enters the transaction reference. The payment waits until platform staff confirm or reject it. The amount is the plan price at that moment. A reference can be used once across all shops; retries with the same request key return the same payment; at most 3 payments can wait at once.
- **Provider adapter (A-020):** billing rules are separate from provider code. Adapters now: `manual`, and `sandbox`, a test provider with signed callbacks and a status lookup, refused in production. Provider requests run outside database transactions.
- **Callbacks:** `POST /api/v1/payments/callbacks/:provider`. Every callback is stored. Unsigned or wrongly signed ones answer 401 and change nothing. Repeats are recognised by the provider's event id. Changes lock the payment, so many callbacks at once still confirm once. Amount or currency mismatches, success after a failure, failure after a confirmation and reversals of unconfirmed payments are flagged for platform review instead of applied.
- **Reconciliation:** payments still pending after 10 minutes (setting) are looked up with their provider and handled like a callback. Manual payments wait for platform staff.
- **Reversals:** platform staff (or a provider) can reverse a confirmed payment; its period is marked reversed and paid-until is recalculated from the remaining periods.
- **Read-only mode (D-005, A-022):** when the grace period ends (or straight after an unpaid trial) the shop is read-only. Routes that record new work declare it, and the access guard refuses them with 402 after the permission check. In this phase that covers inviting, resending and accepting invitations; Phases 05 to 08 mark their own sales, purchase and stock routes. Reading, removing staff and paying stay allowed. Nothing is deleted.
- **Seat limits:** now come from the plan's `seats` feature (none during the trial), replacing the interim `SEAT_LIMIT` setting. A full plan answers 402 `seat_limit_reached`.
- **Reminders:** emails to the shop's owners 3 days before full access ends and on the day it ends, sent once per end date.
- **Platform staff (A-021):** a new `@PlatformAdmin()` access level for `/api/v1/platform/*` (plans, billing settings, payments). The flag can only be set with `pnpm --filter backend platform:admin grant|revoke <email>`, which is audited.
- **Session:** now includes whether the user is platform staff and the active shop's subscription status, for banners.
- **Settings:** `SUBSCRIPTION_JOBS`, `SUBSCRIPTION_JOBS_INTERVAL_MS`, `PAYMENT_RECONCILE_AFTER_MINUTES`, `PAYMENT_SANDBOX_SECRET`. `SEAT_LIMIT` was removed.

**Web (`apps/web`)**

- **Subscription page (`/subscription`):** status, dates, what the shop can use, the plan list with payment instructions, the reference form with a clear "waiting for confirmation" state, and payment history.
- **Home page:** a banner when the trial or paid period is about to end, during grace and when read-only; people who cannot pay are told to ask the owner.
- **Platform page (`/platform`):** payments to confirm, reject or reverse (with a note), plans editor and billing settings (trial days, reminder days, payment instructions). Shown only to platform staff; the API checks every request.
- All new text is in English and Kiswahili. Money is shown from the decimal string, never converted to a floating-point number.

**Tests:** 35 new integration tests (subscriptions 22, provider callbacks and reconciliation 12, plan seat limit at acceptance 1), 2 new browser journeys on desktop and mobile, and unit tests for status, period and entitlement rules, settings and money display.

**Docs:** this report, decision register (D-005, D-006, D-019 decisions recorded; A-019 to A-022 added; approval log), data model, security model, acceptance criteria AC-04, migration status, README, AGENTS.md section 14, `.env.example`, Docker Compose, OpenAPI.

## 3. Database changes

Migration `20261016060401_subscriptions` (additive):

- enums `PlanInterval`, `PaymentStatus`;
- tables `plans`, `plan_features`, `billing_settings` (one row with the approved defaults), `subscriptions`, `subscription_periods`, `subscription_payments`, `payment_events`, `subscription_reminders`;
- check constraints on prices, amounts, grace days, trial and reminder days and period order;
- unique keys for one subscription per shop, one use per payment reference, one payment per request key and one stored event per provider event id;
- triggers `subscription_periods_append_only` and `payment_events_no_delete`;
- every existing shop gets a subscription with a 14-day trial starting when the migration runs.

Applied to a brand-new database from a clean clone and by the Docker Compose migrate job. Drift check: no difference.

## 4. Tests executed

All run from a clean clone against a new database; commands and results in `docs/migration-status.md`.

| Suite | Passed |
|---|---|
| Unit: shared | 40/40 |
| Unit: backend | 24/24 |
| Unit: web | 15/15 |
| Architecture rules | no violations (155 modules) |
| Integration (real PostgreSQL) | 162/162 |
| Browser (desktop and Pixel 7 Chromium, production API, real SMTP to Mailpit) | 22/22 |
| Browser against the Docker Compose stack | 22/22 |

Required scenarios and where they are tested:

| Scenario | Test |
|---|---|
| Duplicate callbacks (same event, new event with the same news, five at once) | `payments.int-spec.ts` |
| Invalid, missing or mismatched signatures change nothing and are stored | `payments.int-spec.ts` |
| Delayed confirmation after the subscription ended starts the period now | `payments.int-spec.ts`, `subscriptions.int-spec.ts` (manual) |
| Failed payments, and success arriving after a failure | `payments.int-spec.ts` |
| Reversals (callback and platform), paid-until recalculated, history kept | `payments.int-spec.ts`, `subscriptions.int-spec.ts` |
| Amount mismatch flagged, not confirmed | `payments.int-spec.ts` |
| Reconciliation of overdue payments, run twice | `payments.int-spec.ts` |
| Expired trial and expired grace become read-only; reading, paying and removing staff still work | `subscriptions.int-spec.ts` |
| Entitlements enforced separately from permissions; seat limit from the plan at invite, resend and accept | `subscriptions.int-spec.ts`, `invitations.int-spec.ts` |
| Idempotent payment submission, including concurrent retries | `subscriptions.int-spec.ts` |
| Browser cannot set a payment status | `subscriptions.int-spec.ts` |
| Reminders sent once each | `subscriptions.int-spec.ts` |
| Trial, manual payment and staff confirmation through the screens | `subscription.e2e.ts` |

Negative checks (each change reverted afterwards): turning off the signature check, the read-only check, the platform staff check or the amount check each made the related integration tests fail.

## 5. Security and tenant-isolation checks

- Subscriptions, periods, payments and reminders are shop-owned and go through the shop-scoped client; plans, plan features, billing settings and payment events are global. The classification test covers every model.
- A shop sees only its own payments; confirming one shop's payment does not touch another's (tested).
- Every `/platform` route refuses a shop owner (403 `platform_admin_required`), checked route by route; removing the flag takes effect on the next request.
- The callback route is the only new public route; the route inventory test lists it.
- Subscription view needs `subscription.read`; paying needs `subscription.manage` (Manager can view, not pay; Cashier neither; tested).
- Payment confirmations, rejections, reversals, flags, plan and settings changes and platform-flag grants are audited.

## 6. Outstanding issues and open decisions

1. **No real payment provider is integrated.** D-006 still needs a provider choice. Until then platform staff confirm every payment by hand. Automatic recurring mobile-money deductions are not supported or claimed.
2. **Plan names, prices and features have not been decided.** Shops cannot pay until platform staff add at least one plan and the payment instructions on `/platform`.
3. **Read-only mode covers staff invitations only so far.** Sales, purchases and stock routes do not exist yet; their phases must mark them with `@RequireWritable()`. Export (allowed when read-only) arrives in Phase 09.
4. Only the `seats` feature is enforced. `products`, `offline_sales`, `profit_reports` and `export` are stored per plan and enforced by Phases 05, 10 and 09.
5. Reminders are email only (no SMS). The "on expiry day" email is sent only if the job runs within a day of the end, which it does every 5 minutes when running.
6. Subscription emails are English only, like the other emails.
7. Each API instance runs the reminder and reconciliation jobs; duplicates are prevented by the reminder table and payment locks, but a multi-instance run was not tested.
8. A-002, A-003, D-012 and SMTP (Phase 02 decision card) and A-015 to A-022 remain Proposed.

## 7. Acceptance criteria (AC-04)

| Criterion | Result |
|---|---|
| Plans (weekly, monthly) are configurable data, not code | Met |
| A browser redirect alone never activates a subscription | Met |
| Invalid callback signature rejected and logged, no state change | Met |
| Same callback twice gives one confirmation | Met |
| Delayed callback after expiry applied and extends correctly | Met |
| Failed or reversed payment does not grant, or removes, the time | Met |
| Expired subscription restricts defined features; data readable | Met for the routes that exist (staff invitations); later phases mark theirs |
| Entitlement checks separate from permission checks | Met |

## 8. Not verified

- GitHub Actions has not run Phase 04 yet; it runs when the PR opens.
- The Docker images were built with the local certificate workaround described in Phase 01, and, because Docker Hub answered "429 Too Many Requests", pulled the same official `node:22-alpine` image from its public mirror `public.ecr.aws/docker/library/node`. The committed Dockerfiles are unchanged.
- No real mobile-money provider or real email provider was used.

## 9. Recommended next phase

**Phase 05 — Products and inventory.** Blockers: owner acceptance of Phase 04, and decisions D-007 (negative stock) and D-013 (fractional quantities). D-021 (money precision and rounding) is also needed before prices are stored.
