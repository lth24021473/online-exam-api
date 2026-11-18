import 'reflect-metadata';
import { validate } from './env.validation';

describe('Environment Validation (env.validation)', () => {
  const validMinioConfig = {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'online-exam-storage',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    S3_PUBLIC_URL_PREFIX: 'http://localhost:9000/online-exam-storage',
  };

  it('should pass validation for valid MinIO configuration', () => {
    const config = {
      ...validMinioConfig,
      PORT: '3000',
      DATABASE_URL: 'mongodb://localhost:27017/test',
    };

    expect(() => validate(config)).not.toThrow();
    const result = validate(config);
    expect(result.S3_ENDPOINT).toBe('http://localhost:9000');
    expect(result.S3_BUCKET).toBe('online-exam-storage');
    expect(result.PORT).toBe('3000');
  });

  it('should pass validation for valid Cloudflare R2 configuration', () => {
    const r2Config = {
      S3_ENDPOINT: 'https://abc123def456.r2.cloudflarestorage.com',
      S3_REGION: 'auto',
      S3_BUCKET: 'exam-assets',
      S3_ACCESS_KEY_ID: 'r2-access-key',
      S3_SECRET_ACCESS_KEY: 'r2-secret-key',
      S3_PUBLIC_URL_PREFIX: 'https://cdn.example.com',
    };

    const result = validate(r2Config);
    expect(result.S3_ENDPOINT).toBe(
      'https://abc123def456.r2.cloudflarestorage.com',
    );
    expect(result.S3_REGION).toBe('auto');
    expect(result.S3_PUBLIC_URL_PREFIX).toBe('https://cdn.example.com');
  });

  it('should pass validation for AWS S3 when S3_ENDPOINT and S3_PUBLIC_URL_PREFIX are omitted', () => {
    const awsConfig = {
      S3_REGION: 'ap-southeast-1',
      S3_BUCKET: 'prod-online-exam-bucket',
      S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };

    const result = validate(awsConfig);
    expect(result.S3_ENDPOINT).toBeUndefined();
    expect(result.S3_PUBLIC_URL_PREFIX).toBeUndefined();
    expect(result.S3_REGION).toBe('ap-southeast-1');
  });

  it('should normalize empty or whitespace S3_ENDPOINT and S3_PUBLIC_URL_PREFIX to undefined', () => {
    const awsWithEmptyOptionals = {
      S3_ENDPOINT: '   ',
      S3_REGION: '  ap-southeast-1  ',
      S3_BUCKET: '  prod-bucket  ',
      S3_ACCESS_KEY_ID: '  access-key  ',
      S3_SECRET_ACCESS_KEY: '  secret-key  ',
      S3_PUBLIC_URL_PREFIX: '',
    };

    const result = validate(awsWithEmptyOptionals);
    expect(result.S3_ENDPOINT).toBeUndefined();
    expect(result.S3_PUBLIC_URL_PREFIX).toBeUndefined();
    expect(result.S3_REGION).toBe('ap-southeast-1');
    expect(result.S3_BUCKET).toBe('prod-bucket');
    expect(result.S3_ACCESS_KEY_ID).toBe('access-key');
    expect(result.S3_SECRET_ACCESS_KEY).toBe('secret-key');
  });

  it('should throw an error if any core S3 variable is missing outside test NODE_ENV', () => {
    const coreKeys = [
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const;

    for (const key of coreKeys) {
      const incompleteConfig: Record<string, string> = {
        ...validMinioConfig,
        NODE_ENV: 'production',
      };
      delete incompleteConfig[key];

      expect(() => validate(incompleteConfig)).toThrow(
        /Environment validation failed/,
      );
    }
  });

  it('should throw an error if any core S3 variable is empty or whitespace-only outside test NODE_ENV', () => {
    const coreKeys = [
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const;

    for (const key of coreKeys) {
      const whitespaceConfig: Record<string, string> = {
        ...validMinioConfig,
        NODE_ENV: 'development',
        [key]: '   ',
      };

      expect(() => validate(whitespaceConfig)).toThrow(
        /Environment validation failed/,
      );
    }
  });

  it('should reject invalid URLs for S3_ENDPOINT and S3_PUBLIC_URL_PREFIX', () => {
    const invalidUrls = ['not-a-url', 'localhost:9000', 'ftp://localhost:9000'];

    for (const invalidUrl of invalidUrls) {
      expect(() =>
        validate({
          ...validMinioConfig,
          S3_ENDPOINT: invalidUrl,
        }),
      ).toThrow(/Environment validation failed/);

      expect(() =>
        validate({
          ...validMinioConfig,
          S3_PUBLIC_URL_PREFIX: invalidUrl,
        }),
      ).toThrow(/Environment validation failed/);
    }
  });

  it('should allow omitting S3 variables when NODE_ENV is test', () => {
    const result = validate({ NODE_ENV: 'test' });
    expect(result.NODE_ENV).toBe('test');
    expect(result.S3_ENDPOINT).toBeUndefined();
    expect(result.S3_BUCKET).toBeUndefined();
  });

  it('should validate optional S3_FORCE_PATH_STYLE case-insensitively when provided', () => {
    expect(
      validate({ ...validMinioConfig, S3_FORCE_PATH_STYLE: 'true' })
        .S3_FORCE_PATH_STYLE,
    ).toBe('true');
    expect(
      validate({ ...validMinioConfig, S3_FORCE_PATH_STYLE: 'TRUE' })
        .S3_FORCE_PATH_STYLE,
    ).toBe('true');
    expect(
      validate({ ...validMinioConfig, S3_FORCE_PATH_STYLE: ' False ' })
        .S3_FORCE_PATH_STYLE,
    ).toBe('false');
    expect(
      validate({ ...validMinioConfig, S3_FORCE_PATH_STYLE: ' ' })
        .S3_FORCE_PATH_STYLE,
    ).toBeUndefined();
    expect(() =>
      validate({ ...validMinioConfig, S3_FORCE_PATH_STYLE: 'yes' }),
    ).toThrow(/Environment validation failed/);
  });

  it('should retain optional configuration variables', () => {
    const config = {
      ...validMinioConfig,
      JWT_SECRET: 'supersecret',
      JWT_EXPIRES_IN: '86400',
      NODE_ENV: 'production',
    };

    const result = validate(config);
    expect(result.JWT_SECRET).toBe('supersecret');
    expect(result.JWT_EXPIRES_IN).toBe('86400');
    expect(result.NODE_ENV).toBe('production');
  });

  describe('optional Redis configuration', () => {
    it('should allow omitting all REDIS_* variables even outside test NODE_ENV', () => {
      const result = validate({
        ...validMinioConfig,
        NODE_ENV: 'production',
      });

      expect(result.REDIS_URL).toBeUndefined();
      expect(result.REDIS_HOST).toBeUndefined();
      expect(result.REDIS_PORT).toBeUndefined();
      expect(result.REDIS_PASSWORD).toBeUndefined();
      expect(result.REDIS_DB).toBeUndefined();
    });

    it('should accept valid redis:// and rediss:// REDIS_URL values including password-only auth and IPv6', () => {
      const urls = [
        '  redis://localhost:6379  ',
        'redis://:secret@redis:6379/0',
        'rediss://default:pass@cache.internal:6380/2',
        'redis://[::1]:6379',
      ];

      for (const url of urls) {
        const result = validate({
          ...validMinioConfig,
          REDIS_URL: url,
        });
        expect(result.REDIS_URL).toBe(url.trim());
      }
    });

    it('should reject invalid REDIS_URL values', () => {
      const invalidUrls = [
        'not-a-url',
        'http://localhost:6379',
        'https://localhost:6379',
        'redis://',
        'localhost:6379',
      ];

      for (const invalidUrl of invalidUrls) {
        expect(() =>
          validate({
            ...validMinioConfig,
            REDIS_URL: invalidUrl,
          }),
        ).toThrow(/Environment validation failed/);
      }
    });

    it('should normalize empty or whitespace REDIS_* variables to undefined', () => {
      const result = validate({
        ...validMinioConfig,
        REDIS_URL: '   ',
        REDIS_HOST: '',
        REDIS_PORT: '  ',
        REDIS_PASSWORD: '   ',
        REDIS_DB: '',
      });

      expect(result.REDIS_URL).toBeUndefined();
      expect(result.REDIS_HOST).toBeUndefined();
      expect(result.REDIS_PORT).toBeUndefined();
      expect(result.REDIS_PASSWORD).toBeUndefined();
      expect(result.REDIS_DB).toBeUndefined();
    });

    it('should validate and convert valid REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, and REDIS_DB', () => {
      const result = validate({
        ...validMinioConfig,
        REDIS_HOST: '  redis.internal  ',
        REDIS_PORT: ' 6380 ',
        REDIS_PASSWORD: '  my-pass  ',
        REDIS_DB: '0',
      });

      expect(result.REDIS_HOST).toBe('redis.internal');
      expect(result.REDIS_PORT).toBe(6380);
      expect(result.REDIS_PASSWORD).toBe('my-pass');
      expect(result.REDIS_DB).toBe(0);
    });

    it('should reject invalid REDIS_PORT and REDIS_DB values', () => {
      const invalidPorts = ['0', '65536', '-1', 'abc', '63.79'];
      for (const port of invalidPorts) {
        expect(() =>
          validate({
            ...validMinioConfig,
            REDIS_PORT: port,
          }),
        ).toThrow(/Environment validation failed/);
      }

      const invalidDbs = ['-1', 'abc', '1.5'];
      for (const db of invalidDbs) {
        expect(() =>
          validate({
            ...validMinioConfig,
            REDIS_DB: db,
          }),
        ).toThrow(/Environment validation failed/);
      }
    });
  });
});
