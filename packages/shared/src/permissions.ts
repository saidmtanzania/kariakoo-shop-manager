import { z } from 'zod';

/**
 * The permission catalog (data-model.md section 3). This list is the source
 * the API types and the web screens use; the `permissions` table holds the
 * same rows, seeded by migration, and an integration test keeps them equal.
 *
 * - SHOP permissions can be put in a shop's custom roles.
 * - PLATFORM permissions belong to platform operators and never appear in a
 *   shop's catalog or roles.
 */
export const PERMISSIONS = [
  { code: 'dashboard.read', module: 'dashboard', scope: 'SHOP' },
  { code: 'products.read', module: 'products', scope: 'SHOP' },
  { code: 'products.create', module: 'products', scope: 'SHOP' },
  { code: 'products.update', module: 'products', scope: 'SHOP' },
  { code: 'products.archive', module: 'products', scope: 'SHOP' },
  { code: 'products.prices.update', module: 'products', scope: 'SHOP' },
  { code: 'inventory.read', module: 'inventory', scope: 'SHOP' },
  { code: 'inventory.adjust', module: 'inventory', scope: 'SHOP' },
  { code: 'inventory.opening', module: 'inventory', scope: 'SHOP' },
  { code: 'suppliers.read', module: 'purchases', scope: 'SHOP' },
  { code: 'suppliers.manage', module: 'purchases', scope: 'SHOP' },
  { code: 'purchases.read', module: 'purchases', scope: 'SHOP' },
  { code: 'purchases.create', module: 'purchases', scope: 'SHOP' },
  { code: 'purchases.receive', module: 'purchases', scope: 'SHOP' },
  { code: 'purchases.cancel', module: 'purchases', scope: 'SHOP' },
  { code: 'supplier_payments.create', module: 'purchases', scope: 'SHOP' },
  { code: 'sales.read', module: 'sales', scope: 'SHOP' },
  { code: 'sales.read_all', module: 'sales', scope: 'SHOP' },
  { code: 'sales.create', module: 'sales', scope: 'SHOP' },
  { code: 'sales.discount', module: 'sales', scope: 'SHOP' },
  { code: 'sales.credit', module: 'sales', scope: 'SHOP' },
  { code: 'sales.refund', module: 'sales', scope: 'SHOP' },
  { code: 'sales.void', module: 'sales', scope: 'SHOP' },
  { code: 'customers.read', module: 'customers', scope: 'SHOP' },
  { code: 'customers.manage', module: 'customers', scope: 'SHOP' },
  { code: 'customers.credit.manage', module: 'customers', scope: 'SHOP' },
  { code: 'expenses.read', module: 'expenses', scope: 'SHOP' },
  { code: 'expenses.create', module: 'expenses', scope: 'SHOP' },
  { code: 'expenses.void', module: 'expenses', scope: 'SHOP' },
  { code: 'cash_sessions.open', module: 'cash', scope: 'SHOP' },
  { code: 'cash_sessions.close', module: 'cash', scope: 'SHOP' },
  { code: 'cash_sessions.review', module: 'cash', scope: 'SHOP' },
  { code: 'reports.read', module: 'reports', scope: 'SHOP' },
  { code: 'reports.profit.read', module: 'reports', scope: 'SHOP' },
  { code: 'reports.export', module: 'reports', scope: 'SHOP' },
  { code: 'users.read', module: 'team', scope: 'SHOP' },
  { code: 'users.invite', module: 'team', scope: 'SHOP' },
  { code: 'users.manage', module: 'team', scope: 'SHOP' },
  { code: 'roles.manage', module: 'team', scope: 'SHOP' },
  { code: 'audit.read', module: 'team', scope: 'SHOP' },
  { code: 'subscription.read', module: 'settings', scope: 'SHOP' },
  { code: 'subscription.manage', module: 'settings', scope: 'SHOP' },
  { code: 'settings.manage', module: 'settings', scope: 'SHOP' },
  { code: 'devices.manage', module: 'settings', scope: 'SHOP' },
  { code: 'platform.shops.manage', module: 'platform', scope: 'PLATFORM' },
  { code: 'platform.plans.manage', module: 'platform', scope: 'PLATFORM' },
  {
    code: 'platform.payments.reconcile',
    module: 'platform',
    scope: 'PLATFORM',
  },
  { code: 'platform.support.access', module: 'platform', scope: 'PLATFORM' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];
export type ShopPermissionCode = Extract<
  (typeof PERMISSIONS)[number],
  { scope: 'SHOP' }
>['code'];

export const SHOP_PERMISSIONS = PERMISSIONS.filter(
  (p): p is Extract<(typeof PERMISSIONS)[number], { scope: 'SHOP' }> =>
    p.scope === 'SHOP',
).map((p) => p.code);

const shopPermissionSet: ReadonlySet<string> = new Set(SHOP_PERMISSIONS);
export function isShopPermission(code: string): code is ShopPermissionCode {
  return shopPermissionSet.has(code);
}

/** Order in which modules are shown when picking permissions. */
export const PERMISSION_MODULES = [
  'dashboard',
  'sales',
  'products',
  'inventory',
  'purchases',
  'customers',
  'expenses',
  'cash',
  'reports',
  'team',
  'settings',
] as const;

/**
 * Roles every new shop starts with. They are ordinary custom roles: the
 * owner can rename, edit or delete them (decision A-016).
 */
export const DEFAULT_ROLE_TEMPLATES: readonly {
  key: 'manager' | 'cashier' | 'storekeeper';
  name: string;
  permissions: readonly ShopPermissionCode[];
}[] = [
  {
    key: 'manager',
    name: 'Manager',
    permissions: [
      'dashboard.read',
      'products.read',
      'products.create',
      'products.update',
      'products.archive',
      'products.prices.update',
      'inventory.read',
      'inventory.adjust',
      'inventory.opening',
      'suppliers.read',
      'suppliers.manage',
      'purchases.read',
      'purchases.create',
      'purchases.receive',
      'purchases.cancel',
      'supplier_payments.create',
      'sales.read',
      'sales.read_all',
      'sales.create',
      'sales.discount',
      'sales.credit',
      'sales.refund',
      'sales.void',
      'customers.read',
      'customers.manage',
      'customers.credit.manage',
      'expenses.read',
      'expenses.create',
      'expenses.void',
      'cash_sessions.open',
      'cash_sessions.close',
      'cash_sessions.review',
      'reports.read',
      'reports.profit.read',
      'reports.export',
      'users.read',
      'users.invite',
      'audit.read',
      'subscription.read',
    ],
  },
  {
    key: 'cashier',
    name: 'Cashier',
    permissions: [
      'dashboard.read',
      'products.read',
      'inventory.read',
      'sales.read',
      'sales.create',
      'sales.credit',
      'customers.read',
      'customers.manage',
      'expenses.create',
      'cash_sessions.open',
      'cash_sessions.close',
    ],
  },
  {
    key: 'storekeeper',
    name: 'Storekeeper',
    permissions: [
      'dashboard.read',
      'products.read',
      'products.create',
      'products.update',
      'inventory.read',
      'inventory.adjust',
      'suppliers.read',
      'purchases.read',
      'purchases.receive',
    ],
  },
];

export const ROLE_LIMITS = { nameMax: 60, maxRolesPerMember: 10 } as const;

const permissionCodeSchema = z
  .string()
  .refine(isShopPermission, { message: 'Unknown permission' });

export const roleInputSchema = z.object({
  name: z.string().trim().min(1).max(ROLE_LIMITS.nameMax),
  permissions: z.array(permissionCodeSchema).max(SHOP_PERMISSIONS.length),
});
export type RoleInput = z.input<typeof roleInputSchema>;

export const inviteSchema = z.object({
  email: z.email().max(254),
  roleIds: z.array(z.uuid()).min(1).max(ROLE_LIMITS.maxRolesPerMember),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export interface PermissionInfo {
  code: ShopPermissionCode;
  module: string;
}

export interface RoleView {
  id: string;
  name: string;
  permissions: ShopPermissionCode[];
  memberCount: number;
}

export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface MemberView {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  isOwner: boolean;
  status: MemberStatus;
  joinedAt: string;
  roles: { id: string; name: string }[];
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface InvitationView {
  id: string;
  email: string;
  status: InvitationStatus;
  roles: { id: string; name: string }[];
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  resendCount: number;
}

/** What the invitee sees before accepting. */
export interface InvitationPreview {
  shopName: string;
  email: string;
  invitedBy: string | null;
  status: InvitationStatus;
  expiresAt: string;
}

export interface AuditEntryView {
  id: string;
  action: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}
