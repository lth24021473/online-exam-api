import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { RolesGuard } from './roles.guard';
import { PrismaModule } from '../database/prisma.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenRevocationService } from './token-revocation.service';

@Module({
  imports: [
    PrismaModule,

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

  providers: [JwtAuthGuard, RolesGuard, TokenRevocationService],

  exports: [
    JwtAuthGuard,
    RolesGuard,
    JwtModule,
    TokenRevocationService,
    PrismaModule,
  ],
})
export class AuthSecurityModule {}
