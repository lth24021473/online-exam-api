import {
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

  async updateProfile(
    id: string,
    data: {
      fullName?: string;
      avatar?: string | null;
      cover?: string | null;
      workplace?: string | null;
      currentResidence?: string | null;
    },
  ) {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async findAll(page = 1, limit = 20, search?: string) {
    const pageNum = Number.isInteger(page) && page > 0 ? page : 1;
    const limitNum =
      Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;

    const where: Prisma.UserWhereInput = {};
    if (search && search.trim()) {
      const trimmed = search.trim();
      where.OR = [
        { email: { contains: trimmed, mode: 'insensitive' } },
        { fullName: { contains: trimmed, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          avatar: true,
          cover: true,
          workplace: true,
          currentResidence: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    return {
      data,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
      },
    };
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
        avatar: true,
        cover: true,
        workplace: true,
        currentResidence: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
