import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuthSecurityModule } from '../auth/auth-security.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { ExamsRepository } from './exams.repository';
import { ExamLeaderboardService } from './materialized-views/exam-leaderboard.service';

@Module({
  imports: [PrismaModule, AuthSecurityModule],
  controllers: [ExamsController],
  providers: [ExamsService, ExamsRepository, ExamLeaderboardService],
  exports: [ExamsService, ExamsRepository, ExamLeaderboardService],
})
export class ExamsModule {}
