import {
  DEFAULT_ROLE_TEMPLATES,
  inviteSchema,
  isShopPermission,
  PERMISSION_MODULES,
  PERMISSIONS,
  roleInputSchema,
  SHOP_PERMISSIONS,
} from './permissions.js';

describe('permission catalog', () => {
  it('has unique codes', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps platform permissions out of the shop catalog', () => {
    expect(SHOP_PERMISSIONS.some((c) => c.startsWith('platform.'))).toBe(false);
    expect(isShopPermission('platform.shops.manage')).toBe(false);
    expect(isShopPermission('sales.create')).toBe(true);
  });

  it('lists every shop module in the display order', () => {
    const modules = new Set(
      PERMISSIONS.filter((p) => p.scope === 'SHOP').map((p) => p.module),
    );
    expect([...modules].sort()).toEqual([...PERMISSION_MODULES].sort());
  });

  it('builds default roles only from shop permissions', () => {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      expect(template.permissions.every(isShopPermission)).toBe(true);
      expect(new Set(template.permissions).size).toBe(
        template.permissions.length,
      );
    }
  });

  it('rejects unknown or platform permissions in a role', () => {
    expect(
      roleInputSchema.safeParse({ name: 'X', permissions: ['sales.create'] })
        .success,
    ).toBe(true);
    expect(
      roleInputSchema.safeParse({
        name: 'X',
        permissions: ['platform.plans.manage'],
      }).success,
    ).toBe(false);
    expect(
      roleInputSchema.safeParse({ name: 'X', permissions: ['made.up'] })
        .success,
    ).toBe(false);
    expect(
      roleInputSchema.safeParse({ name: ' ', permissions: [] }).success,
    ).toBe(false);
  });

  it('requires at least one role on an invitation', () => {
    expect(
      inviteSchema.safeParse({ email: 'a@b.tz', roleIds: [] }).success,
    ).toBe(false);
  });
});
