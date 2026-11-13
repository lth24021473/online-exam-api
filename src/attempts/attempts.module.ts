import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { AttemptSchedulerService } from './attempt-scheduler.service';
import { AttemptsController } from './attempts.controller';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

@Module({
  // AuthModule exports the guards and JWT dependencies through AuthSecurityModule.
  imports: [PrismaModule, AuthModule],
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptsRepository, AttemptSchedulerService],
  exports: [AttemptsService, AttemptSchedulerService],
})
export class AttemptsModule {}
