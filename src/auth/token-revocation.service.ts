import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TokenRevocationService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async isRevoked(token: string) {
    return (
      (await this.prisma.revokedToken.findUnique({
        where: { tokenHash: this.hash(token) },
      })) !== null
    );
  }

  async revoke(token: string, expiresAt: number) {
    const tokenHash = this.hash(token);
    await this.prisma.revokedToken.upsert({
      where: { tokenHash },
      create: { tokenHash, expiresAt: new Date(expiresAt * 1000) },
      update: {},
    });
  }
}
