import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { TokenRevocationService } from './token-revocation.service';
import { PrismaService } from '../database/prisma.service';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; role: Role };
  auth: { token: string; sub: string; exp: number };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly revocations: TokenRevocationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match) throw new UnauthorizedException('Bearer token is required');
    const token = match[1];
    let payload: {
      sub: string;
      exp: number;
      email: string;
      role: Role;
      authVersion?: number;
    };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        algorithms: ['HS256'],
      });
      if (
        typeof payload.sub !== 'string' ||
        !/^[a-f\d]{24}$/i.test(payload.sub) ||
        typeof payload.email !== 'string' ||
        !payload.email ||
        !Object.values(Role).includes(payload.role) ||
        !Number.isFinite(payload.exp) ||
        (payload.authVersion !== undefined &&
          (!Number.isSafeInteger(payload.authVersion) ||
            payload.authVersion < 0))
      ) {
        throw new Error('Invalid token claims');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (await this.revocations.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, authVersion: true },
    });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    // Legacy accounts/tokens start at version zero. Once permissions change,
    // every earlier session stays invalid, even if the old role is restored.
    if (
      user.role !== payload.role ||
      (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
    ) {
      throw new UnauthorizedException(
        'Account permissions have changed. Please sign in again',
      );
    }
    request.auth = { token, sub: payload.sub, exp: payload.exp };
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    return true;
  }
}
