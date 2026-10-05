import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { lockExamStatus, retryExamWrite } from '../exam-write-conflict';

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

  create(examId: string, data: Prisma.QuestionCreateInput) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, examId, ExamStatus.DRAFT);
        return tx.question.create({
          data,
          include: {
            options: {
              orderBy: {
                position: 'asc',
              },
            },
          },
        });
      }),
    );
  }

  update(examId: string, id: string, data: Prisma.QuestionUpdateInput) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, examId, ExamStatus.DRAFT);
        const question = await tx.question.findFirst({ where: { id, examId } });
        if (!question) throw new NotFoundException('Question not found');
        if (
          data.options &&
          (await tx.attemptAnswer.count({ where: { questionId: id } }))
        ) {
          throw new ConflictException(
            'Options referenced by answers cannot be replaced',
          );
        }
        return tx.question.update({
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
      }),
    );
  }

  delete(examId: string, id: string) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, examId, ExamStatus.DRAFT);
        const question = await tx.question.findFirst({ where: { id, examId } });
        if (!question) throw new NotFoundException('Question not found');
        if (await tx.attemptAnswer.count({ where: { questionId: id } })) {
          throw new ConflictException(
            'Questions referenced by answers cannot be deleted',
          );
        }
        await tx.option.deleteMany({ where: { questionId: id } });
        return tx.question.delete({ where: { id } });
      }),
    );
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
