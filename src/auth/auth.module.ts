import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    UsersModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),

        signOptions: {
          expiresIn: Number(
            configService.get<string>('JWT_EXPIRES_IN') ?? 86400,
          ),
        },
      }),
    }),
  ],

  controllers: [AuthController],

  providers: [AuthService],

  exports: [AuthService],
})
export class AuthModule {}
