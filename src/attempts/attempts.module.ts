import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { AttemptSchedulerService } from './attempt-scheduler.service';
import { AttemptExpiryWorker } from './attempt-expiry.worker';
import { AttemptsController } from './attempts.controller';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import {
  GRADING_STRATEGY,
  StandardGradingStrategy,
} from './grading';

@Module({
  // AuthModule exports the guards and JWT dependencies through AuthSecurityModule.
  imports: [PrismaModule, AuthModule, QueueModule],
  controllers: [AttemptsController],
  providers: [
    AttemptsService,
    AttemptsRepository,
    AttemptSchedulerService,
    AttemptExpiryWorker,
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
    StandardGradingStrategy,
    GRADING_STRATEGY,
  ],
})
export class AttemptsModule {}
