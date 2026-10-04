import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: {
        email,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: {
        id,
      },
    });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    fullName: string;
  }) {
    return this.prisma.user.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateRole(id: string, role: Role) {
    // MongoDB defaults do not backfill old documents. Initialize only missing
    // fields so incrementing the version never loses an existing counter.
    await this.prisma.user.updateMany({
      where: {
        id,
        OR: [{ authVersion: { isSet: false } }, { authVersion: null }],
      },
      data: { authVersion: 0 },
    });
    // The role and version change in one atomic write. Reassigning the current
    // role is a no-op and does not log the account out.
    await this.prisma.user.updateMany({
      where: { id, role: { not: role } },
      data: { role, authVersion: { increment: 1 } },
    });
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deleteById(id: string) {
    try {
      return await this.prisma.user.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException('User not found');
        }
        if (error.code === 'P2014' || error.code === 'P2003') {
          throw new ConflictException(
            'User cannot be deleted while they own exams or attempts',
          );
        }
      }
      throw error;
    }
  }
}
