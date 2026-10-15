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
  MembershipStatus,
  ShopStatus,
  UserStatus,
} from '../generated/prisma/client.js';
export type {
  AuditLog,
  AuthToken,
  Session,
  Shop,
  ShopMembership,
  User,
} from '../generated/prisma/client.js';
