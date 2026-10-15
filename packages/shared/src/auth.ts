import { z } from 'zod';

/** Limits shared by the API's validation and the web forms. */
export const AUTH_LIMITS = {
  passwordMin: 8,
  passwordMax: 128,
  nameMax: 120,
  emailMax: 254,
} as const;

/** Header every state-changing request must carry (CSRF defence). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';

export const emailSchema = z.email().max(AUTH_LIMITS.emailMax);
export const passwordSchema = z
  .string()
  .min(AUTH_LIMITS.passwordMin)
  .max(AUTH_LIMITS.passwordMax);

export const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(AUTH_LIMITS.nameMax),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(AUTH_LIMITS.passwordMax),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const emailOnlySchema = z.object({ email: emailSchema });
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const businessTypes = ['WHOLESALE', 'RETAIL', 'BOTH'] as const;
export type BusinessType = (typeof businessTypes)[number];

export const createShopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(255).optional(),
  businessType: z.enum(businessTypes).default('BOTH'),
});
export type CreateShopInput = z.input<typeof createShopSchema>;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

export interface MembershipSummary {
  membershipId: string;
  shopId: string;
  shopName: string;
  isOwner: boolean;
}

/** Response of GET /api/v1/auth/session. */
export interface SessionInfo {
  user: SessionUser;
  activeShopId: string | null;
  memberships: MembershipSummary[];
}

export interface ShopDetails {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  businessType: BusinessType;
  timezone: string;
  currency: string;
  status: 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED';
}
