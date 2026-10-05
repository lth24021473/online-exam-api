import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuthSecurityModule } from '../auth/auth-security.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ExamsRepository } from './exams.repository';
import { AttemptsModule } from '../attempts/attempts.module';

@Module({
  imports: [PrismaModule, AuthSecurityModule, AttemptsModule],
  controllers: [ExamsController],
  providers: [ExamsService, ExamsRepository],
  exports: [ExamsService, ExamsRepository],
})
export class ExamsModule {}
