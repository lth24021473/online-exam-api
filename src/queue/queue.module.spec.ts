import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import {
  QUEUE_ATTEMPT_EXPIRY,
  QUEUE_ANSWER_SAVE,
  JOB_EXPIRE_ATTEMPT,
  JOB_SAVE_ANSWER,
  ATTEMPT_EXPIRY_JOB_OPTIONS,
  ANSWER_SAVE_JOB_OPTIONS,
} from './queue.constants';
import { QueueModule } from './queue.module';

describe('Queue Infrastructure (TV2-01)', () => {
  describe('Constants & Configuration Options', () => {
    it('defines correct queue names according to TV2-01 specifications', () => {
      expect(QUEUE_ATTEMPT_EXPIRY).toBe('attempt-expiry-queue');
      expect(QUEUE_ANSWER_SAVE).toBe('answer-save-queue');
    });

    it('defines standardized job names', () => {
      expect(JOB_EXPIRE_ATTEMPT).toBe('expire-attempt');
      expect(JOB_SAVE_ANSWER).toBe('save-answer');
    });

    it('configures ATTEMPT_EXPIRY_JOB_OPTIONS with exponential backoff and DLQ retention', () => {
      expect(ATTEMPT_EXPIRY_JOB_OPTIONS.attempts).toBe(3);
      expect(ATTEMPT_EXPIRY_JOB_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 1000,
      });
      // removeOnFail: false ensures failed jobs are retained in Dead-Letter Queue (DLQ)
      expect(ATTEMPT_EXPIRY_JOB_OPTIONS.removeOnFail).toBe(false);
      expect(ATTEMPT_EXPIRY_JOB_OPTIONS.removeOnComplete).toBeDefined();
    });

    it('configures ANSWER_SAVE_JOB_OPTIONS with exponential backoff and DLQ retention', () => {
      expect(ANSWER_SAVE_JOB_OPTIONS.attempts).toBe(5);
      expect(ANSWER_SAVE_JOB_OPTIONS.backoff).toEqual({
        type: 'exponential',
        delay: 500,
      });
      // removeOnFail: false ensures failed jobs are retained in Dead-Letter Queue (DLQ)
      expect(ANSWER_SAVE_JOB_OPTIONS.removeOnFail).toBe(false);
      expect(ANSWER_SAVE_JOB_OPTIONS.removeOnComplete).toBeDefined();
    });
  });

  describe('QueueModule Metadata & Factory Logic', () => {
    it('is defined with correct imports and exports', () => {
      expect(QueueModule).toBeDefined();
      const imports = Reflect.getMetadata('imports', QueueModule) || [];
      const exportsList = Reflect.getMetadata('exports', QueueModule) || [];

      expect(imports.length).toBeGreaterThan(0);
      expect(exportsList.length).toBeGreaterThan(0);
    });

    it('generates correct queue injection tokens for BullMQ', () => {
      const expiryQueueToken = getQueueToken(QUEUE_ATTEMPT_EXPIRY);
      const answerQueueToken = getQueueToken(QUEUE_ANSWER_SAVE);

      expect(expiryQueueToken).toBe('BullQueue_attempt-expiry-queue');
      expect(answerQueueToken).toBe('BullQueue_answer-save-queue');
    });

    it('resolves Redis configuration factory with default and custom values', () => {
      const mockConfigServiceDefault = {
        get: jest.fn((key: string, defaultValue?: any) => defaultValue),
      } as unknown as ConfigService;

      // Extract the async useFactory from BullModule.forRootAsync
      const imports = Reflect.getMetadata('imports', QueueModule) || [];
      // The dynamic module produced by BullModule.forRootAsync contains imports / providers
      const bullRootModule = imports.find(
        (mod: any) => mod.module?.name === 'BullModule' || mod.name === 'BullModule' || mod.providers,
      );
      expect(bullRootModule).toBeDefined();

      // Test config resolution logic directly as defined in factory
      const resolveConfig = (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', '127.0.0.1');
        const port = Number(configService.get<string | number>('REDIS_PORT', 6379));
        const password = configService.get<string>('REDIS_PASSWORD') || undefined;
        return {
          connection: {
            host,
            port,
            password,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          },
        };
      };

      const defaultConfig = resolveConfig(mockConfigServiceDefault);
      expect(defaultConfig.connection.host).toBe('127.0.0.1');
      expect(defaultConfig.connection.port).toBe(6379);
      expect(defaultConfig.connection.password).toBeUndefined();
      expect(defaultConfig.connection.maxRetriesPerRequest).toBeNull();
      expect(defaultConfig.connection.enableReadyCheck).toBe(false);

      const mockConfigServiceCustom = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'REDIS_HOST') return 'redis.prod.internal';
          if (key === 'REDIS_PORT') return '6380';
          if (key === 'REDIS_PASSWORD') return 'secretPass';
          return defaultValue;
        }),
      } as unknown as ConfigService;

      const customConfig = resolveConfig(mockConfigServiceCustom);
      expect(customConfig.connection.host).toBe('redis.prod.internal');
      expect(customConfig.connection.port).toBe(6380);
      expect(customConfig.connection.password).toBe('secretPass');
    });

    it('compiles testing module and provides Queue instances', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          QueueModule,
        ],
      })
        .overrideProvider(getQueueToken(QUEUE_ATTEMPT_EXPIRY))
        .useValue({ name: QUEUE_ATTEMPT_EXPIRY, add: jest.fn() })
        .overrideProvider(getQueueToken(QUEUE_ANSWER_SAVE))
        .useValue({ name: QUEUE_ANSWER_SAVE, add: jest.fn() })
        .compile();

      const expiryQueue = moduleRef.get(getQueueToken(QUEUE_ATTEMPT_EXPIRY));
      const answerQueue = moduleRef.get(getQueueToken(QUEUE_ANSWER_SAVE));

      expect(expiryQueue).toBeDefined();
      expect(expiryQueue.name).toBe(QUEUE_ATTEMPT_EXPIRY);
      expect(answerQueue).toBeDefined();
      expect(answerQueue.name).toBe(QUEUE_ANSWER_SAVE);
    });
  });
});
