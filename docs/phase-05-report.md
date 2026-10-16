# Phase 05 Report — Products and Inventory

| Field | Value |
|---|---|
| Date | 2026-10-16 |
| Phase status | Implemented and verified locally; **awaiting owner acceptance** |
| Branch | `phase-05-products-inventory` (from `main` after Phase 04 was merged) |
| Decisions applied | D-007 "Owner setting", D-013 "Per unit", D-021 "Whole TSh" (all approved 2026-10-16); D-002 and D-003 (approved 2026-10-12) |

## 1. What was inspected

AGENTS.md sections 5, 6, 7, 9 and 12, the decision register (D-002, D-003, D-005, D-007, D-013, D-021, A-006, A-008, A-022), the data model (sections 5, 6 and 12), the security model (sections 5 and 7), the permission catalog, acceptance criteria AC-05, and the Phase 04 code: the access guard and its decorators (`RequirePermission`, `RequireWritable`, `OwnerOnly`), the shop-scoped Prisma client, plan features and the seat-limit lock, the audit service and the idempotent payment submission.

## 2. What changed

**API (`backend`)**

- **Products:** name, optional SKU (unique per shop, case-insensitive), optional category, reorder level, and up to 10 units. Products are archived, never deleted, and only when their stock is zero.
- **Units and conversions (D-013, A-025):** each product has one base unit (piece, kg, metre) chosen when it is created. Other units hold a fixed number of base units, such as a carton of 12 pieces. A conversion cannot change once saved, so history stays correct. Each unit says whether it allows parts (up to 3 decimal places); pieces and cartons stay whole. Barcodes are unique per shop across all units.
- **Prices (D-021, A-023):** retail, wholesale and buying price per unit, in whole shillings, stored as `numeric(18,2)`. Every change is kept in a price history and audited. Buying prices and average cost are shown only to people who can change prices or see profit.
- **Categories:** add, rename and archive, with product counts.
- **Stock ledger (A-006, A-026):** one service is the only writer of stock balances and movements. Each change locks the product's balance row, checks the result, updates the balance and writes a movement in one transaction. Every movement records the actor, time, signed base quantity, balance after, cost, and the unit, quantity and conversion as entered.
- **Opening stock:** entered once per product, when it is created or later, before any other change. It needs `inventory.opening`.
- **Adjustments:** add, remove or set a counted quantity, in any unit, with a reason (count correction, damaged, expired, lost, found, own use, other) and a note when the reason is "other". Each carries a request key, so a retried request is applied once. Adjustments never take stock below zero (A-024).
- **Average cost (D-003):** stock added with a cost updates the weighted-average cost per base unit, to 4 decimal places with half-up rounding, using integer arithmetic.
- **Negative stock (D-007):** blocked by default. The owner can allow sales below zero for the shop (audited); Phase 07 sales will use it. The summary counts products below zero.
- **Search and lists:** search by part of the name (trigram index), exact SKU or exact barcode (which also says which unit was scanned). Filters by category, low stock, out of stock and archived. Cursor paging.
- **Low-stock alerts:** a summary with product, low-stock, out-of-stock and below-zero counts.
- **Reconciliation:** `GET /shops/current/inventory/reconciliation` compares every balance with the sum of its movements.
- **Subscriptions:** every product and stock write is refused when the shop is read-only (402). The plan feature `products` now limits active products (402 `product_limit_reached`), checked under a lock so two creations at once cannot pass the limit.
- **Shops:** every new shop gets a default stock location, "Main" (D-002).

**Web (`apps/web`)**

- **Products (`/products`):** search box (name, SKU or barcode), filters, categories, low-stock alert and "load more".
- **New product (`/products/new`):** details, base unit, other units with their conversions, prices and opening stock in any unit.
- **Product page (`/products/[id]`):** stock in base units with the unit conversions, opening stock or the adjustment form, units and prices, details, stock history and archive.
- **Inventory (`/inventory`):** counts, the negative-stock setting (owner only), a reconciliation check and recent stock changes.
- **Home:** Products and Inventory buttons for people with access.
- All new text is in English and Kiswahili. Quantities and money are shown from decimal strings, never converted to floating-point numbers. A retry after a lost response reuses the request key.

**Tests:** 52 new integration tests (products 27, inventory 25), a stock-ledger boundary test, a search test on 10,000 products, 1 new browser journey on desktop and mobile, and unit tests for decimal arithmetic, unit conversion, costing and quantity display.

**Docs:** this report, decision register (D-007, D-013 and D-021 approved; A-006 note; A-023 to A-026 added; approval log), data model, security model, permission catalog, acceptance criteria AC-05, migration status, README, AGENTS.md section 14 and OpenAPI.

## 3. Database changes

Migration `20261016073000_products_and_inventory` (additive):

- extension `pg_trgm` for name search;
- column `shops.allow_negative_stock` (default false);
- enums `StockMovementType` (`OPENING`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`) and `AdjustmentReason`;
- tables `stock_locations`, `product_categories`, `products`, `product_units`, `price_history`, `stock_balances`, `stock_adjustments`, `stock_movements`;
- check constraints: conversions above zero and 1 for the base unit, whole-shilling prices of zero or more, reorder level and average cost of zero or more, movement quantity never zero and its sign matching its type, adjustments carrying a reason;
- triggers: units keep their conversion, base flag and product and are never deleted, one base unit per product; products are never deleted; movements, adjustments and price history are append-only;
- every existing shop gets a default "Main" location.

Applied to a brand-new database from a clean clone. Also applied on top of the Phase 04 schema with two existing shops: each got its "Main" location and negative stock off. Drift check: no difference.

## 4. Tests executed

All run from a clean clone against a new database; commands and results in `docs/migration-status.md`.

| Suite | Passed |
|---|---|
| Unit: shared | 54/54 |
| Unit: backend | 28/28 |
| Unit: web | 23/23 |
| Architecture rules | no violations (182 modules) |
| Integration (real PostgreSQL) | 221/221 |
| Browser (desktop and Pixel 7 Chromium, production API, real SMTP to Mailpit) | 24/24 |

Required scenarios and where they are tested:

| Scenario | Test |
|---|---|
| Unit conversions (carton = 12, 50 kg bag, fractions refused where not allowed) | `products.int-spec.ts`, `inventory.int-spec.ts`, `inventory.spec.ts` |
| Stock reconciliation, including a tampered balance being reported | `inventory.int-spec.ts` |
| Invalid adjustments: no reason, "other" without a note, zero, too much, unit of another product, archived unit or product, counted quantity unchanged, cost on removals | `inventory.int-spec.ts` |
| Concurrent updates: 20 removals of 1 racing for 10 (exactly 10 succeed), mixed additions and removals, the same request five times at once, opening stock twice at once, product limit at once | `inventory.int-spec.ts`, `products.int-spec.ts` |
| Retries with the same key return the first result; different details are refused | `inventory.int-spec.ts` |
| Weighted-average cost worked example | `inventory.int-spec.ts`, `costing.spec.ts` |
| Tenant isolation on every product, unit, category and stock route | `products.int-spec.ts`, `inventory.int-spec.ts` |
| Permissions: cashier, storekeeper, custom role (allowed and forbidden), cost visibility | `products.int-spec.ts`, `inventory.int-spec.ts` |
| Read-only shop and product limit | `products.int-spec.ts` |
| Append-only movements, adjustments and price history | `inventory.int-spec.ts` |
| Only the ledger service writes stock | `inventory-boundary.int-spec.ts` |
| Search on 10,000 products (p95: name 15–62 ms, SKU 57 ms, barcode 64 ms, first page 14 ms; target 300 ms) | `product-search-performance.int-spec.ts` |
| Add a product with cartons and opening stock, adjust, see history, alert and reconciliation through the screens | `products.e2e.ts` |

Negative checks (each change reverted afterwards): removing the row lock made the 2 concurrency tests fail; removing the below-zero check made 3 tests fail; reading a product without the shop scope made the tenant-isolation test fail.

## 5. Security and tenant-isolation checks

- All eight new tables are shop-owned and go through the shop-scoped client; the classification test covers every model.
- Another shop's product, unit and category ids give 404 on every route, and nothing changes (tested).
- Every route needs its permission from the catalog: `products.read`, `products.create`, `products.update`, `products.archive`, `products.prices.update`, `inventory.read`, `inventory.adjust`, `inventory.opening`; the negative-stock setting is owner only.
- Buying prices and average cost are hidden from people without price or profit access, and they cannot enter them (403).
- Product creation, changes, archiving, unit changes, price changes, opening stock, adjustments and the negative-stock setting are audited with the actor.
- Search text is escaped and passed as a parameter.

## 6. Outstanding issues and open decisions

1. **The negative-stock setting has no effect yet.** It is stored and audited; Phase 07 sales will read it. Adjustments are always blocked below zero.
2. **Only the default location is used.** The schema has locations for branches later (D-002).
3. **Average cost changes only through opening stock and adjustments with a cost** until purchases arrive in Phase 06. Products without a cost have an average of 0.
4. **Reconciliation runs on request**, not nightly; the scheduled check and alerting come with operations work (Phase 11).
5. Barcodes are typed or pasted; camera scanning is not built.
6. Categories are one level. Units cannot be marked "not for sale" or "not for purchase" yet.
7. The Kiswahili text has not been reviewed by a native speaker.
8. The Phase 02 decision card (A-002, A-003, D-012, SMTP) is unanswered; A-015 to A-026 remain Proposed.

## 7. Acceptance criteria (AC-05)

| Criterion | Result |
|---|---|
| Any unit converts to base units exactly | Met for adjustments and opening stock; purchases and sales use the same conversion later |
| Balance equals the sum of movements | Met |
| No balance changes outside the inventory service | Met |
| Adjustment without reason or permission rejected; accepted ones audited | Met |
| Negative stock blocked [D-007] | Met (adjustments always; sales follow the owner setting in Phase 07) |
| Concurrent adjustments give the correct balance | Met |
| Duplicate SKU or barcode refused in a shop, allowed across shops | Met |
| Search on 10,000 products within NFR-1 | Met on the development machine |

## 8. Not verified

- GitHub Actions has not run Phase 05 yet; it runs when the PR opens.
- The Docker Compose full stack was not rebuilt for this phase; the new migration was applied with `prisma migrate deploy`, which is what the compose migrate job runs.
- Search timings were measured on the development machine, not on production hardware.

## 9. Recommended next phase

**Phase 06 — Suppliers and purchases.** Blockers: owner acceptance of Phase 05, and decisions D-014 (purchase orders and partial receiving) and D-015 (landed costs on purchases).
