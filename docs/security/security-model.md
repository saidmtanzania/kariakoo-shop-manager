# Security Model — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 00 |
| Status | Draft, awaiting owner approval |
| Last updated | 2026-10-15 (Phase 02 implementation notes in sections 3, 4 and 12) |

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

**As built in Phase 02** (`backend/src/modules/auth`, `backend/src/common`):

| Control | Implementation |
|---|---|
| Session token | 32 random bytes, base64url, in cookie `__Host-ksm_session` (HTTPS) or `ksm_session` (local HTTP). `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `COOKIE_SECURE` (default on in production). Only the SHA-256 hash is stored. A new session is created at every sign-in. |
| Lifetime | Idle timeout `SESSION_IDLE_HOURS` (12), absolute `SESSION_ABSOLUTE_DAYS` (7). Idle expiry slides at most every 5 minutes. Disabled users are rejected on the next request. |
| Passwords | Argon2id (`@node-rs/argon2`, 19 MiB, 2 iterations, 1 lane: the OWASP minimum). 8 to 128 characters. Unknown emails are checked against a dummy hash so timing does not reveal accounts. |
| Email tokens | 32 random bytes, SHA-256 stored, single-use (conditional update), 24 h for verification and 30 min for reset. A new token voids older ones. Links carry the token in the URL fragment (`#token=`) so it never reaches server or proxy logs; the page removes it from the address bar. |
| Enumeration | Register, resend and forgot-password always answer 202 with the same message. A duplicate registration emails the existing owner instead. Wrong password and unknown email give the same 401. |
| Unverified email | Sign-in is refused with 403 `email_not_verified`, but only after the correct password. |
| Password reset | Revokes every session of the user and sends a "password changed" email. |
| Rate limits | PostgreSQL fixed windows (decision A-013): register 10/h per IP; login 20/15 min per IP; 10 failed logins per email lock that email for 15 min; forgot-password 10/h per IP and 3/h per email; resend 10/h per IP and 3/h per email; verify 20/h per IP; reset 20/h per IP. 429 with `Retry-After`. |
| Client IP | `TRUST_PROXY` hops of `X-Forwarded-For` are trusted (1 for the web app's `/api` forwarding). **The API port must not be reachable directly when `TRUST_PROXY` > 0**, or clients can choose their own IP for rate limits. |
| CSRF | Every non-GET/HEAD/OPTIONS request must send `X-Requested-With: XMLHttpRequest` (403 `csrf_header_missing`), checked before authentication. |
| Deny by default | One global `AccessGuard`. Routes are signed-in only unless marked `@Public()`; a route-inventory test lists the eight public routes and fails if any other route answers without a session. |

## 4. Tenant isolation [C, A-002]

1. Active shop comes from the server session, set only after membership validation. Client-sent `shopId` values in paths/bodies are ignored or must match the session's active shop.
2. `ShopContextGuard` runs on all shop-scoped routes; an architecture test fails the build if a controller under a shop-scoped module lacks it.
3. Repositories require a `ShopContext`; a Prisma extension adds `shop_id` to every tenant-model query and throws if absent.
4. All lookups by ID are `WHERE id = $1 AND shop_id = $ctx` → not found returns 404.
5. Composite FKs `(shop_id, x_id)` prevent linking a sale to another shop's customer/product.
6. Background jobs, exports, reports, and sync endpoints construct the same `ShopContext` explicitly.
7. Optional PostgreSQL RLS as defence in depth (decide in Phase 02).
8. Tests: for every shop-scoped endpoint, cross-tenant read, write, list-filter and reference-injection cases.

**As built in Phase 02:**

- `@ShopScoped()` routes take the active shop from the server-side session and re-check the membership (active membership, shop not suspended) on every request. A failed check clears the session's active shop and answers 403 `shop_access_revoked` or `shop_suspended`. This is the `ShopContextGuard` role from item 2, folded into `AccessGuard`.
- No route accepts a shop id. "Current" always means the session's active shop. Switching shops (`PUT /auth/session/active-shop`) validates membership and answers 404 `shop_not_found` both for shops the user cannot access and for unknown ids. Unknown body fields (such as `shopId`) are rejected with 400.
- `scopedToShop(prisma, shopId)` (`backend/src/database/tenant-scope.ts`) is a Prisma client extension. It adds `AND shop_id = <shop>` to every read, update and delete on shop-owned models, fills in the shop id on create, refuses a different shop id or a shop relation in writes, and throws on global or unclassified models.
- `@OwnerOnly()` is a stand-in for permissions until Phase 03; it guards `PATCH /shops/current`.
- PostgreSQL row-level security (item 7) is not added. A-002 is awaiting the owner's answer on whether to add it.

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

*Phase 02:* `audit_logs` is append-only through a database trigger. Recorded so far: registration, email verification, login, failed login, logout, password-reset request, password reset, shop switch, shop creation and shop update (with before and after values).

Audited actions include: login success/failure (security log), role/permission changes, membership changes, invitations, price changes, stock adjustments, discounts, refunds, voids, cash-session open/close/review, expense voids, subscription changes, exports, platform-admin access to shop data, device registration/revocation. Audit log is append-only and readable with `audit.read`.

## 13. Platform administration [D-022]

Platform admins use a separate admin area and permission scope. Accessing a shop's business data for support should require a logged reason (and optionally owner consent). Policy to be decided.

## 14. Security testing (summary)

See [testing strategy](../architecture/testing-strategy.md) §5. Phase 11 performs a full review against this document and OWASP ASVS Level 2 as a reference [A].
