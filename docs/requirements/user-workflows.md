# User Workflows — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-12 |

Notation: **Actor**, **Permission**, **Preconditions**, **Main flow**, **Failure paths**, **Records written**. Decision references (D-xxx) point to the [decision register](../decisions/decision-register.md). All shop-scoped steps assume the server has validated the user's membership in the active shop.

---

## WF-01 Register and create a shop

- **Actor:** New user. **Permission:** none (public).
- **Main flow:**
  1. User enters name, email, password; accepts terms.
  2. Server creates `User` (password hashed with Argon2id), sends email verification.
  3. User verifies email (link with single-use hashed token).
  4. User creates a shop: name, phone, area/market (e.g. Kariakoo), business type (wholesale/retail/both).
  5. Server creates `Shop`, default `StockLocation` ("Main"), owner `ShopMembership`, system roles (Owner, Manager, Cashier) seeded from templates, and a `Subscription` in trial or unpaid state [D-019].
  6. User lands on an empty Overview with "Add your first product" guidance.
- **Failure paths:** email already registered (generic message, no enumeration); weak password; verification token expired → resend; rate limit exceeded.
- **Records:** User, EmailVerificationToken, Shop, StockLocation, ShopMembership, Roles, MembershipRole, Subscription, AuditLog.

## WF-02 Log in, choose shop, log out, recover account

1. Login with email + password → server session created (httpOnly cookie) [A-003].
2. If the user has several memberships, choose the active shop; the server stores the active shop on the session after validating membership.
3. Switching shop re-validates membership; permissions are recalculated.
4. Logout deletes the server session.
5. Recovery: request reset → email with hashed single-use token (e.g. 30 min) → new password → all other sessions revoked.
- **Failure paths:** wrong credentials (generic error), locked after repeated failures (progressive delay), suspended membership, shop suspended by platform admin.

## WF-03 Invite staff and assign roles

- **Actor:** Owner/manager. **Permission:** `users.invite`, `roles.manage` for role editing.
1. Enter email and choose one or more roles.
2. Server checks plan seat limit (active members + pending invitations ≤ seats) [D-005].
3. Server checks the inviter can delegate every permission in the chosen roles.
4. Invitation created (state `PENDING`, token hash, expiry e.g. 7 days); email sent through the outbox.
5. Invitee opens link → signs in or registers with the **same email** → accepts → membership created, invitation `ACCEPTED`, token consumed.
6. Inviter can resend (rotates token, extends expiry) or revoke (`REVOKED`).
- **Failure paths:** expired, revoked, already used, email mismatch, seat limit reached, invitee already a member.

## WF-04 Create a custom role

- **Permission:** `roles.manage`.
1. Name the role, tick permissions from the shop-level catalog (grouped by module).
2. Server rejects any permission that is platform-only or that the actor does not hold (no escalation).
3. Role saved; changes to an assigned role apply on the members' next request. Audit entry records before/after.

## WF-05 Add a product with units and prices

- **Permission:** `products.create`.
1. Enter name, category, SKU (auto-suggested), base unit (e.g. piece), reorder level.
2. Add units: e.g. "Carton = 12 pieces", "Dozen = 12 pieces". Each unit: conversion factor to base, optional barcode, retail price, wholesale price.
3. Optionally enter opening stock and opening unit cost → `OPENING` stock movement.
- **Failure paths:** duplicate SKU/barcode in the same shop, conversion ≤ 0, price < 0, plan product limit reached.
- **Note:** changing a unit's conversion after it has been used is blocked; create a new unit and archive the old one (preserves history).

## WF-06 Adjust stock

- **Permission:** `inventory.adjust`.
1. Choose product, enter counted quantity or a +/- change, in any unit (converted to base).
2. Choose reason: damaged, lost/theft, count correction, expired, other (note required).
3. Server writes `ADJUSTMENT` movement and updates balance in one transaction; audit entry.
- **Failure paths:** result negative [D-007]; concurrent change → the operation retries on the current balance or reports a conflict.

## WF-07 Record a purchase and receive stock

- **Permission:** `purchases.create`, `purchases.receive`.
1. Select supplier (or create), add items (product, unit, quantity, unit cost).
2. Save as draft (optional) [D-014] → receive (full; partial receiving [D-014]).
3. On receipt (one transaction): `PURCHASE_RECEIPT` movements in base units, balance update, weighted-average cost recalculated [D-003], supplier ledger debit (amount owed).
4. Optionally record payment now (cash/mobile money/bank) → supplier ledger credit, cash movement if cash from drawer.
- **Failure paths:** duplicate submission (idempotency key), receiving an already received purchase, zero/negative quantities, cross-tenant supplier ID.
- **Corrections:** cancel a received purchase → reversing movements and ledger entries (blocked if it would make stock negative) [D-007].

## WF-08 Make a sale (online)

- **Actor:** Cashier. **Permission:** `sales.create`; `sales.discount` for discounts; `customers.credit.manage` (or `sales.credit`) for credit.
- **Preconditions:** open cashier session if required [D-018].
1. Search or scan product → choose unit → price defaults to retail; cashier may switch to wholesale [D-008].
2. Adjust quantities; apply discount if permitted (limit [D-010]).
3. Optionally attach a customer (required for credit).
4. Take payment: one or more of cash (amount tendered → change), mobile money (manual reference or STK push), credit.
5. Client sends the sale with an `Idempotency-Key` (UUID generated when the cart is opened).
6. Server, in one transaction: validates membership, permissions, prices, stock; locks affected balances; writes Sale, SaleItems (with snapshots), StockMovements, StockBalance updates, SalePayments (cash = `CONFIRMED`; STK push = `PENDING`), CustomerLedgerEntry for credit, CashMovement for cash, IdempotencyRecord, AuditLog for discounts; outbox message for receipt/notifications.
7. Receipt displayed; status "Paid", "Partly paid – awaiting mobile money", or "On credit".
- **Failure paths:** insufficient stock (sale rejected, lines highlighted); price changed since cart loaded (server price wins; cashier confirms); retry with same key → same result returned, no duplicate; mobile money fails → sale stays with outstanding balance until another payment method is taken or the sale is voided (void and abandonment rules [D-011]).

### WF-08a Mobile-money payment states

`INITIATED → PENDING → CONFIRMED` or `→ FAILED` / `→ EXPIRED`; `CONFIRMED → REVERSED` (provider reversal). Only `CONFIRMED` counts as paid. Callbacks are signature-verified, deduplicated by provider transaction ID and applied idempotently. A reconciliation job queries the provider for long-pending payments.

Manual mobile-money entry (cashier types the customer's M-Pesa/Mixx reference after seeing the SMS) is the simplest first option; whether it counts as confirmed immediately or requires manager verification is [D-006].

## WF-09 Return / refund

- **Permission:** `sales.refund`.
1. Find original sale (receipt number or search).
2. Select lines and quantities to return (≤ sold − already returned); choose whether goods go back to sellable stock or are written off.
3. Refund method: cash (from current session), mobile money (manual), or credit to customer balance.
4. Server writes Refund, RefundItems, `RETURN` stock movements (at the original cost snapshot), payment/ledger entries, audit log. The original sale is never edited; its status becomes `PARTIALLY_REFUNDED`/`REFUNDED`.
- **Policy questions:** time limit, approval requirement, restocking fee [D-011].

## WF-10 Receive customer payment on credit

- **Permission:** `customers.credit.manage`.
1. Open customer → see balance, statement, overdue items.
2. Record payment (amount, method, reference).
3. Allocate oldest-first automatically or manually to specific sales; unallocated remainder handling [D-017].
4. Ledger credit entry + allocations in one transaction; idempotency key prevents duplicates.

## WF-11 Record an expense

- **Permission:** `expenses.create`.
1. Category (rent, transport, porter/kuli, electricity, salaries, other), amount, method, date, note.
2. Cash expenses during an open session reduce expected cash.
3. Corrections by reversal entry (`expenses.void`), not editing.

## WF-12 Cashier session open / close

- **Permission:** `cash_sessions.open`, `cash_sessions.close`; `cash_sessions.review` for managers.
1. Open: enter opening float (counted).
2. During session: cash sales, cash refunds, pay-ins/pay-outs, cash expenses accrue.
3. Close: count cash (optionally by denomination); server computes expected = opening + cash in − cash out; difference shown; explanation required if ≠ 0.
4. Mobile-money totals listed separately (confirmed vs pending) for reconciliation.
5. Session becomes `CLOSED` (immutable); manager may `REVIEW` it with a note.

## WF-13 Subscribe / renew

- **Permission:** `subscription.manage`.
1. Choose plan (weekly/monthly) → pay via mobile money (STK push or paybill with reference) [D-006].
2. Payment `PENDING` until verified callback or reconciliation confirms → subscription period extended from the later of now or current end date.
3. Reminders before expiry (e.g. 3 days and 1 day, SMS/email) [D-005].
4. Expiry → grace period → restricted mode (read-only for paid features; data preserved) [D-005].

## WF-14 View reports and dashboard

- **Permission:** `reports.read`; `reports.profit.read` for profit and valuation.
- Date range filter (default today), cashier filter, export CSV (`reports.export`). Every export is tenant-scoped and audited.

## WF-15 Offline sale (controlled, single device) [D-004]

1. Owner designates one device as the shop's offline POS device (online action).
2. Device caches: app shell, product catalogue (names, units, prices, barcodes), last known stock snapshot, cashier's session token reference (not password).
3. When offline, the cashier sells as normal; sale saved to IndexedDB with operation ID (UUID) and state `SAVED_LOCALLY`; receipt marked "Provisional – not yet synced". Allowed payment methods offline: cash and manual mobile money reference; credit sales offline [D-004].
4. On reconnect, the queue syncs in order; each operation uses its ID as the idempotency key.
5. Server validates: membership still active, permissions, prices (offline price accepted if within catalogue version rules), stock. Results: `CONFIRMED`, `REJECTED` (with reason), or `NEEDS_REVIEW` (e.g. stock went negative because of another online sale).
6. Manager resolves review items (accept with adjustment, convert, or void with audit).
- **Limits:** online-only for refunds, adjustments, purchases, role changes, subscription, price changes. Maximum offline duration / queue size [D-004].

## WF-16 Platform administration

Platform admins (separate permission set, never grantable by shops) manage plans, view subscription payments, resolve reconciliation mismatches, suspend/restore shops. Every access to shop data by a platform admin is audited. Support-access policy [D-022].
