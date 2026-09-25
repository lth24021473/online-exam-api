import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSecurityModule } from './auth-security.module';

@Module({
  imports: [UsersModule, AuthSecurityModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, AuthSecurityModule],
})
export class AuthModule {}
