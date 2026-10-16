# Phase 06 Report — Suppliers and Purchases

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |
| Branch | `phase-06-suppliers-purchases` (from `main` after Phase 05 was merged) |
| Decisions applied | D-014 "On arrival", D-015 "Add to cost" (both approved 2026-10-16); D-003, D-007, D-013, D-021 (approved earlier) |

## 1. What was inspected

AGENTS.md sections 5, 6, 7, 9, 10 and 12, the decision register (D-003, D-005, D-007, D-013, D-014, D-015, D-021, A-006, A-022 to A-026), the data model (sections 6, 7 and 12), the security model (section 7), the permission catalog (supplier and purchase permissions already seeded in Phase 03), acceptance criteria AC-06, and the Phase 05 code: the stock ledger service and its row lock, weighted-average costing, unit conversion, the shop-scoped client, the access guard and its decorators, and the idempotent adjustment flow.

## 2. What changed

**API (`backend`)**

- **Suppliers:** name (unique per shop, ignoring case), phone, location and note, with an optional opening balance for what the shop already owes. Search by name or phone, archived filter, paging. Archived only when nothing is owed either way; never deleted (A-028).
- **Supplier ledger (A-031):** one service is the only writer of supplier balances. Every change locks the supplier row and writes an append-only entry with the balance after it: opening balance, goods received, purchase cancelled, payment, payment reversed. A reconciliation endpoint compares each balance with its ledger.
- **Payments to suppliers (A-028):** amount in whole shillings, method (cash, mobile money, bank, other) and reference. Never more than is owed, checked under the lock. Each carries a request key, so a retry is applied once. Allowed when the shop is read-only, like other debt payments.
- **Reversing a payment (A-029):** a payment entered by mistake is marked reversed with a reason, and the amount is added back. Needs `purchases.cancel`.
- **Purchases (D-014):** a draft records the supplier, the supplier's invoice number, lines (product, unit, quantity, cost per unit) and extra costs. Drafts can be changed until the goods arrive. Line totals round half-up to whole shillings (D-021). Numbers run 1, 2, 3… per shop.
- **Receiving (D-014, D-015):** in one transaction, extra costs are spread over the lines by value in whole shillings, each line's stock comes in at its landed cost (which updates the weighted average, D-003), the supplier is charged the total, and an optional payment made on arrival is recorded. Receiving twice changes nothing. There is no partial receiving, as approved.
- **Cancelling (A-027):** a draft is simply cancelled. A received purchase takes its stock back out at the cost it came in at and credits the supplier; this is refused when the goods have already been used. Payments stay recorded and are reversed separately.
- **Who sees amounts (A-030):** purchase costs and supplier balances are shown only to people who can see costs (managers and owners by default). A storekeeper can receive goods and see quantities without seeing prices. Writing a purchase needs cost access.
- **Stock ledger:** new movement types `PURCHASE_RECEIPT` and `PURCHASE_REVERSAL` linked to their purchase, going through the same single writer as Phase 05.

**Web (`apps/web`)**

- **Suppliers (`/suppliers`):** search, archived filter, what is owed to each, and adding a supplier with an opening balance.
- **Supplier page (`/suppliers/[id]`):** balance, contact details, archive and restore, recording a payment, and the account history with links to purchases and a reverse button for payments.
- **Purchases (`/purchases`):** list with status filter.
- **New purchase (`/purchases/new`) and changing a draft (`/purchases/[id]/edit`):** choose a supplier, search products by name, SKU or barcode, enter quantity and cost in any unit (the unit's buying price is filled in), add extra costs, see totals, then "Save draft" or "Save and receive goods" with an optional amount paid.
- **Purchase page (`/purchases/[id]`):** status, lines with landed cost, extra costs, totals, payments, receive (with optional payment) and cancel with a reason.
- **Home:** Purchases and Suppliers buttons for people with access. Product and inventory history name the new movement types.
- All new text is in English and Kiswahili. Amounts typed as "21,600" are accepted. A retry after a lost response reuses the request key.

**Tests:** 36 new integration tests (suppliers 15, purchases 21), a supplier-ledger boundary test, 1 new browser journey on desktop and mobile, and unit tests for line totals, the allocation of extra costs, landed cost and cost after a reversal.

**Docs:** this report, decision register (D-014 and D-015 approved; A-027 to A-031 added; approval log), data model, security model, permission catalog, acceptance criteria AC-06, migration status, README, AGENTS.md section 14 and OpenAPI.

## 3. Database changes

Migration `20261016140000_suppliers_and_purchases` (additive):

- enums `PurchaseStatus`, `SupplierEntryType`, `SupplierPaymentMethod`; values `PURCHASE_RECEIPT` and `PURCHASE_REVERSAL` added to `StockMovementType`;
- column `stock_movements.purchase_id`;
- tables `shop_counters`, `suppliers`, `purchases`, `purchase_lines`, `purchase_charges`, `supplier_payments`, `supplier_ledger_entries`;
- check constraints: whole-shilling amounts, a purchase total equal to goods plus extra costs, status fields consistent, ledger signs matching their type with the right reference, purchase movements carrying their purchase; the movement-direction check is replaced to include the new types;
- triggers: suppliers never deleted; supplier ledger append-only; payments can only be marked reversed, once; received purchases only move to cancelled and otherwise never change; lines and extra costs change only on drafts.

Applied to a brand-new database from a clean clone, and on top of a Phase 05 database with test data (row counts and stock totals unchanged; the replaced check validated against existing movements). Drift check: no difference.

## 4. Tests executed

All run from a clean clone against a new database; commands and results in `docs/migration-status.md`.

| Suite | Passed |
|---|---|
| Unit: shared | 67/67 |
| Unit: backend | 31/31 |
| Unit: web | 23/23 |
| Architecture rules | no violations (206 modules) |
| Integration (real PostgreSQL) | 259/259 |
| Browser (desktop and Pixel 7 Chromium, production API, real SMTP to Mailpit) | 26/26 |

Required scenarios and where they are tested:

| Scenario | Test |
|---|---|
| Landed cost and weighted average: 2 cartons of 12 at 21,600 plus 1,200 transport → 1,850 a piece, average 1,825 with 24 at 1,800 | `purchases.int-spec.ts`, `purchases.spec.ts` |
| Extra costs over two lines by value, in whole shillings (695 and 305 of 1,000) | `purchases.int-spec.ts`, `purchases.spec.ts` |
| Duplicate requests: same draft four times at once, receive five times at once and again, payments with the same key five times at once, a retried receive with a payment | `purchases.int-spec.ts`, `suppliers.int-spec.ts` |
| Two purchases of the same products received at once (no lost stock, no deadlock) | `purchases.int-spec.ts` |
| Cancel and receive racing: always ends cancelled with stock and balance back where they were | `purchases.int-spec.ts` |
| Supplier balances: opening balance, purchases, payments, reversals, cancellation leaving the supplier owing the shop; reconciliation after every purchase test, and a tampered balance reported | `suppliers.int-spec.ts`, `purchases.int-spec.ts` |
| Payments never above the balance, including four at once | `suppliers.int-spec.ts` |
| Stock reconciliation after receiving and cancelling | `purchases.int-spec.ts` |
| Cancelling when the goods were already used is refused, nothing changes | `purchases.int-spec.ts` |
| Invalid quantities and costs: zero, negative, text, too many decimals, fractions of a whole unit, unit of another product, extra costs with no goods value, empty purchase | `purchases.int-spec.ts` |
| Partial receiving | Not built (D-014); received purchases cannot be changed, tested in the API and by database triggers |
| Permissions: storekeeper receives but cannot create, pay or cancel and sees no amounts; custom role without cost access; cashier kept out | `purchases.int-spec.ts`, `suppliers.int-spec.ts` |
| Cross-tenant: another shop's supplier, payment, purchase and product on every route → 404, nothing changed; a client-supplied shop id ignored | `suppliers.int-spec.ts`, `purchases.int-spec.ts` |
| Read-only shop: supplier and purchase writes 402, payments and reversals allowed | `suppliers.int-spec.ts`, `purchases.int-spec.ts` |
| Append-only ledger, undeletable suppliers, frozen payments and received purchases | `suppliers.int-spec.ts`, `purchases.int-spec.ts` |
| Only the supplier ledger service writes balances; only the stock ledger writes stock | `inventory-boundary.int-spec.ts` |
| Add a supplier, receive a purchase with transport and a part payment, check stock and balance, cancel it, through the screens | `purchases.e2e.ts` |

Negative checks (each change reverted afterwards): removing the "already received" check made 2 tests fail; removing the cost-access check made 1 test fail; removing the supplier row lock made the concurrent-payment test fail; reading a purchase without the shop scope made the tenant-isolation test fail.

## 5. Security and tenant-isolation checks

- All seven new tables are shop-owned and go through the shop-scoped client; the classification test covers every model. Raw row locks filter by shop as well as id.
- Another shop's supplier, payment, purchase and product ids give 404 on every route, and nothing changes (tested).
- Every route needs its permission from the catalog: `suppliers.read`, `suppliers.manage`, `purchases.read`, `purchases.create`, `purchases.receive`, `purchases.cancel`, `supplier_payments.create`. Paying while receiving also needs `supplier_payments.create`; writing a purchase also needs cost access.
- Purchase amounts and supplier balances are hidden from people who cannot see costs (A-030).
- Supplier changes, payments, reversals and every purchase step are audited with the actor.

## 6. Outstanding issues and open decisions

1. **Payments are not allocated to purchases.** A payment reduces what the shop owes the supplier as a whole; the screen does not show which purchases are still unpaid. Allocations can be added if wanted.
2. **Extra costs are owed to the supplier.** Transport paid to someone else can be recorded as a payment or later as an expense (Phase 08); there is no separate payee on an extra cost.
3. **Buying prices on products are not updated by purchases** (A-031). The purchase form fills in the unit's buying price, and stock cost uses the landed cost.
4. **The supplier picker on the purchase form lists the first 100 suppliers by name.** A search picker is needed for shops with more.
5. Supplier payments are not tied to a cashier session yet (Phase 08), and supplier statements and purchase reports come with reports (Phase 09).
6. The Kiswahili text has not been reviewed by a native speaker.
7. A-027 to A-031 are Proposed; the Phase 02 decision card (A-002, A-003, D-012, SMTP) is unanswered; A-015 to A-026 remain Proposed.

## 7. Acceptance criteria (AC-06)

| Criterion | Result |
|---|---|
| Receiving creates movements and updates the weighted average correctly | Met |
| Receiving the same purchase twice gives one receipt | Met |
| Supplier balance equals the sum of its ledger, and purchases minus payments | Met |
| Cancelling a received purchase creates reversing movements and ledger entries | Met |
| Partial receiving behaves per D-014 | Met (not supported, as approved) |
| Duplicate requests, invalid quantities, permissions, read-only and cross-tenant access tested | Met |

## 8. Not verified

- GitHub Actions has not run Phase 06 yet; it runs when the PR opens.
- The Docker Compose full stack was not rebuilt for this phase; the new migration was applied with `prisma migrate deploy`, which is what the compose migrate job runs.

## 9. Recommended next phase

**Phase 07 — Sales and POS.** Blockers: owner acceptance of Phase 06, and the decisions the register lists for Phase 07: the POS part of D-006 (mobile-money provider and confirmation), D-008 (when wholesale price applies), D-009 (fiscal receipts), D-010 (discount limits), D-011 (returns and refunds), D-016 (credit limits) and D-018 (sales need an open cashier session).
