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
});

export type AppConfig = z.infer<typeof envSchema>;

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
  return result.data;
}
