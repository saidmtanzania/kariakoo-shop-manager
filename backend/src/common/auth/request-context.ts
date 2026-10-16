import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  activeShopId: string | null;
  isPlatformAdmin: boolean;
}

/** Resolved only from the server-side session; never from client input. */
export interface ShopContext {
  shopId: string;
  membershipId: string;
  userId: string;
  isOwner: boolean;
  /** Effective permissions in this shop, loaded on every request. */
  permissions: ReadonlySet<string>;
}

export interface AppRequest extends Request {
  auth?: AuthContext;
  shopContext?: ShopContext;
}

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const auth = ctx.switchToHttp().getRequest<AppRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a route without a session');
    return auth;
  },
);

export const CurrentShop = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const shop = ctx.switchToHttp().getRequest<AppRequest>().shopContext;
    if (!shop)
      throw new Error('CurrentShop used on a route that is not @ShopScoped()');
    return shop;
  },
);

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export function clientInfo(req: Request): ClientInfo {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
  };
}

export const Client = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    clientInfo(ctx.switchToHttp().getRequest<Request>()),
);
