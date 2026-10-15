# Product Requirements — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 — Requirements and architecture |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-12 |
| Source | Owner's "Updated Project Plan: Kariakoo Shop Manager" (project chat, 2026-10-12) |

Each requirement is labelled:

- **[C] Confirmed** — stated explicitly in the owner's plan.
- **[A] Assumption** — inferred by the author to make the document workable; must be confirmed or corrected.
- **[D-xxx] Decision pending** — depends on an open entry in the [decision register](../decisions/decision-register.md).

## 1. Product vision

A simple, reliable shop-management SaaS for wholesalers and retailers in Kariakoo, Dar es Salaam. It must feel like a practical shop tool, not accounting software: a cashier makes a sale in seconds; an owner sees stock, profit, staff and credit. [C]

## 2. Target users and personas

| Persona | Description | Primary needs |
|---|---|---|
| Shop owner | Owns one or more shops; may not be at the counter all day | Profit, stock value, debts, staff control, subscription |
| Manager | Trusted staff running the shop day to day | Stock, purchases, adjustments, reports, cash closing |
| Cashier | Sells at the counter, often on an affordable Android phone | Fast search, cart, split payments, receipts |
| Stock keeper | Receives and counts goods | Receiving, adjustments, movement history |
| Platform administrator | Operator of the SaaS (not a shop member) | Plans, tenant support, payment reconciliation |

Roles above are examples; shops define their own roles from a permission catalog (see §5.8). [C]

## 3. Operating context

- Language: English first, with a Kiswahili localization path from the start (all UI strings externalized). [C]
- Currency: Tanzanian Shilling (TZS) only for the initial release. [A] Multi-currency is out of scope unless decided otherwise. [C — not to be assumed]
- Devices: desktop browsers and affordable Android phones; installable PWA. [C]
- Connectivity: intermittent; controlled offline sales required. [C] [D-004]
- Payments: cash, mobile money (e.g. M-Pesa, Tigo Pesa/Mixx by Yas, Airtel Money, HaloPesa), bank/card later. Provider capabilities must be verified before being promised. [C]
- Tax (VAT, TRA EFD/VFD receipts): **not in scope until decided**. [D-009]

## 4. Scope summary

### In scope (initial release, delivered across Phases 01–12)

Dashboard, Sales/POS, Products and inventory, Purchases and suppliers, Customers and credit, Expenses and cashier sessions, Reports, Users/roles/permissions, Subscription and billing, PWA with controlled offline sales, auditing, backups and runbooks. [C]

### Out of scope until a decision is approved

Multiple branches per shop [D-002], multi-currency, tax/fiscal receipts [D-009], full double-entry accounting, multi-device offline selling [D-004], e-commerce storefront, payroll, loyalty programs. [C]

## 5. Functional requirements

### 5.1 Identity, shops and tenancy

- FR-ID-1 A person registers once with a global identity (email + password). [C] Phone-number login is not specified. [A] [D-012]
- FR-ID-2 A user may belong to one or more shops through memberships. [C]
- FR-ID-3 A registering user can create a shop and becomes its owner. [C]
- FR-ID-4 The user selects an active shop; the server resolves and validates the active shop on every request. [C]
- FR-ID-5 Account recovery by email. [C]
- FR-ID-6 Logout invalidates the server-side session. [C]

### 5.2 Dashboard

- FR-DB-1 Today's sales total, payment-method breakdown, low-stock alerts, outstanding customer credit, today's expenses, recent activity. [C]
- FR-DB-2 Figures come only from confirmed server records; new shops see empty states, never demo data. [C]
- FR-DB-3 Pending mobile-money amounts are shown separately from confirmed amounts. [C]
- FR-DB-4 Dashboard content respects permissions (e.g. profit only with `reports.profit.read`). [A]

### 5.3 Sales and POS

- FR-POS-1 Product search by name, SKU and barcode (keyboard-wedge/camera scanner where supported). [C]
- FR-POS-2 Cart with quantity, sale unit selection (e.g. carton or piece), wholesale/retail price selection. [C]
- FR-POS-3 Discounts only with permission; line and/or sale-level discount. [C] Maximum discount rules [D-010].
- FR-POS-4 Split payments across cash, mobile money and credit. [C]
- FR-POS-5 Sale completion is one internal database transaction (sale, lines, stock movements, balances, payments, receivable, idempotency record). [C]
- FR-POS-6 Each sale line preserves unit, conversion factor, quantity, unit price, discount and cost snapshot. [C]
- FR-POS-7 Receipts: on-screen and printable (58/80 mm thermal format) and shareable (e.g. WhatsApp/SMS text). [A — channel to confirm]
- FR-POS-8 Returns and refunds are recorded as compensating transactions referencing the original sale. [C] Return policy [D-011].
- FR-POS-9 Pending mobile-money payments never count as paid. [C]
- FR-POS-10 Overselling is prevented; negative stock is blocked unless an approved rule allows it. [C] [D-007]

### 5.4 Products and inventory

- FR-INV-1 Categories, products, SKUs, barcodes (one product may have several barcodes, one per unit). [C/A]
- FR-INV-2 Each product has one **base unit** (smallest stocked unit, e.g. piece). Additional sale/purchase units define an integer or decimal conversion to the base unit (carton = 12 pieces). [C]
- FR-INV-3 Each unit can carry a retail price and a wholesale price. [C] Whether wholesale price applies by customer type, by quantity or by cashier choice [D-008].
- FR-INV-4 Stock is held in base units in a stock balance per product per location. [C]
- FR-INV-5 Every stock change is a stock-movement ledger entry (type, quantity in base units, reference, actor, time, reason). [C]
- FR-INV-6 Direct balance edits are not possible; adjustments require `inventory.adjust`, a reason and are audited. [C]
- FR-INV-7 Low-stock alerts by per-product reorder level. [C]
- FR-INV-8 Opening stock is entered as an auditable movement (type `OPENING`). [A]
- FR-INV-9 Stock transfers between locations only after branches are approved. [C] [D-002]
- FR-INV-10 Fractional base quantities (e.g. kilograms, metres) [D-013].

### 5.5 Purchases and suppliers

- FR-PUR-1 Supplier records with contact details and outstanding balance. [C]
- FR-PUR-2 Purchases with items, unit, quantity, unit cost. Purchase orders only "where needed". [C] [D-014]
- FR-PUR-3 Receiving a purchase creates `PURCHASE_RECEIPT` stock movements and updates average cost. [C] [D-003]
- FR-PUR-4 Purchases may be paid, partly paid or on supplier credit; supplier ledger records the balance. [C]
- FR-PUR-5 Supplier payments with allocation to purchases. [C]
- FR-PUR-6 Cancellations/corrections are reversing entries, never silent edits. [C]
- FR-PUR-7 Additional landed costs (transport, porters) [D-015].

### 5.6 Customers and credit

- FR-CR-1 Customer records (name, phone, optional business name). [C]
- FR-CR-2 Credit sales create receivable ledger entries. [C]
- FR-CR-3 Customer payments, allocation to outstanding sales, statements and overdue balances. [C]
- FR-CR-4 Optional per-customer credit limit (if enabled by the shop). [C] Enforcement rule [D-016].
- FR-CR-5 Duplicate and over-allocation prevented. [C] Partial payments and unallocated receipts [D-017].

### 5.7 Expenses and cashier sessions

- FR-EXP-1 Expenses with category, amount, payment method, date, note, actor. [C]
- FR-CS-1 Cashier opens a session with an opening float; cash sales, cash refunds, cash expenses and cash movements (pay-in/pay-out) accrue to the session. [C/A]
- FR-CS-2 Closing records counted cash, computes expected cash and the difference, and requires an explanation for a non-zero difference. [C]
- FR-CS-3 Closed sessions are immutable; corrections are new audited entries. [C]
- FR-CS-4 Whether a sale requires an open cashier session [D-018].

### 5.8 Users, roles and permissions

- FR-RBAC-1 Database-driven permission catalog, custom shop roles, role-permission mapping, membership-role assignment. [C]
- FR-RBAC-2 Owners cannot grant platform-admin permissions or permissions outside the delegable shop catalog. [C]
- FR-RBAC-3 Staff invited by email; hashed, single-use, time-limited, revocable tokens; states Pending, Accepted, Expired, Revoked; resend supported; plan seat limits respected. [C]
- FR-RBAC-4 Revoking access takes effect on the next request. [A]
- FR-RBAC-5 User activity review (audit log view). [C]
- FR-RBAC-6 Each shop always has at least one owner membership that cannot be removed. [A]

### 5.9 Subscription and billing

- FR-SUB-1 Each shop has its own subscription. [D-001 — recommended]
- FR-SUB-2 Configurable weekly and monthly plans with feature entitlements and limits (seats, products, offline, reports). [C]
- FR-SUB-3 Subscription history and payment history. [C]
- FR-SUB-4 Payment confirmed only via verified provider callback or reconciliation, never by browser redirect. [C]
- FR-SUB-5 Expiry reminders, grace period, restriction rules. [C] Concrete durations and restricted features [D-005].
- FR-SUB-6 Expiry never deletes or corrupts data; historical records remain readable. [C]
- FR-SUB-7 Automatic recurring mobile-money deductions not promised until verified per provider. [C] [D-006]
- FR-SUB-8 Trial period [D-019].

### 5.10 Reports

Sales, sales by product and by cashier, stock valuation, stock movement, gross profit, expenses, customer debts, supplier debts, payment reconciliation. Each report documents its formula and source of truth. Profit and valuation depend on the costing method. [C] [D-003]

### 5.11 Offline

- FR-OFF-1 PWA caches the app shell; eligible operations queued in IndexedDB with a unique operation ID. [C]
- FR-OFF-2 States: Saved locally / Pending sync / Confirmed / Rejected / Needs review. [C]
- FR-OFF-3 First release: controlled offline sales on one designated device per shop. [D-004 — recommended]
- FR-OFF-4 Administrative and sensitive operations are online-only. [C]
- FR-OFF-5 No passwords, secrets or privileged authorization data stored offline. [C]

### 5.12 Auditing

Sensitive actions (role/permission changes, invitations, adjustments, refunds, discounts above threshold, price changes, cash-session closing, subscription changes, voids) are written to an append-only audit log. [C]

## 6. Non-functional requirements

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-1 | POS search response | p95 < 300 ms for 10,000 products per shop on server; local filtering < 100 ms | [A] targets to confirm |
| NFR-2 | Sale completion (online) | p95 < 1 s server time | [A] |
| NFR-3 | Low-end device | Usable on a 2 GB RAM Android phone, Chrome, 3G | [A] |
| NFR-4 | Availability | 99.5 % monthly for the pilot | [A] |
| NFR-5 | Backups | Daily full + continuous WAL/PITR; restore tested before launch | [C] (frequency [A]) |
| NFR-6 | Data integrity | Money in `numeric`; no floats; ledgers reconcile with balances | [C] |
| NFR-7 | Security | Tenant isolation tested on every shop-scoped endpoint | [C] |
| NFR-8 | Accessibility | WCAG 2.1 AA for forms, tables, dialogs | [A] |
| NFR-9 | Data residency / privacy | Comply with Tanzania Personal Data Protection Act 2022 | [A] [D-020] |
| NFR-10 | Localization | All strings externalized; Kiswahili-ready | [C] |

## 7. Money and number rules

- All monetary amounts stored as PostgreSQL `numeric(18,2)`; TZS displayed with no decimals. [A] [D-021]
- Quantities stored as `numeric(18,3)` to allow fractional units if approved. [A] [D-013]
- Unit cost (weighted average) stored as `numeric(18,4)` to limit rounding drift. [A]
- Rounding: half-up to the currency's minor unit at line level, then sum. [A] [D-021]

## 8. Primary navigation

Overview, Sales, Products, Inventory, Purchases, Customers & Credit, Expenses, Reports, Users & Roles, Subscription & Settings. [C]

## 9. Success measures for the pilot [A]

- A cashier completes a 3-line sale with split payment in under 30 seconds after training.
- End-of-day cash closing difference is explainable for 100 % of sessions.
- Ledger-vs-balance reconciliation shows zero unexplained differences over the pilot.
- No cross-tenant data access found in testing.
