import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from './prisma.service.js';

/**
 * Classification of every Prisma model (decision A-002). A model must appear
 * in exactly one of these lists; the tenant-scope integration test fails when
 * a new model is added without being classified.
 *
 * TENANT_MODELS maps a shop-owned model to the field holding the shop id.
 */
export const TENANT_MODELS = {
  Shop: 'id',
  ShopMembership: 'shopId',
  AuditLog: 'shopId',
  Role: 'shopId',
  RolePermission: 'shopId',
  MembershipRole: 'shopId',
  Invitation: 'shopId',
  InvitationRole: 'shopId',
  // Shop work queues its email in the shop's transaction; messages that
  // belong to no shop (sign-up, password reset) are written unscoped with a
  // null shop id.
  OutboxMessage: 'shopId',
  Subscription: 'shopId',
  SubscriptionPeriod: 'shopId',
  SubscriptionPayment: 'shopId',
  SubscriptionReminder: 'shopId',
} as const satisfies Partial<Record<Prisma.ModelName, string>>;

/** Models that are not owned by a shop (global identity and infrastructure). */
export const GLOBAL_MODELS = [
  'User',
  'Session',
  'AuthToken',
  'RateLimitCounter',
  'Permission',
  // Platform price list and settings, edited by platform staff only.
  'Plan',
  'PlanFeature',
  'BillingSettings',
  // Provider callbacks: the shop is known only after the event is verified.
  'PaymentEvent',
] as const satisfies readonly Prisma.ModelName[];

type TenantModel = keyof typeof TENANT_MODELS;

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

type Args = Record<string, unknown>;

function isTenantModel(model: string): model is TenantModel {
  return Object.hasOwn(TENANT_MODELS, model);
}

function scopeData(
  model: TenantModel,
  field: string,
  shopId: string,
  data: unknown,
): unknown {
  if (Array.isArray(data))
    return data.map((row) => scopeData(model, field, shopId, row));
  if (data === null || typeof data !== 'object') return data;
  const row = data as Args;
  if (row[field] !== undefined && row[field] !== shopId) {
    throw new TenantScopeError(
      `${model}.${field} does not match the active shop`,
    );
  }
  if (model === 'Shop') return row; // a shop's id is generated, never re-scoped
  if ('shop' in row) {
    throw new TenantScopeError(
      `${model}: set ${field} through the scoped client, not a shop relation`,
    );
  }
  return { ...row, [field]: shopId };
}

function guardUpdate(
  model: TenantModel,
  field: string,
  shopId: string,
  data: unknown,
): void {
  if (data === null || typeof data !== 'object') return;
  const value = (data as Args)[field];
  if (value !== undefined && value !== shopId) {
    throw new TenantScopeError(
      `${model}.${field} cannot be moved to another shop`,
    );
  }
  if ('shop' in (data as Args)) {
    throw new TenantScopeError(`${model}: the shop relation cannot be changed`);
  }
}

/** Adds `AND: [{ <field>: shopId }]`, which every where input (unique ones too) accepts. */
function scopeWhere(field: string, shopId: string, where: unknown): Args {
  const base = (where ?? {}) as Args;
  const existingAnd =
    base.AND === undefined
      ? []
      : Array.isArray(base.AND)
        ? base.AND
        : [base.AND];
  return { ...base, AND: [...existingAnd, { [field]: shopId }] };
}

/**
 * Returns a Prisma client whose queries on shop-owned models are confined to
 * one shop: reads and writes get a shop filter, creates get the shop id, and
 * any attempt to read or write another shop's rows fails or finds nothing.
 * Queries on unclassified models throw, so new tables cannot bypass scoping.
 *
 * The shop id must come from the server-side ShopContext, never from client input.
 */
export function scopedToShop(prisma: PrismaService, shopId: string) {
  if (!shopId) throw new TenantScopeError('A shop id is required');
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if ((GLOBAL_MODELS as readonly string[]).includes(model)) {
            throw new TenantScopeError(
              `${model} is not shop-owned; use the unscoped PrismaService for it`,
            );
          }
          if (!isTenantModel(model)) {
            throw new TenantScopeError(
              `${model} is not classified in TENANT_MODELS or GLOBAL_MODELS`,
            );
          }
          const field = TENANT_MODELS[model];
          const scoped: Args = { ...(args as Args) };

          if (CREATE_OPERATIONS.has(operation)) {
            scoped.data = scopeData(model, field, shopId, scoped.data);
          } else if (WHERE_OPERATIONS.has(operation)) {
            scoped.where = scopeWhere(field, shopId, scoped.where);
            if (operation === 'upsert') {
              scoped.create = scopeData(model, field, shopId, scoped.create);
              guardUpdate(model, field, shopId, scoped.update);
            } else if (operation.startsWith('update')) {
              guardUpdate(model, field, shopId, scoped.data);
            }
          } else {
            throw new TenantScopeError(
              `Operation ${operation} is not supported on scoped models`,
            );
          }
          return query(scoped as typeof args);
        },
      },
    },
  });
}

export type ShopScopedPrisma = ReturnType<typeof scopedToShop>;

/** A transaction opened on a shop-scoped client. */
export type ShopScopedTx = Parameters<
  Parameters<ShopScopedPrisma['$transaction']>[0]
>[0];
