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
  AuthTokenPurpose,
  BusinessType,
  InvitationStatus,
  MembershipStatus,
  OutboxStatus,
  PaymentStatus,
  PlanInterval,
  PermissionScope,
  ShopStatus,
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
  Role,
  Session,
  Shop,
  ShopMembership,
  Subscription,
  SubscriptionPayment,
  SubscriptionPeriod,
  User,
} from '../generated/prisma/client.js';
