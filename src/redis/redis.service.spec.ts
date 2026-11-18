import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { RedisModule } from './redis.module';
import { RedisService } from './redis.service';

interface MockRedisInstance extends EventEmitter {
  status: string;
  connect: jest.Mock<Promise<void>, []>;
  ping: jest.Mock<Promise<string>, []>;
  quit: jest.Mock<Promise<string>, []>;
  disconnect: jest.Mock<void, []>;
}

const mockRedisConstructor = jest.fn();
let nextMockClientFactory: (() => MockRedisInstance) | null = null;

function createMockRedisClient(
  overrides: Partial<Pick<MockRedisInstance, 'status'>> = {},
): MockRedisInstance {
  const emitter = new EventEmitter() as MockRedisInstance;
  emitter.status = overrides.status ?? 'wait';
  emitter.connect = jest.fn(async () => {
    emitter.status = 'ready';
  });
  emitter.ping = jest.fn(async () => 'PONG');
  emitter.quit = jest.fn(async () => {
    emitter.status = 'end';
    return 'OK';
  });
  emitter.disconnect = jest.fn(() => {
    emitter.status = 'end';
  });
  return emitter;
}

jest.mock('ioredis', () => {
  const MockRedis = jest.fn((...args: unknown[]) => {
    mockRedisConstructor(...args);
    return nextMockClientFactory
      ? nextMockClientFactory()
      : createMockRedisClient();
  });

  return {
    __esModule: true,
    default: MockRedis,
    Redis: MockRedis,
  };
});

describe('RedisService', () => {
  const createConfigService = (
    values: Record<string, unknown>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  beforeEach(() => {
    mockRedisConstructor.mockClear();
    nextMockClientFactory = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('RedisModule DI compilation', () => {
    it('compiles cleanly and provides RedisService when Redis is unconfigured', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [() => ({})],
          }),
          RedisModule,
        ],
      }).compile();

      const service = moduleRef.get(RedisService);
      expect(service).toBeInstanceOf(RedisService);
      expect(service.isConfigured()).toBe(false);
      expect(mockRedisConstructor).not.toHaveBeenCalled();

      await moduleRef.close();
    });
  });

  describe('unconfigured Redis', () => {
    it('keeps client null without defaulting to localhost when neither REDIS_URL nor REDIS_HOST is set', async () => {
      const service = new RedisService(createConfigService({}));

      expect(service.isConfigured()).toBe(false);
      expect(service.getClient()).toBeNull();
      expect(mockRedisConstructor).not.toHaveBeenCalled();
      await expect(service.ping()).rejects.toThrow('Redis is not configured');
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('treats whitespace-only REDIS_URL and REDIS_HOST as unconfigured', async () => {
      const service = new RedisService(
        createConfigService({
          REDIS_URL: '   ',
          REDIS_HOST: '  ',
        }),
      );

      expect(service.isConfigured()).toBe(false);
      expect(mockRedisConstructor).not.toHaveBeenCalled();
      await expect(service.ping()).rejects.toThrow('Redis is not configured');
    });
  });

  describe('initialization options and error handling', () => {
    it('initializes ioredis with REDIS_URL and lazy non-blocking options', () => {
      const client = createMockRedisClient();
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({
          REDIS_URL: '  redis://:secret@redis.internal:6379/1  ',
        }),
      );

      expect(service.isConfigured()).toBe(true);
      expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
      const [urlArg, optionsArg] = mockRedisConstructor.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(urlArg).toBe('redis://:secret@redis.internal:6379/1');
      expect(optionsArg).toMatchObject({
        lazyConnect: true,
        connectTimeout: 1000,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
      });
      expect(typeof optionsArg.retryStrategy).toBe('function');
      expect((optionsArg.retryStrategy as () => null)()).toBeNull();
      expect(client.connect).not.toHaveBeenCalled();
      expect(client.ping).not.toHaveBeenCalled();
      expect(client.listenerCount('error')).toBeGreaterThanOrEqual(1);
    });

    it('initializes ioredis with REDIS_HOST and defaults port to 6379 when REDIS_PORT is omitted', () => {
      const client = createMockRedisClient();
      nextMockClientFactory = () => client;

      new RedisService(
        createConfigService({
          REDIS_HOST: '  cache.local  ',
        }),
      );

      expect(mockRedisConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'cache.local',
          port: 6379,
          lazyConnect: true,
          connectTimeout: 1000,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
        }),
      );
    });

    it('passes explicit REDIS_PORT, REDIS_PASSWORD, and REDIS_DB when configured with REDIS_HOST', () => {
      const client = createMockRedisClient();
      nextMockClientFactory = () => client;

      new RedisService(
        createConfigService({
          REDIS_HOST: 'cache.local',
          REDIS_PORT: '6380',
          REDIS_PASSWORD: '  pw  ',
          REDIS_DB: 2,
        }),
      );

      expect(mockRedisConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'cache.local',
          port: 6380,
          password: 'pw',
          db: 2,
        }),
      );
    });

    it('attaches an error listener so Redis error events log a warning instead of crashing', () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const client = createMockRedisClient();
      nextMockClientFactory = () => client;

      new RedisService(
        createConfigService({
          REDIS_HOST: 'localhost',
        }),
      );

      expect(() =>
        client.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:6379')),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('connect ECONNREFUSED'),
      );
    });
  });

  describe('ping', () => {
    it('connects first when client status is wait (lazyConnect + enableOfflineQueue=false) and returns PONG', async () => {
      const client = createMockRedisClient({ status: 'wait' });
      const callOrder: string[] = [];
      client.connect.mockImplementation(async () => {
        callOrder.push('connect');
        client.status = 'ready';
      });
      client.ping.mockImplementation(async () => {
        callOrder.push('ping');
        return 'PONG';
      });
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const response = await service.ping();

      expect(response).toBe('PONG');
      expect(callOrder).toEqual(['connect', 'ping']);
    });

    it('calls ping directly without reconnecting when client status is already ready', async () => {
      const client = createMockRedisClient({ status: 'ready' });
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const response = await service.ping();

      expect(response).toBe('PONG');
      expect(client.connect).not.toHaveBeenCalled();
      expect(client.ping).toHaveBeenCalledTimes(1);
    });

    it('reconnects when client status is end after a prior failed connection', async () => {
      const client = createMockRedisClient({ status: 'end' });
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const response = await service.ping();

      expect(response).toBe('PONG');
      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.ping).toHaveBeenCalledTimes(1);
    });

    it('shares a single in-flight connect() promise across concurrent ping() calls', async () => {
      const client = createMockRedisClient({ status: 'wait' });
      let resolveConnect!: () => void;
      client.connect.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = () => {
              client.status = 'ready';
              resolve();
            };
          }),
      );
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const p1 = service.ping();
      const p2 = service.ping();

      expect(client.connect).toHaveBeenCalledTimes(1);
      resolveConnect();

      await expect(Promise.all([p1, p2])).resolves.toEqual(['PONG', 'PONG']);
      expect(client.ping).toHaveBeenCalledTimes(2);
    });

    it('rejects when client.connect() or client.ping() fails', async () => {
      const client = createMockRedisClient({ status: 'wait' });
      client.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      await expect(service.ping()).rejects.toThrow('ECONNREFUSED');

      client.status = 'ready';
      client.ping.mockRejectedValueOnce(new Error('Connection closed'));
      await expect(service.ping()).rejects.toThrow('Connection closed');
    });

    it('rejects with timeout error when ping hangs beyond timeoutMs', async () => {
      jest.useFakeTimers();
      const client = createMockRedisClient({ status: 'ready' });
      client.ping.mockImplementation(
        () => new Promise<string>(() => undefined),
      );
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const pingPromise = service.ping(250);
      const assertion = expect(pingPromise).rejects.toThrow(
        'Redis ping timed out after 250ms',
      );
      await jest.advanceTimersByTimeAsync(250);
      await assertion;
    });
  });

  describe('onModuleDestroy', () => {
    it('calls disconnect() without calling quit() when status is wait or end', async () => {
      const waitClient = createMockRedisClient({ status: 'wait' });
      nextMockClientFactory = () => waitClient;
      const waitService = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      await waitService.onModuleDestroy();
      expect(waitClient.disconnect).toHaveBeenCalledTimes(1);
      expect(waitClient.quit).not.toHaveBeenCalled();

      const endClient = createMockRedisClient({ status: 'end' });
      nextMockClientFactory = () => endClient;
      const endService = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      await endService.onModuleDestroy();
      expect(endClient.disconnect).toHaveBeenCalledTimes(1);
      expect(endClient.quit).not.toHaveBeenCalled();
    });

    it('calls quit() when client is active', async () => {
      const client = createMockRedisClient({ status: 'ready' });
      nextMockClientFactory = () => client;
      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      await service.onModuleDestroy();
      expect(client.quit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('falls back to disconnect() if quit() times out', async () => {
      jest.useFakeTimers();
      const client = createMockRedisClient({ status: 'ready' });
      client.quit.mockImplementation(() => new Promise<string>(() => undefined));
      nextMockClientFactory = () => client;

      const service = new RedisService(
        createConfigService({ REDIS_HOST: 'localhost' }),
      );

      const destroyPromise = service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1000);
      await destroyPromise;

      expect(client.quit).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
