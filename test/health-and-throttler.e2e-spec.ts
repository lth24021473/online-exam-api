import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AttemptsService } from '../src/attempts/attempts.service';
import { AuthService } from '../src/auth/auth.service';
import { RedisService } from '../src/redis/redis.service';

const USER_A_ID = '111111111111111111111111';
const USER_B_ID = '222222222222222222222222';
const ATTEMPT_ID = '333333333333333333333333';
const QUESTION_ID = '444444444444444444444444';

describe('Health & Throttler (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let userAToken: string;
  let userBToken: string;
  let mongoPingSucceeds = true;
  let redisPingMode: 'pong' | 'non-pong' | 'error' = 'pong';

  const mockAttemptsService = {
    saveAnswer: jest.fn().mockResolvedValue({
      questionId: QUESTION_ID,
      selectedOptionIndex: 1,
    }),
  };

  const mockAuthService = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: USER_A_ID, email: 'student@example.com', role: Role.STUDENT },
    }),
  };

  beforeAll(() => {
    process.env.JWT_SECRET = 'health-throttler-secret';
    jwt = new JwtService({ secret: process.env.JWT_SECRET });
    userAToken = jwt.sign({
      sub: USER_A_ID,
      email: 'usera@example.com',
      role: Role.STUDENT,
      authVersion: 0,
    });
    userBToken = jwt.sign({
      sub: USER_B_ID,
      email: 'userb@example.com',
      role: Role.STUDENT,
      authVersion: 0,
    });
  });

  beforeEach(async () => {
    mongoPingSucceeds = true;
    redisPingMode = 'pong';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        revokedToken: { findUnique: jest.fn().mockResolvedValue(null) },
        user: {
          findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
            if (where.id === USER_A_ID) {
              return {
                id: USER_A_ID,
                email: 'usera@example.com',
                role: Role.STUDENT,
                authVersion: 0,
              };
            }
            if (where.id === USER_B_ID) {
              return {
                id: USER_B_ID,
                email: 'userb@example.com',
                role: Role.STUDENT,
                authVersion: 0,
              };
            }
            return null;
          }),
        },
        $runCommandRaw: jest.fn(async () => {
          if (!mongoPingSucceeds) {
            throw new Error('Mongo connection refused');
          }
          return { ok: 1 };
        }),
      })
      .overrideProvider(RedisService)
      .useValue({
        ping: jest.fn(async () => {
          if (redisPingMode === 'error') {
            throw new Error('Redis connection refused');
          }
          if (redisPingMode === 'non-pong') {
            return 'OK';
          }
          return 'PONG';
        }),
      })
      .overrideProvider(AttemptsService)
      .useValue(mockAttemptsService)
      .overrideProvider(AuthService)
      .useValue(mockAuthService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['health', 'health/(.*)', 'api/v1/health', 'api/v1/health/(.*)'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    jwt = app.get(JwtService);
    userAToken = jwt.sign({
      sub: USER_A_ID,
      email: 'usera@example.com',
      role: Role.STUDENT,
    });
    userBToken = jwt.sign({
      sub: USER_B_ID,
      email: 'userb@example.com',
      role: Role.STUDENT,
    });
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  describe('Health Checks', () => {
    it.each(['/health/live', '/api/v1/health/live'])(
      '%s returns 200 ok even when both MongoDB and Redis are down',
      async (route) => {
        mongoPingSucceeds = false;
        redisPingMode = 'error';

        const response = await request(app.getHttpServer())
          .get(route)
          .expect(200);

        expect(response.body.status).toBe('ok');
      },
    );

    it.each([
      '/health',
      '/api/v1/health',
      '/health/ready',
      '/api/v1/health/ready',
    ])('%s returns 200 when both MongoDB and Redis are healthy', async (route) => {
      const response = await request(app.getHttpServer())
        .get(route)
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.info?.database?.status).toBe('up');
      expect(response.body.info?.redis?.status).toBe('up');
    });

    it.each([
      '/health',
      '/api/v1/health',
      '/health/ready',
      '/api/v1/health/ready',
    ])('%s returns 503 when MongoDB ping fails', async (route) => {
      mongoPingSucceeds = false;

      const response = await request(app.getHttpServer())
        .get(route)
        .expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.error?.database?.status).toBe('down');
      expect(response.body.info?.redis?.status).toBe('up');
    });

    it.each([
      '/health',
      '/api/v1/health',
      '/health/ready',
      '/api/v1/health/ready',
    ])('%s returns 503 when Redis ping throws', async (route) => {
      redisPingMode = 'error';

      const response = await request(app.getHttpServer())
        .get(route)
        .expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.info?.database?.status).toBe('up');
      expect(response.body.error?.redis?.status).toBe('down');
    });

    it.each([
      '/health',
      '/api/v1/health',
      '/health/ready',
      '/api/v1/health/ready',
    ])(
      '%s returns 503 when Redis ping returns a non-PONG response',
      async (route) => {
        redisPingMode = 'non-pong';

        const response = await request(app.getHttpServer())
          .get(route)
          .expect(503);

        expect(response.body.status).toBe('error');
        expect(response.body.info?.database?.status).toBe('up');
        expect(response.body.error?.redis?.status).toBe('down');
      },
    );

    it('returns 503 on readiness/root and 200 on liveness when RedisService is unconfigured', async () => {
      const prevRedisUrl = process.env.REDIS_URL;
      const prevRedisHost = process.env.REDIS_HOST;
      delete process.env.REDIS_URL;
      delete process.env.REDIS_HOST;

      let unconfiguredApp: INestApplication<App> | undefined;
      try {
        const unconfiguredModule = await Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(PrismaService)
          .useValue({
            $runCommandRaw: jest.fn().mockResolvedValue({ ok: 1 }),
          })
          .compile();

        unconfiguredApp = unconfiguredModule.createNestApplication();
        unconfiguredApp.setGlobalPrefix('api/v1', {
          exclude: [
            'health',
            'health/(.*)',
            'api/v1/health',
            'api/v1/health/(.*)',
          ],
        });
        await unconfiguredApp.init();

        const readyResponse = await request(unconfiguredApp.getHttpServer())
          .get('/health/ready')
          .expect(503);
        expect(readyResponse.body.status).toBe('error');
        expect(readyResponse.body.info?.database?.status).toBe('up');
        expect(readyResponse.body.error?.redis?.status).toBe('down');

        await request(unconfiguredApp.getHttpServer())
          .get('/api/v1/health/ready')
          .expect(503);

        const liveResponse = await request(unconfiguredApp.getHttpServer())
          .get('/health/live')
          .expect(200);
        expect(liveResponse.body.status).toBe('ok');

        await request(unconfiguredApp.getHttpServer())
          .get('/api/v1/health/live')
          .expect(200);
      } finally {
        if (unconfiguredApp) {
          await unconfiguredApp.close();
        }
        if (prevRedisUrl !== undefined) {
          process.env.REDIS_URL = prevRedisUrl;
        }
        if (prevRedisHost !== undefined) {
          process.env.REDIS_HOST = prevRedisHost;
        }
      }
    });

    it('health endpoints are not throttled even with repeated requests', async () => {
      for (let i = 0; i < 15; i++) {
        await request(app.getHttpServer()).get('/health/live').expect(200);
      }
    });
  });

  describe('Rate Limiting (Throttler)', () => {
    it('throttles /auth/login after 5 requests per minute', async () => {
      const credentials = { email: 'student@example.com', password: 'Password123' };

      // Requests 1 to 5 should succeed (200)
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send(credentials)
          .expect(200);
      }

      // 6th request within the same minute should be rejected with 429
      const blocked = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(credentials)
        .expect(429);

      expect(blocked.body.message).toMatch(/Too Many Requests/i);
    });

    it('throttles /attempts/:id/answers/:id after 5 requests per second per user, without blocking other users', async () => {
      const payload = { selectedOptionIndex: 1 };

      // User A: requests 1 to 5 should succeed (200)
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .put(`/api/v1/attempts/${ATTEMPT_ID}/answers/${QUESTION_ID}`)
          .set('Authorization', `Bearer ${userAToken}`)
          .send(payload)
          .expect(200);
      }

      // User A: 6th request within the same second should be rejected with 429
      const blockedUserA = await request(app.getHttpServer())
        .put(`/api/v1/attempts/${ATTEMPT_ID}/answers/${QUESTION_ID}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send(payload)
        .expect(429);

      expect(blockedUserA.body.message).toMatch(/Too Many Requests/i);

      // User B: should NOT be blocked despite User A hitting the rate limit
      await request(app.getHttpServer())
        .put(`/api/v1/attempts/${ATTEMPT_ID}/answers/${QUESTION_ID}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send(payload)
        .expect(200);
    });
  });
});
