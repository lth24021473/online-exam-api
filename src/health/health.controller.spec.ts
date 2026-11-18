import {
  HttpStatus,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../database/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let prismaService: { $runCommandRaw: jest.Mock };
  let redisService: { ping: jest.Mock };
  let moduleRef: TestingModule;

  beforeEach(async () => {
    prismaService = {
      $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }),
    };
    redisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    moduleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
      ],
    }).compile();

    controller = moduleRef.get<HealthController>(HealthController);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await moduleRef.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe.each([{ method: 'check' as const }, { method: 'ready' as const }])(
    '$method',
    ({ method }) => {
      it('returns ok with both database and redis indicators up when both succeed', async () => {
        const result = await controller[method]();

        expect(prismaService.$runCommandRaw).toHaveBeenCalledWith({ ping: 1 });
        expect(redisService.ping).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
          status: 'ok',
          info: {
            database: { status: 'up', responseTime: expect.any(Number) },
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
          error: {},
          details: {
            database: { status: 'up', responseTime: expect.any(Number) },
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
        });
      });

      it('runs MongoDB and Redis checks in parallel', async () => {
        let resolveDb!: (value: { ok: number }) => void;
        prismaService.$runCommandRaw.mockImplementationOnce(
          () =>
            new Promise<{ ok: number }>((resolve) => {
              resolveDb = resolve;
            }),
        );

        const probePromise = controller[method]();

        // Wait a microtask tick for HealthCheckExecutor to invoke all indicator callbacks
        await Promise.resolve();
        expect(prismaService.$runCommandRaw).toHaveBeenCalledTimes(1);
        expect(redisService.ping).toHaveBeenCalledTimes(1);

        resolveDb({ ok: 1 });
        const result = await probePromise;
        expect(result.status).toBe('ok');
      });

      it('throws ServiceUnavailableException (503) when MongoDB is down and Redis is up', async () => {
        prismaService.$runCommandRaw.mockRejectedValueOnce(
          new Error('Mongo connection refused'),
        );

        let caughtError: unknown;
        try {
          await controller[method]();
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
        const exception = caughtError as ServiceUnavailableException;
        expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const response = exception.getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({
          status: 'error',
          info: {
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
          error: {
            database: {
              status: 'down',
              message: 'Mongo connection refused',
              responseTime: expect.any(Number),
            },
          },
          details: {
            database: {
              status: 'down',
              message: 'Mongo connection refused',
              responseTime: expect.any(Number),
            },
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
        });
      });

      it('throws ServiceUnavailableException (503) when MongoDB Replica Set disconnection is simulated', async () => {
        const replicaSetErrorMessage =
          'ReplicaSetNoPrimary: Server selection timed out after 30000 ms';
        prismaService.$runCommandRaw.mockRejectedValueOnce(
          new Error(replicaSetErrorMessage),
        );

        let caughtError: unknown;
        try {
          await controller[method]();
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
        const exception = caughtError as ServiceUnavailableException;
        expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const response = exception.getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({
          status: 'error',
          info: {
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
          error: {
            database: {
              status: 'down',
              message: replicaSetErrorMessage,
              responseTime: expect.any(Number),
            },
          },
          details: {
            database: {
              status: 'down',
              message: replicaSetErrorMessage,
              responseTime: expect.any(Number),
            },
            redis: { status: 'up', responseTime: expect.any(Number) },
          },
        });
      });

      it('throws ServiceUnavailableException (503) when Redis ping rejects', async () => {
        redisService.ping.mockRejectedValueOnce(
          new Error('Redis ECONNREFUSED'),
        );

        let caughtError: unknown;
        try {
          await controller[method]();
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
        const exception = caughtError as ServiceUnavailableException;
        expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        const response = exception.getResponse() as Record<string, unknown>;
        expect(response).toMatchObject({
          status: 'error',
          info: {
            database: { status: 'up', responseTime: expect.any(Number) },
          },
          error: {
            redis: {
              status: 'down',
              message: 'Redis ECONNREFUSED',
              responseTime: expect.any(Number),
            },
          },
          details: {
            database: { status: 'up', responseTime: expect.any(Number) },
            redis: {
              status: 'down',
              message: 'Redis ECONNREFUSED',
              responseTime: expect.any(Number),
            },
          },
        });
      });

      it('throws ServiceUnavailableException (503) when Redis ping returns anything other than PONG', async () => {
        for (const badReply of ['OK', '', null, undefined]) {
          redisService.ping.mockResolvedValueOnce(badReply);

          let caughtError: unknown;
          try {
            await controller[method]();
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
          const exception = caughtError as ServiceUnavailableException;
          expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
          const expectedMessage = `Unexpected Redis ping response: ${String(badReply)}`;
          const response = exception.getResponse() as Record<string, unknown>;
          expect(response).toMatchObject({
            status: 'error',
            info: {
              database: { status: 'up', responseTime: expect.any(Number) },
            },
            error: {
              redis: {
                status: 'down',
                message: expectedMessage,
                responseTime: expect.any(Number),
              },
            },
            details: {
              database: { status: 'up', responseTime: expect.any(Number) },
              redis: {
                status: 'down',
                message: expectedMessage,
                responseTime: expect.any(Number),
              },
            },
          });
        }
      });

      it('throws ServiceUnavailableException (503) when Redis is unconfigured', async () => {
        const unconfiguredModule = await Test.createTestingModule({
          imports: [
            TerminusModule,
            ConfigModule.forRoot({
              isGlobal: true,
              ignoreEnvFile: true,
              ignoreEnvVars: true,
              skipProcessEnv: true,
              load: [() => ({})],
            }),
            RedisModule,
          ],
          controllers: [HealthController],
          providers: [
            {
              provide: PrismaService,
              useValue: prismaService,
            },
          ],
        }).compile();

        try {
          const unconfiguredController =
            unconfiguredModule.get<HealthController>(HealthController);

          let caughtError: unknown;
          try {
            await unconfiguredController[method]();
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(ServiceUnavailableException);
          const exception = caughtError as ServiceUnavailableException;
          expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
          const response = exception.getResponse() as Record<string, unknown>;
          expect(response).toMatchObject({
            status: 'error',
            info: {
              database: { status: 'up', responseTime: expect.any(Number) },
            },
            error: {
              redis: {
                status: 'down',
                message: 'Redis is not configured',
                responseTime: expect.any(Number),
              },
            },
            details: {
              database: { status: 'up', responseTime: expect.any(Number) },
              redis: {
                status: 'down',
                message: 'Redis is not configured',
                responseTime: expect.any(Number),
              },
            },
          });
        } finally {
          await unconfiguredModule.close();
        }
      });
    },
  );

  describe('live', () => {
    it('returns 200 ok without checking MongoDB or Redis even when both fail', async () => {
      prismaService.$runCommandRaw.mockRejectedValue(
        new Error('Mongo connection refused'),
      );
      redisService.ping.mockRejectedValue(
        new Error('Redis connection refused'),
      );

      const result = await controller.live();

      expect(prismaService.$runCommandRaw).not.toHaveBeenCalled();
      expect(redisService.ping).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
    });
  });
});

describe('HealthController HTTP endpoints', () => {
  let app: INestApplication<App>;
  let httpModuleRef: TestingModule;
  let prismaService: { $runCommandRaw: jest.Mock };
  let redisService: { ping: jest.Mock };

  beforeAll(async () => {
    prismaService = {
      $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }),
    };
    redisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };

    httpModuleRef = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
      ],
    }).compile();

    app = httpModuleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health', 'health/(.*)', 'api/v1/health', 'api/v1/health/(.*)'],
    });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaService.$runCommandRaw.mockResolvedValue({ ok: 1 });
    redisService.ping.mockResolvedValue('PONG');
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    '/health',
    '/api/v1/health',
    '/health/ready',
    '/api/v1/health/ready',
  ])(
    'GET %s returns HTTP 200 OK with detailed status info for MongoDB and Redis',
    async (route) => {
      const response = await request(app.getHttpServer())
        .get(route)
        .expect(HttpStatus.OK);

      expect(prismaService.$runCommandRaw).toHaveBeenCalledWith({ ping: 1 });
      expect(redisService.ping).toHaveBeenCalledTimes(1);
      expect(response.body).toEqual({
        status: 'ok',
        info: {
          database: { status: 'up', responseTime: expect.any(Number) },
          redis: { status: 'up', responseTime: expect.any(Number) },
        },
        error: {},
        details: {
          database: { status: 'up', responseTime: expect.any(Number) },
          redis: { status: 'up', responseTime: expect.any(Number) },
        },
      });
    },
  );

  it.each(['/health/live', '/api/v1/health/live'])(
    'GET %s returns HTTP 200 OK even when MongoDB and Redis fail',
    async (route) => {
      prismaService.$runCommandRaw.mockRejectedValue(
        new Error('Mongo connection refused'),
      );
      redisService.ping.mockRejectedValue(new Error('Redis ECONNREFUSED'));

      const response = await request(app.getHttpServer())
        .get(route)
        .expect(HttpStatus.OK);

      expect(prismaService.$runCommandRaw).not.toHaveBeenCalled();
      expect(redisService.ping).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
    },
  );

  it.each(['/health/ready', '/api/v1/health/ready'])(
    'GET %s returns HTTP 503 with Redis error message when Redis disconnection is simulated',
    async (route) => {
      const redisErrorMessage = 'Redis connection closed (ECONNREFUSED)';
      redisService.ping.mockRejectedValueOnce(new Error(redisErrorMessage));

      const response = await request(app.getHttpServer())
        .get(route)
        .expect(HttpStatus.SERVICE_UNAVAILABLE);

      expect(response.body).toEqual({
        status: 'error',
        info: {
          database: { status: 'up', responseTime: expect.any(Number) },
        },
        error: {
          redis: {
            status: 'down',
            message: redisErrorMessage,
            responseTime: expect.any(Number),
          },
        },
        details: {
          database: { status: 'up', responseTime: expect.any(Number) },
          redis: {
            status: 'down',
            message: redisErrorMessage,
            responseTime: expect.any(Number),
          },
        },
      });
    },
  );

  it.each(['/health/ready', '/api/v1/health/ready'])(
    'GET %s returns HTTP 503 when MongoDB Replica Set disconnection is simulated',
    async (route) => {
      const replicaSetErrorMessage =
        'ReplicaSetNoPrimary: No primary replica set member available';
      prismaService.$runCommandRaw.mockRejectedValueOnce(
        new Error(replicaSetErrorMessage),
      );

      const response = await request(app.getHttpServer())
        .get(route)
        .expect(HttpStatus.SERVICE_UNAVAILABLE);

      expect(response.body).toEqual({
        status: 'error',
        info: {
          redis: { status: 'up', responseTime: expect.any(Number) },
        },
        error: {
          database: {
            status: 'down',
            message: replicaSetErrorMessage,
            responseTime: expect.any(Number),
          },
        },
        details: {
          database: {
            status: 'down',
            message: replicaSetErrorMessage,
            responseTime: expect.any(Number),
          },
          redis: { status: 'up', responseTime: expect.any(Number) },
        },
      });
    },
  );
});
