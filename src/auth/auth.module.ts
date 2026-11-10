import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSecurityModule } from './auth-security.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [UsersModule, AuthSecurityModule, MailModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, AuthSecurityModule],
})
export class AuthModule {}
