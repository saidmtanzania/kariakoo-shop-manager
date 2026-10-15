# Security Model — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-12 |

## 1. Assets

Shop financial records (sales, debts, cash), stock and cost data, customer and supplier personal data (names, phone numbers), staff accounts, payment-provider credentials, subscription payments, audit logs.

## 2. Threat actors and key threats

| Actor | Threats |
|---|---|
| Staff of shop A | Accessing shop B data by guessing IDs; escalating own permissions; deleting or editing sales to hide theft; unrecorded discounts; manipulating cash closing. |
| Former staff | Using an old session, invitation or offline device after removal. |
| External attacker | Credential stuffing, password-reset abuse, forged payment callbacks, enumeration, XSS/CSRF, injection. |
| Shop owner | Granting platform privileges via custom roles; bypassing subscription limits. |
| Compromised device | Reading IndexedDB data; replaying offline sales. |
| Platform operator | Unaudited access to shop data. |

## 3. Authentication [A-003]

- **Proposed strategy:** server-side sessions. Opaque random session token (256-bit) in an `HttpOnly; Secure; SameSite=Lax` cookie; only its SHA-256 hash stored in `sessions`. Rationale: the web app and API are same-site, revocation is immediate (staff removal, logout), and no long-lived tokens live in JavaScript. JWT access/refresh tokens are the alternative if a native mobile app or separate API domain is added later.
- Session lifetime: idle timeout (e.g. 12 h for cashiers' shifts) and absolute timeout (e.g. 7 days) [A]; rotate session ID on login and privilege change.
- Passwords: Argon2id, minimum length 8 with breached-password check optional [A]; no composition rules beyond length.
- Email verification and password reset tokens: random, hashed, single-use, short expiry; reset revokes all sessions.
- Rate limiting (`@nestjs/throttler`, PostgreSQL-backed store initially): login, register, reset, invitation acceptance, payment callbacks. Progressive delay/temporary lockout per account + IP.
- Generic error messages on login/reset/register to prevent account enumeration.
- MFA: optional TOTP for owners later [A, not in initial scope].
- CSRF: SameSite=Lax cookie + custom header requirement (`X-Requested-With` or CSRF token) for state-changing requests.

## 4. Tenant isolation [C, A-002]

1. Active shop comes from the server session, set only after membership validation. Client-sent `shopId` values in paths/bodies are ignored or must match the session's active shop.
2. `ShopContextGuard` runs on all shop-scoped routes; an architecture test fails the build if a controller under a shop-scoped module lacks it.
3. Repositories require a `ShopContext`; a Prisma extension adds `shop_id` to every tenant-model query and throws if absent.
4. All lookups by ID are `WHERE id = $1 AND shop_id = $ctx` → not found returns 404.
5. Composite FKs `(shop_id, x_id)` prevent linking a sale to another shop's customer/product.
6. Background jobs, exports, reports, and sync endpoints construct the same `ShopContext` explicitly.
7. Optional PostgreSQL RLS as defence in depth (decide in Phase 02).
8. Tests: for every shop-scoped endpoint, cross-tenant read, write, list-filter and reference-injection cases.

## 5. Authorization (dynamic RBAC) [C]

- Deny by default. Every endpoint declares `@RequirePermission(code)` or `@Public()`.
- Effective permissions = union of permissions of the membership's roles, intersected with the shop-scope delegable catalog.
- Owners hold all shop permissions implicitly through the system Owner role (non-editable).
- **No escalation rule:** an actor can create/assign roles only with permissions they themselves hold, and only `SHOP`-scope delegable permissions.
- Last-owner protection.
- Entitlements (subscription) checked separately from permissions; both must pass.
- "Own records only" variants (e.g. cashier sees only own sales) via permission pairs (`sales.read` vs `sales.read_all`).
- Changes take effect on the next request (permissions loaded per request, short in-process cache invalidated on change).

## 6. Invitations [C]

32-byte random token, SHA-256 hash stored, expiry (default 7 days [A]), single-use, revocable, bound to shop + email; acceptance requires a logged-in user whose verified email matches; seat limit re-checked at acceptance; resend rotates the token.

## 7. Financial integrity controls

- Completed sales, payments, ledger entries, movements, closed cash sessions are immutable; corrections via compensating records with audit.
- Discounts beyond permission/limit rejected server-side; all discounts recorded on lines.
- Prices are recalculated server-side from the catalogue; client prices are only accepted for offline sync under documented rules.
- Idempotency keys on all money-moving endpoints.
- Database CHECK/UNIQUE constraints backing invariants.
- Nightly reconciliation: balances vs ledgers; mismatches alert the platform operator.

## 8. Payment-provider security

- Callback endpoints verify provider signature/HMAC or shared secret and, where documented, source IPs; reject and log failures.
- Raw callbacks stored (`payment_events`) with dedupe on provider event ID.
- Never trust redirects or client claims of payment.
- Provider credentials only in server environment/secret store; never sent to the browser.
- Amount and currency in callbacks verified against the expected payment.

## 9. Data protection and privacy

- Tanzania Personal Data Protection Act 2022: collect minimum personal data, privacy notice, data-subject access/correction process, breach procedure; registration with the Personal Data Protection Commission as a controller/processor may be required — **legal confirmation needed** [D-020].
- TLS everywhere; database encryption at rest provided by host/volume.
- Logs exclude passwords, tokens, session IDs, full payment payloads; phone numbers masked in logs.
- Data export for owners (CSV) is permission-controlled and audited.
- Retention: financial records retained (statutory period to confirm, commonly 5+ years) [D-020].

## 10. Web security

- Security headers: CSP (no inline scripts beyond nonce), HSTS, X-Content-Type-Options, frame-ancestors none, Referrer-Policy.
- CORS: allow only the web origin; credentials enabled only for it.
- Input validation on every DTO (whitelist); output encoding by React; no `dangerouslySetInnerHTML` with user content.
- Prisma parameterises queries; raw SQL only via tagged templates, reviewed.
- File uploads (product images, CSV import) — none initially; if added: size/type limits, storage outside web root, malware consideration.
- Dependency audit in CI; lockfile committed.

## 11. Offline security [C, D-004]

- Offline only on registered devices with a revocable device credential bound to shop + device, valid only for sync and catalogue download.
- IndexedDB stores catalogue (names, prices, units, barcodes), the sale queue and minimal session info — no passwords, no permission tables beyond a "can sell offline" flag, no customer credit balances [A].
- Server re-validates everything at sync time (membership, device not revoked, permissions at time of sale, prices, stock).
- Removing a staff member or revoking a device prevents further sync; queued sales from a revoked device go to `NEEDS_REVIEW`.
- Encourage device screen lock; document that a stolen phone exposes the cached catalogue.

## 12. Auditing [C]

Audited actions include: login success/failure (security log), role/permission changes, membership changes, invitations, price changes, stock adjustments, discounts, refunds, voids, cash-session open/close/review, expense voids, subscription changes, exports, platform-admin access to shop data, device registration/revocation. Audit log is append-only and readable with `audit.read`.

## 13. Platform administration [D-022]

Platform admins use a separate admin area and permission scope. Accessing a shop's business data for support should require a logged reason (and optionally owner consent). Policy to be decided.

## 14. Security testing (summary)

See [testing strategy](../architecture/testing-strategy.md) §5. Phase 11 performs a full review against this document and OWASP ASVS Level 2 as a reference [A].
