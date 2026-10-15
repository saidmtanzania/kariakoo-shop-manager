# Logical Data Model — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft logical model — **not** a final Prisma schema |
| Last updated | 2026-10-15 (Phase 02: identity and tenancy tables implemented) |

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

### Initial permission catalog (shop scope)

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
| **outbox_messages** | id, shop_id, type, payload jsonb, status (`PENDING`,`PROCESSING`,`DONE`,`FAILED`), attempts, available_at, last_error | Polled with SKIP LOCKED. |
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
