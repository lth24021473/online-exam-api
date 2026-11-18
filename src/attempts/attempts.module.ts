import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { ExamsModule } from '../exams/exams.module';
import { QueueModule } from '../queue/queue.module';
import { RedisModule } from '../redis/redis.module';
import { AttemptSchedulerService } from './attempt-scheduler.service';
import { AttemptExpiryWorker } from './attempt-expiry.worker';
import { AttemptExpirySupervisor } from './attempt-expiry.supervisor';
import { AnswerSaveWorker } from './answer-save.worker';
import { AttemptsController } from './attempts.controller';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import {
  GRADING_STRATEGY,
  StandardGradingStrategy,
} from './grading';

@Module({
  // AuthModule exports the guards and JWT dependencies through AuthSecurityModule.
  imports: [PrismaModule, AuthModule, ExamsModule],
  imports: [PrismaModule, AuthModule, QueueModule, RedisModule],
  controllers: [AttemptsController],
  providers: [
    AttemptsService,
    AttemptsRepository,
    AttemptSchedulerService,
    AttemptExpiryWorker,
    AttemptExpirySupervisor,
    AnswerSaveWorker,
    StandardGradingStrategy,
    {
      provide: GRADING_STRATEGY,
      useClass: StandardGradingStrategy,
    },
  ],
  exports: [
    AttemptsService,
    AttemptSchedulerService,
    AttemptExpiryWorker,
    AttemptExpirySupervisor,
    AnswerSaveWorker,
    StandardGradingStrategy,
    GRADING_STRATEGY,
  ],
})
export class AttemptsModule {}
