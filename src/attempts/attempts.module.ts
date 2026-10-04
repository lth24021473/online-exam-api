import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuthSecurityModule } from '../auth/auth-security.module';
import { ExamsModule } from '../exams/exams.module';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './attempts.repository';

@Module({
  imports: [PrismaModule, AuthSecurityModule, ExamsModule],
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptsRepository],
})
export class AttemptsModule {}
