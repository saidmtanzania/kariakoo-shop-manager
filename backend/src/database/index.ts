// Public surface of the data-access layer. Services import Prisma types from
// here, never from the generated client (architecture rule).
export { PrismaService } from './prisma.service.js';
export {
  GLOBAL_MODELS,
  scopedToShop,
  TENANT_MODELS,
  TenantScopeError,
  type ShopScopedPrisma,
  type ShopScopedTx,
} from './tenant-scope.js';
export {
  Prisma,
  AdjustmentReason,
  AuthTokenPurpose,
  BusinessType,
  InvitationStatus,
  MembershipStatus,
  OutboxStatus,
  PaymentStatus,
  PlanInterval,
  PermissionScope,
  ShopStatus,
  StockMovementType,
  UserStatus,
} from '../generated/prisma/client.js';
export type {
  AuditLog,
  AuthToken,
  Invitation,
  OutboxMessage,
  PaymentEvent,
  Plan,
  PlanFeature,
  Product,
  ProductCategory,
  ProductUnit,
  Role,
  Session,
  Shop,
  ShopMembership,
  Subscription,
  SubscriptionPayment,
  SubscriptionPeriod,
  StockMovement,
  User,
} from '../generated/prisma/client.js';
