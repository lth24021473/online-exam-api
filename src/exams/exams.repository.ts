import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttemptStatus, ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ExamResultsQueryDto } from './dto/exam-results-query.dto';
import { lockExamStatus, retryExamWrite } from './exam-write-conflict';

@Injectable()
export class ExamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ExamCreateInput) {
    return this.prisma.exam.create({ data });
  }

  findById(id: string) {
    return this.prisma.exam.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        },
      },
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
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, id, ExamStatus.DRAFT);
        return tx.exam.update({ where: { id }, data });
      }),
    );
  }

  delete(id: string) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const exam = await tx.exam.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!exam) throw new NotFoundException('Exam not found');
        // Serialize deletion with edits, status changes and new attempts.
        await lockExamStatus(tx, id, exam.status);
        const questions = await tx.question.findMany({
          where: { examId: id },
          select: { id: true },
        });
        const questionIds = questions.map((question) => question.id);
        const attempts = await tx.attempt.findMany({
          where: { examId: id },
          select: { id: true },
        });
        const attemptIds = attempts.map((attempt) => attempt.id);
        // Refuse inconsistent cross-exam references rather than deleting
        // answers belonging to another exam.
        if (
          await tx.attemptAnswer.count({
            where: {
              attemptId: { notIn: attemptIds },
              OR: [
                { questionId: { in: questionIds } },
                { selectedOption: { questionId: { in: questionIds } } },
              ],
            },
          })
        ) {
          throw new ConflictException(
            'Exam content is referenced by another exam attempt',
          );
        }
        await tx.attemptAnswer.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await tx.attempt.deleteMany({ where: { examId: id } });
        await tx.option.deleteMany({
          where: { questionId: { in: questionIds } },
        });
        await tx.question.deleteMany({ where: { examId: id } });
        return tx.exam.delete({ where: { id } });
      }),
    );
  }

  publish(id: string) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, id, ExamStatus.DRAFT);
        const questions = await tx.question.findMany({
          where: { examId: id },
          include: { options: true },
        });
        if (
          !questions.length ||
          questions.some(
            (question) =>
              !question.content.trim() ||
              question.options.length < 2 ||
              question.options.some((option) => !option.content.trim()) ||
              question.options.filter((option) => option.isCorrect).length !==
                1,
          )
        ) {
          throw new BadRequestException(
            'Each exam needs at least one question, two non-empty options per question and exactly one correct option',
          );
        }
        return tx.exam.update({
          where: { id },
          data: { status: ExamStatus.PUBLISHED, publishedAt: new Date() },
        });
      }),
    );
  }

  close(id: string) {
    return retryExamWrite(() =>
      this.prisma.$transaction(async (tx) => {
        await lockExamStatus(tx, id, ExamStatus.PUBLISHED);
        return tx.exam.update({
          where: { id },
          data: { status: ExamStatus.CLOSED, closedAt: new Date() },
        });
      }),
    );
  }

  listResults(examId: string, query: ExamResultsQueryDto) {
    const where: Prisma.AttemptWhereInput = {
      examId,
      ...(query.status ? { status: query.status } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const data = await tx.attempt.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          startedAt: true,
          deadlineAt: true,
          submittedAt: true,
          cancelledAt: true,
          score: true,
          totalQuestions: true,
          correctCount: true,
          incorrectCount: true,
          user: { select: { id: true, email: true, fullName: true } },
        },
      });
      const total = await tx.attempt.count({ where });
      const counts = await tx.attempt.groupBy({
        by: ['status'],
        where: { examId },
        _count: { _all: true },
      });
      const scores = await tx.attempt.aggregate({
        where: { examId, status: AttemptStatus.SUBMITTED },
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
      });
      const count = (status: AttemptStatus) =>
        counts.find((row) => row.status === status)?._count._all ?? 0;
      return {
        data,
        meta: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
        summary: {
          totalAttempts: counts.reduce((sum, row) => sum + row._count._all, 0),
          inProgressCount: count(AttemptStatus.IN_PROGRESS),
          submittedCount: count(AttemptStatus.SUBMITTED),
          cancelledCount: count(AttemptStatus.CANCELLED),
          averageScore: scores._avg.score,
          highestScore: scores._max.score,
          lowestScore: scores._min.score,
        },
      };
    });
  }
}
