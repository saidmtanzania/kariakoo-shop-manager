# Acceptance Criteria — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-12 |

Criteria are written as testable statements (Given/When/Then where useful). Each module's criteria become the exit gate for its phase, in addition to the **mandatory completion gate** at the end of this document. Items marked [D-xxx] cannot be finalised until that decision is approved.

## AC-00 Phase 00 (this phase)

- [ ] All nine Phase 00 documents exist and are internally consistent.
- [ ] Confirmed requirements, assumptions and pending decisions are labelled.
- [ ] The logical data model supports every workflow in `user-workflows.md` (traceability table in `data-model.md`).
- [ ] Decisions D-001 to D-004 approved or changed by the owner.
- [ ] No application code, migrations or infrastructure were created.

## AC-01 Repository and environment (Phase 01)

- [ ] Clean clone → documented commands install, start PostgreSQL, run Prisma migrate, start API and web.
- [ ] `GET /api/v1/health` returns 200; `GET /api/v1/health/ready` reports DB connectivity and returns 503 when DB is down.
- [ ] Invalid/missing env vars stop the API at boot with a clear message.
- [ ] Lint, type-check, unit tests for both apps pass in CI-equivalent command; results recorded in `migration-status.md`.
- [ ] Lockfile committed; no secrets in the repository.

## AC-02 Authentication and shop isolation

- [ ] Register, verify email, login, logout, password reset work end-to-end.
- [ ] Passwords hashed with Argon2id; reset and verification tokens stored only as hashes and single-use.
- [ ] Login and reset endpoints are rate-limited; error messages do not reveal whether an email exists.
- [ ] Given user A in shop 1 only, when A requests any shop-2 resource by ID, then the API returns 404 (not 403, to avoid existence leaks) and no data.
- [ ] Given a request header/body/query with `shopId` = shop 2, the server ignores it unless A has an active membership in shop 2.
- [ ] Cross-tenant read and write tests exist for every shop-scoped endpoint (architecture test enforces this).
- [ ] Logging out invalidates the session server-side; a reused cookie returns 401.

## AC-03 Dynamic RBAC and invitations

- [ ] Each protected endpoint declares its required permission; an architecture test fails if an endpoint has none (or is not explicitly public).
- [ ] Allowed and forbidden tests for each permission.
- [ ] A role containing a permission the actor does not hold cannot be created or assigned by that actor.
- [ ] Platform permissions never appear in the shop catalog and cannot be assigned through shop APIs.
- [ ] Invitation tokens: stored as SHA-256 hashes; expired, revoked, used and email-mismatch tokens are rejected.
- [ ] Seat limit enforced at invite and at acceptance.
- [ ] Role and membership changes take effect on the next request and are audited.
- [ ] The last owner cannot be removed or demoted.

## AC-04 Plans and subscriptions

- [ ] Plans (weekly, monthly) are configurable data, not code.
- [ ] A browser redirect alone never activates a subscription.
- [ ] Callback with invalid signature → rejected and logged; no state change.
- [ ] Same callback delivered twice → one payment confirmation.
- [ ] Delayed callback after expiry → payment applied, subscription extended correctly.
- [ ] Failed/reversed payment → entitlement not granted / revoked per rule [D-005].
- [ ] Expired subscription → defined features restricted; all data still readable/exportable [D-005].
- [ ] Entitlement checks separate from permission checks (both must pass).

## AC-05 Products and inventory

- [ ] Selling/receiving/adjusting in any unit converts to base units exactly (carton = 12 → −12 base).
- [ ] `StockBalance.quantity` equals the sum of `StockMovement.quantity` per product/location (reconciliation query returns zero rows of difference).
- [ ] Direct balance updates outside the inventory service are impossible (no endpoint; architecture test on repository usage).
- [ ] Adjustment without reason or permission is rejected; accepted adjustments are audited.
- [ ] Negative stock blocked [D-007].
- [ ] Two concurrent adjustments on the same product produce the correct final balance.
- [ ] Duplicate SKU/barcode within a shop rejected; allowed across shops.
- [ ] Search returns results for name, SKU and barcode on 10,000 products within NFR-1 targets.

## AC-06 Suppliers and purchases

- [ ] Receiving creates movements and updates weighted-average cost correctly for known test cases [D-003].
- [ ] Receiving the same purchase twice (retry or double click) → one receipt.
- [ ] Supplier balance = sum of supplier ledger entries; matches outstanding purchases minus payments.
- [ ] Cancelling a received purchase creates reversing movements and ledger entries.
- [ ] Partial receiving behaves per [D-014].

## AC-07 Sales and POS

- [ ] Sale with cash TSh 3,000 + confirmed mobile money TSh 2,000 on a TSh 5,000 total → paid 5,000, balance 0.
- [ ] Same sale with mobile money `PENDING` → paid 3,000, pending 2,000, not shown as fully paid anywhere.
- [ ] Retrying a sale with the same idempotency key returns the original result and creates nothing new; same key with a different payload → 409.
- [ ] 20 concurrent sales of the last 5 units → exactly 5 units sold, others rejected with insufficient stock; balance never negative [D-007].
- [ ] Sale lines store unit, conversion, quantity, unit price, discount and cost snapshot; later price/cost changes do not alter them.
- [ ] Discount without permission → 403; above limit → rejected [D-010].
- [ ] Credit sale without customer → rejected; credit sale creates receivable entry; credit limit enforced if enabled [D-016].
- [ ] Refund creates compensating records; original sale unchanged except status; cannot refund more than sold.
- [ ] Receipt renders on 58 mm and 80 mm widths.
- [ ] Checkout from scan to receipt measured on a low-end Android device; result recorded.

## AC-08 Credit, expenses, cashier closing

- [ ] Customer balance = sum of ledger entries; statement matches.
- [ ] Allocation cannot exceed payment amount or sale outstanding amount; duplicate allocation rejected.
- [ ] Partial payments / unallocated receipts per [D-017].
- [ ] Expected cash = opening float + cash sales + pay-ins − cash refunds − cash expenses − pay-outs, verified with test fixtures.
- [ ] Non-zero difference requires an explanation; closed sessions cannot be edited.
- [ ] Expense voids are reversal entries with audit.

## AC-09 Reports and dashboard

- [ ] Each metric documents formula and source tables in `docs/architecture/reports.md`.
- [ ] Report totals match fixture transactions to the shilling.
- [ ] Gross profit = net sales − cost of goods sold (from sale-line cost snapshots, minus returns) [D-003].
- [ ] Stock valuation = Σ balance × current weighted-average cost [D-003].
- [ ] New shop shows empty states and zeros, no sample data.
- [ ] Reports and exports cannot include another shop's data (tested).

## AC-10 PWA and offline

- [ ] App installs on Android Chrome; shell loads offline.
- [ ] Offline sale persists across refresh and browser restart.
- [ ] Re-syncing the same operation twice yields one server sale.
- [ ] Server rejection is visible with reason; nothing is silently dropped.
- [ ] Sensitive operations unavailable offline; IndexedDB contains no passwords/tokens beyond what is documented.
- [ ] Sync status visible (counts of pending, rejected, needs review).
- [ ] Only the designated device can queue offline sales [D-004].

## AC-11 Security and production readiness

- [ ] Security review findings recorded with severity, evidence, remediation; no open critical/high.
- [ ] Backups automated; a restore to a fresh database tested and timed.
- [ ] Structured logs contain no passwords, tokens, or full phone numbers in plain text where avoidable.
- [ ] Dependency audit run; results recorded.
- [ ] Load test at pilot-scale workloads recorded.

## AC-12 Pilot

- [ ] Owner-approved pilot checklist completed with evidence.
- [ ] Import validation and rollback procedure tested before importing real data.
- [ ] Training and support runbooks delivered.

---

## Mandatory completion gate (every phase)

1. Existing code, documentation and migrations reviewed before changes.
2. Implementation limited to the approved scope.
3. Tests actually executed, with results recorded (command + outcome).
4. Migrations reviewed and tested on a clean database where applicable.
5. Authorization, validation, tenant isolation and failure paths tested.
6. Documentation and decision register updated.
7. Known gaps explicitly recorded.
8. Next phase readiness assessed before starting it.
