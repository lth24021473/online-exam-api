import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_PING_TIMEOUT_MS = 1500;
const DEFAULT_QUIT_TIMEOUT_MS = 1000;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.readOptionalString('REDIS_URL');
    const redisHost = this.readOptionalString('REDIS_HOST');
    const redisPort = this.readOptionalInt('REDIS_PORT');
    const redisPassword = this.readOptionalString('REDIS_PASSWORD');
    const redisDb = this.readOptionalInt('REDIS_DB');

    if (!redisUrl && !redisHost) {
      this.client = null;
      this.logger.warn(
        'Redis is not configured (neither REDIS_URL nor REDIS_HOST is set); Redis health probes will report down',
      );
      return;
    }

    const commonOptions: RedisOptions = {
      lazyConnect: true,
      connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };

    if (redisUrl) {
      const options: RedisOptions = {
        ...commonOptions,
        ...(redisPassword !== undefined ? { password: redisPassword } : {}),
        ...(redisDb !== undefined ? { db: redisDb } : {}),
      };
      this.client = new Redis(redisUrl, options);
    } else {
      const options: RedisOptions = {
        ...commonOptions,
        host: redisHost,
        port: redisPort ?? 6379,
        ...(redisPassword !== undefined ? { password: redisPassword } : {}),
        ...(redisDb !== undefined ? { db: redisDb } : {}),
      };
      this.client = new Redis(options);
    }

    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis client error: ${error.message}`);
    });
  }

  private readOptionalString(key: string): string | undefined {
    const value = this.configService.get<unknown>(key);
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  private readOptionalInt(key: string): number | undefined {
    const value = this.configService.get<unknown>(key);
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^-?\d+$/.test(trimmed)) {
        return Number(trimmed);
      }
    }
    return undefined;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): Redis | null {
    return this.client;
  }

  private async ensureConnected(client: Redis): Promise<void> {
    if (client.status === 'ready') {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    if (
      client.status === 'wait' ||
      client.status === 'end' ||
      client.status === 'close' ||
      client.status === 'reconnecting'
    ) {
      this.connectPromise = client.connect().finally(() => {
        this.connectPromise = null;
      });
      await this.connectPromise;
    }
  }

  async ping(timeoutMs = DEFAULT_PING_TIMEOUT_MS): Promise<string> {
    if (!this.client) {
      throw new Error('Redis is not configured');
    }

    const client = this.client;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pingPromise = (async () => {
      await this.ensureConnected(client);
      return client.ping();
    })();
    void pingPromise.catch(() => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Redis ping timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([pingPromise, timeoutPromise]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    if (client.status === 'wait' || client.status === 'end') {
      client.disconnect();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const quitPromise = client.quit().then(() => undefined);
      void quitPromise.catch(() => undefined);

      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          client.disconnect();
          resolve();
        }, DEFAULT_QUIT_TIMEOUT_MS);
        timer.unref?.();
      });

      await Promise.race([quitPromise, timeoutPromise]);
    } catch {
      client.disconnect();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(
    private readonly configService: ConfigService,
    @Optional() customClient?: Redis,
  ) {
    if (customClient) {
      this.client = customClient;
    } else {
      const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
      const port = Number(
        this.configService.get<string | number>('REDIS_PORT', 6379),
      );
      const password =
        this.configService.get<string>('REDIS_PASSWORD') || undefined;

      const options: RedisOptions = {
        host,
        port,
        password,
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      };

      this.client = new Redis(options);
    }

    this.client.on('error', (err) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
        this.logger.log('Redis client connected successfully');
      }
    } catch (err: any) {
      this.logger.warn(
        `Redis connection could not be established on startup: ${err.message}. Operations will retry on demand.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client.status !== 'end') {
        await this.client.quit();
      }
    } catch {
      this.client.disconnect();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  // ----------------------------------------------------
  // Basic Cache Operations (TV1-01 compatibility)
  // ----------------------------------------------------

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    if (ttlSeconds && ttlSeconds > 0) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }
    return this.client.set(key, value);
  }

  async del(key: string | string[]): Promise<number> {
    if (Array.isArray(key)) {
      if (key.length === 0) return 0;
      return this.client.del(...key);
    }
    return this.client.del(key);
  }

  async setWithExpiryAt(
    key: string,
    value: string,
    timestampSeconds: number,
  ): Promise<'OK' | null> {
    return this.client.set(key, value, 'EXAT', timestampSeconds);
  }

  // ----------------------------------------------------
  // Hash Operations (TV2-04 & TV2-05 Write-Behind Buffer)
  // ----------------------------------------------------

  async hset(
    key: string,
    fieldOrData: string | Record<string, string>,
    value?: string,
  ): Promise<number> {
    if (typeof fieldOrData === 'string') {
      return this.client.hset(key, fieldOrData, value ?? '');
    }
    return this.client.hset(key, fieldOrData);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    if (fields.length === 0) return 0;
    return this.client.hdel(key, ...fields);
  }

  async hlen(key: string): Promise<number> {
    return this.client.hlen(key);
  }

  // ----------------------------------------------------
  // Key Expiration & Diagnostics (TV3-05 compatibility)
  // ----------------------------------------------------

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
