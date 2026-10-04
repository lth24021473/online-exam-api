import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AuthSecurityModule } from '../../auth/auth-security.module';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { QuestionsRepository } from './questions.repository';
import { ExamsModule } from '../exams.module';

@Module({
  imports: [PrismaModule, AuthSecurityModule, ExamsModule],
  controllers: [QuestionsController],
  providers: [QuestionsService, QuestionsRepository],
})
export class QuestionsModule {}
