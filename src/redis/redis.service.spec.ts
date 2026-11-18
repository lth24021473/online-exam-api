import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

describe('RedisService (TV1-01 & TV2-04)', () => {
  let service: RedisService;
  let mockClient: jest.Mocked<Partial<Redis>>;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    mockClient = {
      status: 'wait',
      connect: jest.fn().mockResolvedValue(undefined as any),
      quit: jest.fn().mockResolvedValue('OK' as any),
      disconnect: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      hset: jest.fn(),
      hget: jest.fn(),
      hgetall: jest.fn(),
      hdel: jest.fn(),
      hlen: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      exists: jest.fn(),
      ping: jest.fn(),
      on: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_HOST') return '127.0.0.1';
        if (key === 'REDIS_PORT') return 6379;
        if (key === 'REDIS_PASSWORD') return 'secret';
        return defaultValue;
      }),
    };

    service = new RedisService(
      configService as unknown as ConfigService,
      mockClient as unknown as Redis,
    );
  });

  describe('Lifecycle & Initialization', () => {
    it('connects to Redis on module init if status is wait', async () => {
      await service.onModuleInit();
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('handles connection error on startup without throwing unhandled exception', async () => {
      mockClient.connect = jest
        .fn()
        .mockRejectedValue(new Error('Connection refused'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('quits cleanly on module destroy', async () => {
      mockClient.status = 'ready';
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalled();
    });

    it('exposes underlying client via getClient()', () => {
      expect(service.getClient()).toBe(mockClient);
    });
  });

  describe('Cache Operations (TV1-01 compatibility)', () => {
    it('delegates get to client.get', async () => {
      mockClient.get = jest.fn().mockResolvedValue('cached-val');
      const val = await service.get('test-key');
      expect(mockClient.get).toHaveBeenCalledWith('test-key');
      expect(val).toBe('cached-val');
    });

    it('delegates set without TTL', async () => {
      mockClient.set = jest.fn().mockResolvedValue('OK');
      const res = await service.set('key', 'val');
      expect(mockClient.set).toHaveBeenCalledWith('key', 'val');
      expect(res).toBe('OK');
    });

    it('delegates set with TTL in seconds (EX)', async () => {
      mockClient.set = jest.fn().mockResolvedValue('OK');
      await service.set('key', 'val', 60);
      expect(mockClient.set).toHaveBeenCalledWith('key', 'val', 'EX', 60);
    });

    it('delegates del for single key and key array', async () => {
      mockClient.del = jest.fn().mockResolvedValue(1);
      await service.del('key-1');
      expect(mockClient.del).toHaveBeenCalledWith('key-1');

      mockClient.del = jest.fn().mockResolvedValue(2);
      await service.del(['k1', 'k2']);
      expect(mockClient.del).toHaveBeenCalledWith('k1', 'k2');

      const emptyDel = await service.del([]);
      expect(emptyDel).toBe(0);
    });

    it('delegates setWithExpiryAt with EXAT unix timestamp', async () => {
      mockClient.set = jest.fn().mockResolvedValue('OK');
      const timestamp = Math.floor(Date.now() / 1000) + 3600;
      await service.setWithExpiryAt('revoked:token123', '1', timestamp);
      expect(mockClient.set).toHaveBeenCalledWith(
        'revoked:token123',
        '1',
        'EXAT',
        timestamp,
      );
    });
  });

  describe('Hash Operations (TV2-04 & TV2-05 Write-Behind Buffer)', () => {
    it('delegates hset with field and value', async () => {
      mockClient.hset = jest.fn().mockResolvedValue(1);
      const res = await service.hset('attempt:123:answers', 'q1', 'optA');
      expect(mockClient.hset).toHaveBeenCalledWith(
        'attempt:123:answers',
        'q1',
        'optA',
      );
      expect(res).toBe(1);
    });

    it('delegates hset with data object', async () => {
      mockClient.hset = jest.fn().mockResolvedValue(2);
      const data = { q1: 'optA', q2: 'optB' };
      const res = await service.hset('attempt:123:answers', data);
      expect(mockClient.hset).toHaveBeenCalledWith('attempt:123:answers', data);
      expect(res).toBe(2);
    });

    it('delegates hget to client.hget', async () => {
      mockClient.hget = jest.fn().mockResolvedValue('optA');
      const val = await service.hget('attempt:123:answers', 'q1');
      expect(mockClient.hget).toHaveBeenCalledWith('attempt:123:answers', 'q1');
      expect(val).toBe('optA');
    });

    it('delegates hgetall returning the answer mapping dictionary', async () => {
      const answers = { q1: 'optA', q2: 'optB' };
      mockClient.hgetall = jest.fn().mockResolvedValue(answers);
      const res = await service.hgetall('attempt:123:answers');
      expect(mockClient.hgetall).toHaveBeenCalledWith('attempt:123:answers');
      expect(res).toEqual(answers);
    });

    it('delegates hdel and hlen', async () => {
      mockClient.hdel = jest.fn().mockResolvedValue(1);
      mockClient.hlen = jest.fn().mockResolvedValue(3);

      await service.hdel('attempt:123:answers', 'q1', 'q2');
      expect(mockClient.hdel).toHaveBeenCalledWith(
        'attempt:123:answers',
        'q1',
        'q2',
      );

      const emptyHdel = await service.hdel('attempt:123:answers');
      expect(emptyHdel).toBe(0);

      const len = await service.hlen('attempt:123:answers');
      expect(len).toBe(3);
    });
  });

  describe('Key Expiration & Health Diagnostics (TV3-05)', () => {
    it('delegates expire, ttl, exists, and ping', async () => {
      mockClient.expire = jest.fn().mockResolvedValue(1);
      mockClient.ttl = jest.fn().mockResolvedValue(3600);
      mockClient.exists = jest.fn().mockResolvedValue(1);
      mockClient.ping = jest.fn().mockResolvedValue('PONG');

      await service.expire('key', 3600);
      expect(mockClient.expire).toHaveBeenCalledWith('key', 3600);

      const ttl = await service.ttl('key');
      expect(ttl).toBe(3600);

      const exists = await service.exists('key');
      expect(exists).toBe(1);

      const ping = await service.ping();
      expect(ping).toBe('PONG');
    });
  });
});
