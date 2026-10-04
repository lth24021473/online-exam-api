import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class QuestionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.question.findUnique({
      where: { id },
      include: {
        options: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    });
  }

  findByExam(examId: string) {
    return this.prisma.question.findMany({
      where: { examId },

      include: {
        options: {
          orderBy: {
            position: 'asc',
          },
        },
      },

      orderBy: {
        position: 'asc',
      },
    });
  }

  create(data: Prisma.QuestionCreateInput) {
    return this.prisma.question.create({
      data,
      include: {
        options: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    });
  }

  update(id: string, data: Prisma.QuestionUpdateInput) {
    return this.prisma.question.update({
      where: { id },
      data,
      include: {
        options: {
          orderBy: {
            position: 'asc',
          },
        },
      },
    });
  }

  delete(id: string) {
    return this.prisma.question.delete({
      where: { id },
    });
  }

  existsByPosition(examId: string, position: number) {
    return this.prisma.question.findUnique({
      where: {
        examId_position: {
          examId,
          position,
        },
      },
    });
  }
}
