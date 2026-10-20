import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { AuthSecurityModule } from '../auth/auth-security.module';
import { ExamsModule } from '../exams/exams.module';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { ClassroomsRepository } from './classrooms.repository';

@Module({
  imports: [PrismaModule, AuthSecurityModule, ExamsModule],
  controllers: [ClassroomsController],
  providers: [ClassroomsService, ClassroomsRepository],
  exports: [ClassroomsService, ClassroomsRepository],
})
export class ClassroomsModule {}
