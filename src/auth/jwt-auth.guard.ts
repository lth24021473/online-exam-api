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

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string; role: Role };
  auth: { token: string; sub: string; exp: number };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly revocations: TokenRevocationService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match) throw new UnauthorizedException('Bearer token is required');
    const token = match[1];
    let payload: { sub: string; exp: number; email: string; role: Role };
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
        !Number.isFinite(payload.exp)
      ) {
        throw new Error('Invalid token claims');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (await this.revocations.isRevoked(token)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    request.auth = { token, sub: payload.sub, exp: payload.exp };
    request.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    return true;
  }
}
