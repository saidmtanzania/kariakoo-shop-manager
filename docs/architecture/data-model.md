# Logical Data Model — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft logical model — **not** a final Prisma schema |
| Last updated | 2026-10-15 (Phase 02: identity and tenancy tables; Phase 03: roles, invitations and outbox) |

## 1. Conventions

- Table names `snake_case` plural; Prisma models `PascalCase` singular mapped with `@@map`.
- `id uuid` (UUID v7) primary keys [A-008].
- Every shop-owned table has `shop_id uuid not null` and an index starting with `shop_id`. Child tables also carry `shop_id` (denormalised) so tenant filters and composite FKs `(shop_id, parent_id)` are possible.
- Money: `numeric(18,2)`; average unit cost: `numeric(18,4)`; quantities: `numeric(18,3)` [D-013, D-021].
- `created_at`, `updated_at` (`timestamptz`); `created_by_membership_id` on business records.
- Financial and ledger tables are **append-only**: no `UPDATE` of amounts, no `DELETE`. Status columns may change only through defined state transitions.
- Soft archive (`archived_at`) for master data (products, customers, suppliers); no hard deletes of anything referenced by transactions.
- Enumerations shown in `UPPER_CASE`.

## 2. Identity and tenancy

| Entity | Key fields | Constraints / notes |
|---|---|---|
| **users** | id, email (citext), password_hash, full_name, phone, email_verified_at, status (`ACTIVE`,`DISABLED`), is_platform_admin | unique(email). Global, not shop-scoped. |
| **sessions** | id, user_id, token_hash, active_shop_id, ip, user_agent, created_at, expires_at, revoked_at | unique(token_hash). Server-side sessions [A-003]. |
| **auth_tokens** | id, user_id, purpose (`EMAIL_VERIFY`,`PASSWORD_RESET`), token_hash, expires_at, used_at | single-use. |
| **shops** | id, name, phone, address, business_type, timezone (default `Africa/Dar_es_Salaam`), currency (`TZS`), status (`ACTIVE`,`RESTRICTED`,`SUSPENDED`), settings jsonb (negative stock, credit limits enabled, receipt footer…) | |
| **shop_memberships** | id, shop_id, user_id, status (`ACTIVE`,`SUSPENDED`,`REMOVED`), is_owner, joined_at | unique(shop_id, user_id). |
| **invitations** | id, shop_id, email, token_hash, status (`PENDING`,`ACCEPTED`,`EXPIRED`,`REVOKED`), role_ids (via invitation_roles), invited_by_membership_id, expires_at, accepted_at, accepted_user_id, resend_count | unique(token_hash); partial unique(shop_id, email) where status = PENDING. |
| **pos_devices** | id, shop_id, name, credential_hash, offline_enabled, registered_by, revoked_at, last_sync_at | Phase 10 [D-004]. |

### Implemented in Phase 02 (migration `20261015055844_auth_and_tenancy`)

`backend/prisma/schema.prisma` is the source of truth. Differences from the logical rows above:

| Table | As built |
|---|---|
| `users` | As above. `email` is `citext`, so uniqueness ignores case. |
| `sessions` | Adds `last_seen_at` and `idle_expires_at` (12 h idle, 7 day absolute by default). `token_hash` is `char(64)` (SHA-256 hex). `active_shop_id` references `shops` and is cleared if the shop is deleted. |
| `auth_tokens` | As above, plus `created_at`. Issuing a new token marks older unused tokens of the same purpose as used. |
| `shops` | As above without `settings` (no settings exist yet). `business_type` is `WHOLESALE`, `RETAIL` or `BOTH`. |
| `shop_memberships` | As above, plus `updated_at` and `unique(shop_id, id)` so later tables can use composite foreign keys `(shop_id, membership_id)`. |
| `audit_logs` | Built now (listed in section 11). Append-only is enforced by a trigger that rejects every `UPDATE` and `DELETE`, which also covers the application's own database role. |
| `rate_limit_counters` | New infrastructure table: `key`, `window_start`, `hits`, `expires_at`. Fixed-window counters for sign-in, sign-up and recovery limits. Global, not shop-scoped. |

Tenant classification lives in `backend/src/database/tenant-scope.ts`: `shops`, `shop_memberships` and `audit_logs` are shop-owned; `users`, `sessions`, `auth_tokens` and `rate_limit_counters` are global. An integration test fails if a new model is added without being classified.

## 3. Authorization

| Entity | Key fields | Notes |
|---|---|---|
| **permissions** | code (pk, e.g. `sales.create`), module, description, scope (`SHOP`,`PLATFORM`), delegable bool | Seeded catalog; read-only to shops. |
| **roles** | id, shop_id (null for platform/system templates), name, is_system, template_key | unique(shop_id, name). |
| **role_permissions** | role_id, permission_code | pk(role_id, permission_code); trigger/service rule: shop roles may only reference `SHOP` + delegable permissions. |
| **membership_roles** | membership_id, role_id, shop_id | pk(membership_id, role_id); role.shop_id must equal membership.shop_id. |
| **invitation_roles** | invitation_id, role_id | |

### Implemented in Phase 03 (migration `20261015063853_rbac_and_invitations`)

| Table | As built |
|---|---|
| `permissions` | `code` (pk), `module`, `scope` (`SHOP`, `PLATFORM`), `delegable`. No `description`: labels are translated in the web app. The 48 rows are inserted by the migration from the catalog in `packages/shared/src/permissions.ts` (decision A-015); a test compares the two. |
| `roles` | `id`, `shop_id` (required: there are no platform or system roles yet), `name` (`citext`, `unique(shop_id, name)`), `template_key` (`manager`, `cashier`, `storekeeper` for the defaults, decision A-017), timestamps, `unique(shop_id, id)`. No `is_system`: owners use `shop_memberships.is_owner` instead of a system role (decision A-016). |
| `role_permissions` | `shop_id`, `role_id`, `permission_code`; pk(`role_id`, `permission_code`); foreign key `(shop_id, role_id)` to `roles` (cascade). Trigger `role_permissions_shop_scope_only` rejects permissions that are not `SHOP` scope and delegable. |
| `membership_roles` | `shop_id`, `membership_id`, `role_id`; pk(`membership_id`, `role_id`); foreign keys `(shop_id, membership_id)` (cascade) and `(shop_id, role_id)` (restrict), so a role can only be given within its own shop and an assigned role cannot be deleted. |
| `invitations` | `id`, `shop_id`, `email` (`citext`), `token_hash` (unique, SHA-256 hex), `status` (`PENDING`, `ACCEPTED`, `EXPIRED`, `REVOKED`), `invited_by_membership_id`, `expires_at`, `accepted_at`, `accepted_user_id`, `revoked_at`, `resend_count`, timestamps, `unique(shop_id, id)`. A pending invitation past `expires_at` is reported as `EXPIRED`. One pending invitation per shop and email is enforced by the service under a shop row lock (decision A-018). |
| `invitation_roles` | `shop_id`, `invitation_id`, `role_id`; composite foreign keys to both, within one shop. |
| `outbox_messages` | Built now (listed in section 11): `id`, `shop_id` (null for sign-up and recovery email), `type`, `payload` jsonb, `status` (`PENDING`, `PROCESSING`, `DONE`, `FAILED`), `attempts`, `available_at`, `locked_until`, `last_error`, `processed_at`, `created_at`. |

Tenant classification: `roles`, `role_permissions`, `membership_roles`, `invitations`, `invitation_roles` and `outbox_messages` are shop-owned (outbox rows without a shop are written only through the unscoped client); `permissions` is global.

### Initial permission catalog (shop scope)

Labels, modules and default roles: `docs/security/permission-catalog.md`.

`dashboard.read`, `products.read`, `products.create`, `products.update`, `products.archive`, `products.prices.update`, `inventory.read`, `inventory.adjust`, `inventory.opening`, `suppliers.read`, `suppliers.manage`, `purchases.read`, `purchases.create`, `purchases.receive`, `purchases.cancel`, `supplier_payments.create`, `sales.read`, `sales.read_all` (vs own only), `sales.create`, `sales.discount`, `sales.credit`, `sales.refund`, `sales.void`, `customers.read`, `customers.manage`, `customers.credit.manage`, `expenses.read`, `expenses.create`, `expenses.void`, `cash_sessions.open`, `cash_sessions.close`, `cash_sessions.review`, `reports.read`, `reports.profit.read`, `reports.export`, `users.read`, `users.invite`, `users.manage`, `roles.manage`, `audit.read`, `subscription.read`, `subscription.manage`, `settings.manage`, `devices.manage`.

Platform scope (never delegable): `platform.shops.manage`, `platform.plans.manage`, `platform.payments.reconcile`, `platform.support.access`.

## 4. Subscription and billing

| Entity | Key fields | Notes |
|---|---|---|
| **plans** | id, code, name, interval (`WEEK`,`MONTH`), price numeric, currency, active, grace_days | |
| **plan_features** | plan_id, feature_key, limit_value (int, nullable = unlimited), enabled | e.g. `seats`, `products`, `offline_sales`, `profit_reports`, `export`. |
| **subscriptions** | id, shop_id (unique), plan_id, status (`TRIALING`,`ACTIVE`,`GRACE`,`RESTRICTED`,`CANCELLED`), current_period_start, current_period_end, grace_until | One per shop [D-001]. |
| **subscription_periods** | id, subscription_id, plan_id, period_start, period_end, payment_id | History; append-only. |
| **subscription_payments** | id, shop_id, subscription_id, plan_id, amount, provider, provider_reference, payer_phone, status (`INITIATED`,`PENDING`,`CONFIRMED`,`FAILED`,`EXPIRED`,`REVERSED`), idempotency_key, confirmed_at | unique(provider, provider_reference). |
| **payment_events** | id, provider, provider_event_id, payload jsonb, signature_valid, received_at, processed_at, related_payment_type/id | unique(provider, provider_event_id) — dedup for callbacks (POS and subscription). |

### Implemented in Phase 04 (migration `20261016060401_subscriptions`)

The design above changed in these ways when built (decisions D-005, D-006, D-019, A-019 to A-022):

| Table | As built |
|---|---|
| `plans` | `id`, `code` (unique), `name`, `interval` (`WEEK`, `MONTH`; fixed once created), `price` numeric(18,2) ≥ 0, `currency` (default `TZS`), `active`, `grace_days` (0–60, default 3), `sort_order`, timestamps. No rows are inserted: platform staff enter plans. |
| `plan_features` | pk(`plan_id`, `feature_key`), `enabled`, `limit_value` (null = unlimited, ≥ 0). A feature without a row is not included; a plan without a `seats` row allows the owner only. |
| `billing_settings` | One row (`id` = 1, enforced by a check): `trial_days` (0–90, default 14), `reminder_days_before` (0–30, default 3), `payment_instructions` (shown to shops paying manually). The migration inserts the approved defaults. |
| `subscriptions` | `id`, `shop_id` (unique, one per shop, D-001), `plan_id` (plan of the latest paid period, null while only trialing), `trial_ends_at`, `paid_until` (null if never paid), `grace_days` (copied from the plan when a period is confirmed), timestamps. **No status column:** status is derived from the dates when read (A-019). The migration starts a 14-day trial for every existing shop. |
| `subscription_periods` | `id`, `shop_id`, `subscription_id`, `plan_id`, `payment_id` (unique), `interval`, `period_start`, `period_end` (> start), `created_at` (= confirmation time), `reversed_at`. Trigger `subscription_periods_append_only`: no delete; the only update allowed is setting `reversed_at` once. |
| `subscription_payments` | `id`, `shop_id`, `subscription_id`, `plan_id`, `amount` (snapshot of the plan price when started), `currency`, `provider` (`manual`, `sandbox`), `provider_reference` (the mobile-money transaction id for manual payments, upper-cased), `payer_phone`, `status` (`PENDING`, `CONFIRMED`, `FAILED`, `REVERSED`), `idempotency_key`, `initiated_by_user_id`, `decided_by_user_id` (null when a provider decided), `confirmed_at`, `failed_at`, `reversed_at`, `note`, `needs_review`, timestamps. Unique (`provider`, `provider_reference`): a reference can be submitted once by any shop. Unique (`shop_id`, `idempotency_key`). |
| `payment_events` | `id`, `provider`, `provider_event_id`, `payload` jsonb (at most 8,000 characters kept), `signature_valid`, `outcome`, `payment_id`, `received_at`, `processed_at`. Unique (`provider`, `provider_event_id`); invalid callbacks are keyed by a hash of their body. Trigger `payment_events_no_delete`. |
| `subscription_reminders` | pk(`subscription_id`, `kind`, `due_at`), `shop_id`, `created_at`. One row per reminder sent (`expiring`, `expired`) for one end date, so each is sent once. |

Status rule (`packages/shared/src/subscriptions.ts`): TRIALING before `trial_ends_at`; otherwise ACTIVE before `paid_until`; otherwise GRACE until `paid_until + grace_days`; otherwise RESTRICTED. An unpaid trial has no grace. Full access ends at the later of `trial_ends_at` and `paid_until`.

Tenant classification: `subscriptions`, `subscription_periods`, `subscription_payments` and `subscription_reminders` are shop-owned; `plans`, `plan_features`, `billing_settings` and `payment_events` are global (a callback's shop is known only after it is verified).

## 5. Products

| Entity | Key fields | Notes |
|---|---|---|
| **product_categories** | id, shop_id, name, parent_id (optional) | unique(shop_id, name). |
| **products** | id, shop_id, category_id, name, sku, base_unit_name (e.g. "piece"), reorder_level (base qty), track_stock bool, archived_at | unique(shop_id, sku). |
| **product_units** | id, shop_id, product_id, name ("carton"), conversion_to_base numeric(18,3) > 0, is_base bool, barcode, retail_price, wholesale_price, is_sellable, is_purchasable, archived_at | exactly one is_base per product with conversion = 1; unique(shop_id, barcode) where barcode not null; conversion immutable once used. |
| **price_history** | id, shop_id, product_unit_id, retail_price, wholesale_price, changed_by, changed_at | Audit of price changes. |

## 6. Inventory

| Entity | Key fields | Notes |
|---|---|---|
| **stock_locations** | id, shop_id, name, is_default | One default location initially; designed for branches later [D-002]. |
| **stock_balances** | shop_id, product_id, location_id, quantity (base), average_unit_cost numeric(18,4), version int | pk(shop_id, product_id, location_id); `CHECK (quantity >= 0)` unless [D-007] allows negatives. |
| **stock_movements** | id, shop_id, product_id, location_id, type (`OPENING`,`PURCHASE_RECEIPT`,`PURCHASE_REVERSAL`,`SALE`,`SALE_RETURN`,`ADJUSTMENT_IN`,`ADJUSTMENT_OUT`,`TRANSFER_IN`,`TRANSFER_OUT`,`OFFLINE_SYNC_EXCEPTION`), quantity (signed, base units), unit_cost (snapshot), unit_id + unit_quantity + conversion (as entered), reference_type, reference_id, reason, note, created_by, created_at | Append-only. Index (shop_id, product_id, created_at). |
| **stock_adjustments** | id, shop_id, reason_code, note, created_by, created_at (+ lines via movements) | Groups adjustment movements for audit/approval. |

**Invariant:** for every (shop, product, location): `stock_balances.quantity = Σ stock_movements.quantity`. Checked by a nightly reconciliation job and in tests.

### Implemented in Phase 05 (migration `20261016073000_products_and_inventory`)

The design in sections 5 and 6 changed in these ways when built (decisions D-002, D-003, D-007, D-013, D-021, A-023 to A-026):

| Table | As built |
|---|---|
| `shops` | New column `allow_negative_stock` (default false, D-007), changed only by an owner. |
| `stock_locations` | `id`, `shop_id`, `name` (unique per shop), `is_default`, `created_at`. Every new shop gets a default location "Main" in the same transaction; the migration adds one for each existing shop. Phase 05 uses only the default location (D-002). |
| `product_categories` | `id`, `shop_id`, `name` (citext, unique per shop), `archived_at`, timestamps. No `parent_id`: categories are one level until needed. |
| `products` | `id`, `shop_id`, `category_id`, `name` (≤ 160), `sku` (citext, unique per shop when set), `reorder_level` numeric(18,3) ≥ 0 in base units, `archived_at`, `created_by_membership_id`, timestamps. No `base_unit_name` or `track_stock`: the base unit is the `product_units` row with `is_base`, and every product tracks stock. Name search uses a trigram GIN index (`pg_trgm`). Trigger `products_no_delete`. |
| `product_units` | `id`, `shop_id`, `product_id`, `name` (citext, unique per product), `conversion` numeric(18,3) > 0 (base unit = 1), `is_base`, `allow_fraction` (D-013), `barcode` (unique per shop when set), `buying_price`, `retail_price`, `wholesale_price` numeric(18,2), whole shillings ≥ 0 (D-021), `archived_at`, timestamps. No `is_sellable` / `is_purchasable` yet. Trigger `product_units_fixed_fields`: no delete; `conversion`, `is_base`, `product_id` and `shop_id` never change; one base unit per product. |
| `price_history` | `id`, `shop_id`, `product_unit_id`, `buying_price`, `retail_price`, `wholesale_price`, `changed_by_membership_id`, `changed_at`. One row per price change, including the first prices. Append-only. |
| `stock_balances` | pk(`shop_id`, `product_id`, `location_id`), `quantity` numeric(18,3) in base units, `average_cost` numeric(18,4) ≥ 0 per base unit (D-003), `updated_at`. No `version` column: changes take a row lock (A-006). No `quantity >= 0` check, because D-007 lets an owner allow sales below zero; the ledger service enforces the rule. |
| `stock_adjustments` | `id`, `shop_id`, `reason` (`COUNT_CORRECTION`, `DAMAGED`, `EXPIRED`, `LOST`, `FOUND`, `OWN_USE`, `OTHER`), `note`, `idempotency_key` (unique per shop), `request_hash` (SHA-256 of the request, so the same key with different details is refused), `created_by_membership_id`, `created_at`. Append-only. |
| `stock_movements` | `id`, `shop_id`, `product_id`, `location_id`, `type` (Phase 05: `OPENING`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`; later phases add their own), `quantity` (signed, base units, never 0; sign must match the type), `balance_after`, `unit_cost` per base unit, the entered `unit_id`, `unit_name`, `unit_quantity` and `conversion` (snapshot), `adjustment_id` and `reason` (required for adjustments), `note`, `created_by_membership_id`, `created_at`. Append-only. Indexes (`shop_id`, `product_id`, `created_at`) and (`shop_id`, `created_at`). |

Quantities are `numeric(18,3)`; money is `numeric(18,2)`; average cost is `numeric(18,4)`. The API sends all of them as decimal strings, and code does the arithmetic on scaled integers (`packages/shared/src/decimal.ts`), never on floating-point numbers.

The invariant above is checked on demand by `GET /api/v1/shops/current/inventory/reconciliation` and in tests. The nightly job arrives with operations work (Phase 11).

Tenant classification: all eight tables are shop-owned and go through the shop-scoped client.

## 7. Procurement

| Entity | Key fields | Notes |
|---|---|---|
| **suppliers** | id, shop_id, name, phone, notes, archived_at | |
| **purchases** | id, shop_id, supplier_id, number (per-shop sequence), status (`DRAFT`,`RECEIVED`,`PARTIALLY_RECEIVED`,`CANCELLED`), purchase_date, subtotal, extra_costs [D-015], total, idempotency_key, received_at | unique(shop_id, number). |
| **purchase_items** | id, shop_id, purchase_id, product_id, unit_id, conversion snapshot, quantity_ordered, quantity_received, unit_cost, line_total | Base qty derived = quantity × conversion. |
| **supplier_ledger_entries** | id, shop_id, supplier_id, type (`PURCHASE`,`PAYMENT`,`REVERSAL`,`ADJUSTMENT`), amount (signed: + owed, − paid), reference_type/id, created_at | Append-only; balance = Σ amount. |
| **supplier_payments** | id, shop_id, supplier_id, amount, method, reference, cash_session_id (nullable), idempotency_key | |
| **supplier_payment_allocations** | id, shop_id, supplier_payment_id, purchase_id, amount | Σ ≤ payment amount; Σ per purchase ≤ purchase outstanding. |

## 8. Sales

| Entity | Key fields | Notes |
|---|---|---|
| **sales** | id, shop_id, location_id, number (per-shop sequence), customer_id (nullable), cashier_membership_id, cash_session_id, status (`COMPLETED`,`PARTIALLY_REFUNDED`,`REFUNDED`,`VOIDED`,`NEEDS_REVIEW`), price_mode, subtotal, discount_total, total, paid_confirmed, paid_pending, credit_amount, source (`ONLINE`,`OFFLINE_SYNC`), offline_operation_id, device_id, sold_at (client time for offline), recorded_at | unique(shop_id, number); unique(shop_id, offline_operation_id). |
| **sale_items** | id, shop_id, sale_id, product_id, unit_id, unit_name snapshot, conversion snapshot, quantity, base_quantity, price_type (`RETAIL`,`WHOLESALE`), unit_price, discount_amount, line_total, unit_cost_snapshot (per base unit), cost_total | Immutable. |
| **sale_payments** | id, shop_id, sale_id, method (`CASH`,`MOBILE_MONEY`,`BANK`,`CARD`), provider, amount, status (`PENDING`,`CONFIRMED`,`FAILED`,`EXPIRED`,`REVERSED`), provider_reference, payer_phone, cash_session_id, confirmed_at | Only `CONFIRMED` counts as paid. unique(provider, provider_reference) where not null. |
| **refunds** | id, shop_id, sale_id, number, reason, refund_method, amount, restock bool, approved_by, cash_session_id, idempotency_key, created_at | |
| **refund_items** | id, shop_id, refund_id, sale_item_id, quantity, base_quantity, amount, unit_cost_snapshot | Σ refunded qty per sale_item ≤ sold qty. |

Credit amount on a sale is represented by a customer ledger entry, not a payment row.

## 9. Customers and credit

| Entity | Key fields | Notes |
|---|---|---|
| **customers** | id, shop_id, name, phone, business_name, credit_limit (nullable) [D-016], archived_at | unique(shop_id, phone) where not null [A]. |
| **customer_ledger_entries** | id, shop_id, customer_id, type (`CREDIT_SALE`,`PAYMENT`,`REFUND_CREDIT`,`REVERSAL`,`ADJUSTMENT`, `OPENING_BALANCE`), amount (signed: + owed by customer, − paid), reference_type/id, due_date, created_by, created_at | Append-only; balance = Σ amount. |
| **customer_payments** | id, shop_id, customer_id, amount, method, reference, status, cash_session_id, idempotency_key | |
| **customer_payment_allocations** | id, shop_id, customer_payment_id, sale_id, amount | Σ per payment ≤ payment amount; Σ per sale ≤ sale credit outstanding; unique(customer_payment_id, sale_id). |

## 10. Cash and expenses

| Entity | Key fields | Notes |
|---|---|---|
| **cash_sessions** | id, shop_id, location_id, membership_id, status (`OPEN`,`CLOSED`,`REVIEWED`), opening_float, opened_at, expected_cash, counted_cash, difference, difference_reason, closed_at, reviewed_by, review_note | partial unique(shop_id, membership_id) where status = OPEN. |
| **cash_movements** | id, shop_id, cash_session_id, type (`SALE`,`REFUND`,`EXPENSE`,`PAY_IN`,`PAY_OUT`,`CUSTOMER_PAYMENT`,`SUPPLIER_PAYMENT`), amount (signed), reference_type/id, note, created_by | Expected cash = opening_float + Σ amount. |
| **expense_categories** | id, shop_id, name | |
| **expenses** | id, shop_id, category_id, amount, method, expense_date, note, cash_session_id, status (`RECORDED`,`VOIDED`), voided_by, void_reason | Void creates a reversing cash movement; no edits. |

## 11. Reliability and auditing

| Entity | Key fields | Notes |
|---|---|---|
| **audit_logs** | id, shop_id (nullable for platform), actor_user_id, actor_membership_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, created_at | Append-only. Built in Phase 02 with a trigger that rejects UPDATE and DELETE (see section 2). |
| **idempotency_records** | id, shop_id, scope (e.g. `sale.create`), key, request_hash, status (`IN_PROGRESS`,`COMPLETED`), response_code, response_body jsonb, created_at, expires_at | unique(shop_id, scope, key). Same key + different request_hash → 409. |
| **outbox_messages** | id, shop_id, type, payload jsonb, status (`PENDING`,`PROCESSING`,`DONE`,`FAILED`), attempts, available_at, last_error | Polled with SKIP LOCKED. Built in Phase 03 (see section 3). |
| **document_sequences** | shop_id, doc_type, next_value | Per-shop gapless-ish numbering for sales/purchases/refunds, incremented with row lock in the same transaction. |

## 12. Costing (weighted average) [D-003 — recommended]

On receipt of `q` base units at unit cost `c` into a balance with quantity `Q` and average cost `A`:

```
A' = (Q·A + q·c) / (Q + q)      if Q + q > 0   (if Q ≤ 0, A' = c)
```

- Sale lines snapshot `A` at the moment of sale (`unit_cost_snapshot`); COGS = Σ base_quantity × snapshot.
- Returns restock at the original line's snapshot cost and recompute A'.
- Adjustments out use current A; adjustments in use current A unless a cost is entered.
- Rounding: A stored at 4 decimals.

Worked example (illustrative): balance 24 pieces @ 1,800; receive 2 cartons (24 pieces) @ 21,600/carton = 1,800/piece → A' = 1,800. Receive 1 carton @ 24,000 (2,000/piece) → A' = (48·1,800 + 12·2,000)/60 = 1,840.

## 13. Workflow traceability

| Workflow | Entities written | Supported? |
|---|---|---|
| WF-01 Register / create shop | users, auth_tokens, shops, stock_locations, shop_memberships, roles, membership_roles, subscriptions, audit_logs | Yes |
| WF-02 Login / switch shop | sessions, auth_tokens | Yes |
| WF-03 Invite staff | invitations, invitation_roles, outbox_messages, shop_memberships, membership_roles, audit_logs | Yes |
| WF-04 Custom role | roles, role_permissions, audit_logs | Yes |
| WF-05 Product + units | products, product_units, price_history, stock_movements (OPENING), stock_balances | Yes |
| WF-06 Adjust stock | stock_adjustments, stock_movements, stock_balances, audit_logs | Yes |
| WF-07 Purchase / receive | purchases, purchase_items, stock_movements, stock_balances, supplier_ledger_entries, supplier_payments, allocations, cash_movements, idempotency_records | Yes (partial receipt via quantity_received) |
| WF-08 Sale | sales, sale_items, sale_payments, stock_movements, stock_balances, customer_ledger_entries, cash_movements, idempotency_records, outbox_messages, audit_logs | Yes |
| WF-08a Mobile money | sale_payments, payment_events, outbox_messages | Yes |
| WF-09 Refund | refunds, refund_items, stock_movements, stock_balances, cash_movements / customer_ledger_entries, audit_logs | Yes |
| WF-10 Customer payment | customer_payments, customer_payment_allocations, customer_ledger_entries, cash_movements, idempotency_records | Yes |
| WF-11 Expense | expenses, cash_movements, audit_logs | Yes |
| WF-12 Cash session | cash_sessions, cash_movements | Yes |
| WF-13 Subscription | subscription_payments, payment_events, subscriptions, subscription_periods | Yes |
| WF-14 Reports | read-only over the above | Yes, contingent on D-003 for profit/valuation |
| WF-15 Offline sale | pos_devices, sales (source OFFLINE_SYNC, offline_operation_id), idempotency_records, stock_movements (OFFLINE_SYNC_EXCEPTION) | Yes, contingent on D-004/D-007 |
| WF-16 Platform admin | plans, plan_features, audit_logs | Yes |

## 14. Safety review

| Concern | How the model supports it |
|---|---|
| Atomic sale | All sale rows, movements, balances, payments, ledger and idempotency record share one transaction; provider calls via outbox after commit. |
| Overselling | Conditional decrement / row lock on `stock_balances`; CHECK constraint as last line of defence. |
| Duplicate submissions | `idempotency_records` unique key + request hash; `offline_operation_id` unique; provider reference unique. |
| Tenant isolation | `shop_id` on every row, composite FKs, repository/extension enforcement, optional RLS [A-002]. |
| Auditability | Append-only ledgers and movements; compensating records; audit_logs for sensitive actions. |
| Money precision | numeric columns; decimal library (e.g. `decimal.js` / Prisma Decimal) in services; strings over the wire. |
| History preservation | Snapshots on sale/purchase lines; unit conversions immutable once used; archive instead of delete. |

## 15. Deliberately excluded until decided

Branch-specific pricing and transfers [D-002], tax lines [D-009], multi-currency, landed costs [D-015], purchase orders workflow [D-014], loyalty, serial/batch/expiry tracking.
