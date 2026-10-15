import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';

export interface RateLimitRule {
  /** Distinguishes counters of different routes. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** ip: per client IP. email: per email address in the request body. */
  by: 'ip' | 'email';
}

const RATE_LIMIT_KEY = 'ksm:rate-limit';

/** Applies one or more limits to a route; all must pass. */
export const RateLimit = (...rules: RateLimitRule[]) =>
  SetMetadata(RATE_LIMIT_KEY, rules);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<RateLimitRule[] | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!rules?.length) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    for (const rule of rules) {
      const subject = rule.by === 'ip' ? req.ip : emailFromBody(req.body);
      if (!subject) continue;
      const result = await this.limits.hit(
        `${rule.name}:${rule.by}:${subject}`,
        rule.limit,
        rule.windowSeconds,
      );
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        throw new HttpException(
          {
            message: 'Too many attempts. Please wait and try again.',
            code: 'rate_limited',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}

function emailFromBody(body: unknown): string | null {
  if (
    body &&
    typeof body === 'object' &&
    'email' in body &&
    typeof body.email === 'string'
  ) {
    return body.email.trim().toLowerCase().slice(0, 254);
  }
  return null;
}
