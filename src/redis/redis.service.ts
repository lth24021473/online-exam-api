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
  }
}
