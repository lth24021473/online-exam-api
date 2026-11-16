import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  QUEUE_ATTEMPT_EXPIRY,
  QUEUE_ANSWER_SAVE,
  ATTEMPT_EXPIRY_JOB_OPTIONS,
  ANSWER_SAVE_JOB_OPTIONS,
} from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
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
      },
    }),
    BullModule.registerQueue(
      {
        name: QUEUE_ATTEMPT_EXPIRY,
        defaultJobOptions: ATTEMPT_EXPIRY_JOB_OPTIONS,
      },
      {
        name: QUEUE_ANSWER_SAVE,
        defaultJobOptions: ANSWER_SAVE_JOB_OPTIONS,
      },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
