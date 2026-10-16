import { InvalidConfigError, validateEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgresql://ksm:secret@localhost:5432/ksm',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const config = validateEnv(valid);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      SWAGGER_ENABLED: false,
      WEB_ORIGIN: ['http://localhost:3000'],
    });
  });

  it('parses several web origins and coerces the port', () => {
    const config = validateEnv({
      ...valid,
      PORT: '8080',
      WEB_ORIGIN: 'http://localhost:3000, https://app.example.co.tz',
      SWAGGER_ENABLED: 'true',
    });
    expect(config.PORT).toBe(8080);
    expect(config.WEB_ORIGIN).toEqual([
      'http://localhost:3000',
      'https://app.example.co.tz',
    ]);
    expect(config.SWAGGER_ENABLED).toBe(true);
  });

  it('fails with a message naming every missing variable', () => {
    expect(() => validateEnv({})).toThrow(InvalidConfigError);
    try {
      validateEnv({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL is required');
      expect(message).toContain('WEB_ORIGIN is required');
    }
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(
      /postgresql:\/\//,
    );
  });

  it('derives APP_URL and COOKIE_SECURE', () => {
    expect(validateEnv(valid)).toMatchObject({
      APP_URL: 'http://localhost:3000',
      COOKIE_SECURE: false,
      SESSION_IDLE_HOURS: 12,
      SESSION_ABSOLUTE_DAYS: 7,
    });
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production' }).COOKIE_SECURE,
    ).toBe(true);
    expect(
      validateEnv({ ...valid, APP_URL: 'https://app.example.co.tz/' }).APP_URL,
    ).toBe('https://app.example.co.tz');
  });

  it('refuses the in-memory mail transport in production', () => {
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        MAIL_TRANSPORT: 'memory',
      }),
    ).toThrow(/MAIL_TRANSPORT/);
  });

  it('rejects an invalid port and log level', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('treats an empty sandbox secret as disabled and refuses it in production', () => {
    expect(
      validateEnv({ ...valid, PAYMENT_SANDBOX_SECRET: '' })
        .PAYMENT_SANDBOX_SECRET,
    ).toBeUndefined();
    expect(() =>
      validateEnv({ ...valid, PAYMENT_SANDBOX_SECRET: 'short' }),
    ).toThrow(/PAYMENT_SANDBOX_SECRET/);
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        PAYMENT_SANDBOX_SECRET: 'a-long-enough-sandbox-secret',
      }),
    ).toThrow(/cannot be enabled in production/);
  });

  it('defaults subscription jobs on, every 5 minutes', () => {
    expect(validateEnv(valid)).toMatchObject({
      SUBSCRIPTION_JOBS: 'on',
      SUBSCRIPTION_JOBS_INTERVAL_MS: 300_000,
      PAYMENT_RECONCILE_AFTER_MINUTES: 10,
    });
  });

  it('defaults the outbox worker on and the rate limit multiplier to 1', () => {
    expect(validateEnv(valid)).toMatchObject({
      OUTBOX_WORKER: 'on',
      OUTBOX_POLL_MS: 1000,
      RATE_LIMIT_MULTIPLIER: 1,
    });
    expect(() =>
      validateEnv({ ...valid, RATE_LIMIT_MULTIPLIER: '1000' }),
    ).toThrow(/RATE_LIMIT_MULTIPLIER/);
  });
});
