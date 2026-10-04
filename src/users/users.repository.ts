import { Injectable } from '@nestjs/common';
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
      select: { id: true, email: true, fullName: true, role: true, createdAt: true, updatedAt: true },
    });
  }

  async updateRole(id: string, role: import('@prisma/client').Role) {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, fullName: true, role: true, updatedAt: true },
    });
  }

  async deleteById(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
