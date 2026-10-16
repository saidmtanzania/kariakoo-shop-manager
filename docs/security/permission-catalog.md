# Permission Catalog — Kariakoo Shop Manager

| Field | Value |
|---|---|
| Phase | 03 |
| Status | As built; role templates awaiting owner approval (decision A-017) |
| Last updated | 2026-10-15 |

The source of truth is `packages/shared/src/permissions.ts`. Migration `20261015063853_rbac_and_invitations` inserts the same rows into the `permissions` table, and an integration test fails if the two differ (decision A-015). Labels come from the web app's message files.

## How permissions work

- **Owners** (`shop_memberships.is_owner`) hold every shop permission without a role (decision A-016).
- **Everyone else** holds the union of their roles' permissions in the active shop, loaded from the database on every request.
- **No escalation:** nobody can create, edit, delete or assign a role, or suspend or remove a member, unless they hold every permission involved. Owners are exempt.
- **Platform permissions** can never be held by a shop role (API validation and a database trigger).
- Routes without a permission: `GET shops/current` and `GET shops/current/permissions` are open to every active member; changing owners is owner-only.

## Shop permissions

Columns M, C and S show the default Manager, Cashier and Storekeeper roles that every new shop starts with (decision A-017). Owners can edit or delete these roles.

### Dashboard / Dashibodi

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `dashboard.read` | See the dashboard | Kuona dashibodi | ✓ | ✓ | ✓ | Later phase |

### Sales / Mauzo

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `sales.read` | See own sales | Kuona mauzo yake | ✓ | ✓ |  | Later phase |
| `sales.read_all` | See all sales | Kuona mauzo yote | ✓ |  |  | Later phase |
| `sales.create` | Make sales | Kuuza | ✓ | ✓ |  | Later phase |
| `sales.discount` | Give discounts | Kutoa punguzo | ✓ |  |  | Later phase |
| `sales.credit` | Sell on credit | Kuuza kwa mkopo | ✓ | ✓ |  | Later phase |
| `sales.refund` | Refund sales | Kurudisha pesa za mauzo | ✓ |  |  | Later phase |
| `sales.void` | Void sales | Kufuta mauzo | ✓ |  |  | Later phase |

### Products / Bidhaa

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `products.read` | See products | Kuona bidhaa | ✓ | ✓ | ✓ | Phase 05 |
| `products.create` | Add products | Kuongeza bidhaa | ✓ |  | ✓ | Phase 05 |
| `products.update` | Edit products | Kuhariri bidhaa | ✓ |  | ✓ | Phase 05 |
| `products.archive` | Archive products | Kuhifadhi bidhaa zisizotumika | ✓ |  |  | Phase 05 |
| `products.prices.update` | Change prices | Kubadilisha bei | ✓ |  |  | Phase 05 |

### Stock / Stoo

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `inventory.read` | See stock | Kuona stoo | ✓ | ✓ | ✓ | Phase 05 |
| `inventory.adjust` | Adjust stock | Kurekebisha stoo | ✓ |  | ✓ | Phase 05 |
| `inventory.opening` | Enter opening stock | Kuingiza stoo ya mwanzo | ✓ |  |  | Phase 05 |

### Purchases and suppliers / Manunuzi na wasambazaji

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `suppliers.read` | See suppliers | Kuona wasambazaji | ✓ |  | ✓ | Later phase |
| `suppliers.manage` | Manage suppliers | Kusimamia wasambazaji | ✓ |  |  | Later phase |
| `purchases.read` | See purchases | Kuona manunuzi | ✓ |  | ✓ | Later phase |
| `purchases.create` | Create purchases | Kuunda manunuzi | ✓ |  |  | Later phase |
| `purchases.receive` | Receive goods | Kupokea mzigo | ✓ |  | ✓ | Later phase |
| `purchases.cancel` | Cancel purchases | Kughairi manunuzi | ✓ |  |  | Later phase |
| `supplier_payments.create` | Pay suppliers | Kulipa wasambazaji | ✓ |  |  | Later phase |

### Customers / Wateja

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `customers.read` | See customers | Kuona wateja | ✓ | ✓ |  | Later phase |
| `customers.manage` | Manage customers | Kusimamia wateja | ✓ | ✓ |  | Later phase |
| `customers.credit.manage` | Manage customer credit limits | Kusimamia kikomo cha mkopo cha wateja | ✓ |  |  | Later phase |

### Expenses / Matumizi

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `expenses.read` | See expenses | Kuona matumizi | ✓ |  |  | Later phase |
| `expenses.create` | Record expenses | Kuandika matumizi | ✓ | ✓ |  | Later phase |
| `expenses.void` | Void expenses | Kufuta matumizi | ✓ |  |  | Later phase |

### Cash drawer / Droo ya fedha

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `cash_sessions.open` | Open the cash drawer | Kufungua droo ya fedha | ✓ | ✓ |  | Later phase |
| `cash_sessions.close` | Close the cash drawer | Kufunga droo ya fedha | ✓ | ✓ |  | Later phase |
| `cash_sessions.review` | Review cash counts | Kukagua hesabu za fedha | ✓ |  |  | Later phase |

### Reports / Ripoti

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `reports.read` | See reports | Kuona ripoti | ✓ |  |  | Later phase |
| `reports.profit.read` | See profit | Kuona faida | ✓ |  |  | Later phase |
| `reports.export` | Export reports | Kupakua ripoti | ✓ |  |  | Later phase |

### Team / Wafanyakazi

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `users.read` | See the team | Kuona wafanyakazi | ✓ |  |  | `GET shops/current/members`, `GET shops/current/roles`, `GET shops/current/invitations` |
| `users.invite` | Invite staff | Kualika wafanyakazi | ✓ |  |  | `POST shops/current/invitations`, resend, revoke |
| `users.manage` | Manage staff | Kusimamia wafanyakazi |  |  |  | `PUT shops/current/members/:id/roles`, `PUT …/status`, `DELETE …/:id` |
| `roles.manage` | Manage roles | Kusimamia majukumu |  |  |  | `POST`, `PUT`, `DELETE shops/current/roles` |
| `audit.read` | See the activity log | Kuona kumbukumbu za shughuli | ✓ |  |  | `GET shops/current/audit-logs` |

### Settings / Mipangilio

| Code | English | Kiswahili | M | C | S | Used by (Phase 03) |
|---|---|---|---|---|---|---|
| `subscription.read` | See the subscription | Kuona usajili | ✓ |  |  | Later phase |
| `subscription.manage` | Manage the subscription | Kusimamia usajili |  |  |  | Later phase |
| `settings.manage` | Change shop settings | Kubadilisha mipangilio ya duka |  |  |  | `PATCH shops/current` |
| `devices.manage` | Manage devices | Kusimamia vifaa |  |  |  | Later phase |

## Platform permissions

Held only by platform staff (Phase 11). Never delegable and never shown to shops.

| Code | Purpose |
|---|---|
| `platform.shops.manage` | Suspend and manage shops |
| `platform.plans.manage` | Edit subscription plans |
| `platform.payments.reconcile` | Reconcile payments |
| `platform.support.access` | Audited support access to shop data (decision D-022) |

## Totals

44 shop permissions and 4 platform permissions. Default roles: Manager 39, Cashier 11, Storekeeper 9.

## Adding a permission

1. Add it to `PERMISSIONS` in `packages/shared/src/permissions.ts` (and to a default role if it belongs there).
2. Add a migration inserting the row into `permissions`.
3. Add English and Kiswahili labels under `Permissions` in `apps/web/messages/*.json` (a unit test checks both).
4. Protect the route with `@RequirePermission('<code>')` and add allowed and forbidden tests.
