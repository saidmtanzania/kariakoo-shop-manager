import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/**
 * Every environment variable the API reads. Validated once at boot so a
 * misconfigured deployment stops immediately with a clear message.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .regex(
      /^postgres(ql)?:\/\//,
      'DATABASE_URL must be a postgresql:// connection string',
    ),
  WEB_ORIGIN: z
    .string({ error: 'WEB_ORIGIN is required' })
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url('WEB_ORIGIN must contain valid URLs')).min(1)),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SWAGGER_ENABLED: booleanString.default(false),

  // ---- Sessions (decision A-003) ----
  /** Base URL of the web app, used in email links. Defaults to the first WEB_ORIGIN. */
  APP_URL: z.url('APP_URL must be a URL').optional(),
  /**
   * Send the session cookie only over HTTPS. Defaults to true in production.
   * When true the cookie uses the __Host- prefix.
   */
  COOKIE_SECURE: booleanString.optional(),
  /** Sign out after this many hours without activity. */
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** Sign out this many days after login, whatever the activity. */
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  /**
   * Number of reverse proxies in front of the API whose X-Forwarded-For
   * header is trusted for the client IP (the Next.js server counts as one).
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

  /**
   * Multiplies every rate limit. Only for automated browser tests, where
   * every simulated user shares one address; leave at 1 everywhere else.
   */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(100).default(1),

  // ---- Email ----
  /** smtp sends real mail; memory keeps it in-process (tests); log writes it to the log. */
  MAIL_TRANSPORT: z.enum(['smtp', 'memory', 'log']).default('smtp'),
  MAIL_FROM: z
    .string()
    .min(3)
    .default('Kariakoo Shop Manager <no-reply@localhost>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

  // ---- Outbox worker (decision A-007) ----
  /** Run the in-process outbox worker. Tests turn it off and drain explicitly. */
  OUTBOX_WORKER: z.enum(['on', 'off']).default('on'),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),

  // ---- Staff ----
  /**
   * Maximum members plus pending invitations per shop, until plans define
   * seat limits in Phase 04 (decision D-005). Unset means no limit.
   */
  SEAT_LIMIT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(10_000).optional(),
  ),
});

type RawConfig = z.infer<typeof envSchema>;

export type AppConfig = Omit<RawConfig, 'APP_URL' | 'COOKIE_SECURE'> & {
  APP_URL: string;
  COOKIE_SECURE: boolean;
};

export class InvalidConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'InvalidConfigError';
  }
}

export function validateEnv(
  raw: Record<string, string | undefined>,
): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`,
      ),
    );
  }
  const data = result.data;
  if (data.NODE_ENV === 'production' && data.MAIL_TRANSPORT === 'memory') {
    throw new InvalidConfigError([
      'MAIL_TRANSPORT: memory is for tests and cannot be used in production',
    ]);
  }
  return {
    ...data,
    APP_URL: (data.APP_URL ?? data.WEB_ORIGIN[0]).replace(/\/$/, ''),
    COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production',
  };
}
