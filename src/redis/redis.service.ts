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
