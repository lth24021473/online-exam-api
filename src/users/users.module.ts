import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { AuthSecurityModule } from '../auth/auth-security.module';

@Module({
  imports: [PrismaModule, AuthSecurityModule],
  controllers: [UsersController, AdminUsersController],

  providers: [UsersRepository, UsersService],

  exports: [UsersService],
})
export class UsersModule {}
