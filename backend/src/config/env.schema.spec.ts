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

  it('rejects an invalid port and log level', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
