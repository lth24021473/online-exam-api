import { Injectable } from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ExamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ExamCreateInput) {
    return this.prisma.exam.create({ data });
  }

  findById(id: string) {
    return this.prisma.exam.findUnique({
      where: { id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
  }

  findAll() {
    return this.prisma.exam.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
  }

  findManyByManager(managerId: string) {
    return this.prisma.exam.findMany({
      where: { managerId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
  }

  findManyPublished() {
    return this.prisma.exam.findMany({
      where: { status: ExamStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      include: { _count: { select: { questions: true } } },
    });
  }

  update(id: string, data: Prisma.ExamUpdateInput) {
    return this.prisma.exam.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.exam.delete({ where: { id } });
  }

  publish(id: string) {
    return this.prisma.exam.update({
      where: { id },
      data: { status: ExamStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  close(id: string) {
    return this.prisma.exam.update({
      where: { id },
      data: { status: ExamStatus.CLOSED, closedAt: new Date() },
    });
  }
}
