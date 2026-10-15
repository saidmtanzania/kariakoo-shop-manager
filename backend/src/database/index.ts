// Public surface of the data-access layer. Services import Prisma types from
// here, never from the generated client (architecture rule).
export { PrismaService } from './prisma.service.js';
export {
  GLOBAL_MODELS,
  scopedToShop,
  TENANT_MODELS,
  TenantScopeError,
  type ShopScopedPrisma,
} from './tenant-scope.js';
export {
  Prisma,
  AuthTokenPurpose,
  BusinessType,
  InvitationStatus,
  MembershipStatus,
  OutboxStatus,
  PermissionScope,
  ShopStatus,
  UserStatus,
} from '../generated/prisma/client.js';
export type {
  AuditLog,
  AuthToken,
  Invitation,
  OutboxMessage,
  Role,
  Session,
  Shop,
  ShopMembership,
  User,
} from '../generated/prisma/client.js';
