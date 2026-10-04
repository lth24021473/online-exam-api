import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../database/prisma.module';
import { AttemptsController } from './attempts.controller';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

@Module({
  // AuthModule must export JwtModule + TokenRevocationService (needed by JwtAuthGuard).
  imports: [PrismaModule, AuthModule],
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptsRepository],
})
export class AttemptsModule {}
