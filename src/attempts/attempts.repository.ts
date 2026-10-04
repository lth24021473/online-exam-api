import { Injectable } from '@nestjs/common';
import { AttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AttemptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findExamForStart(examId: string) {
    return this.prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        title: true,
        instructions: true,
        durationMinutes: true,
        status: true,
        _count: { select: { questions: true } },
      },
    });
  }

  findInProgress(userId: string, examId: string) {
    return this.prisma.attempt.findFirst({
      where: { userId, examId, status: AttemptStatus.IN_PROGRESS },
      orderBy: { startedAt: 'desc' },
    });
  }

  create(data: {
    userId: string;
    examId: string;
    deadlineAt: Date;
    totalQuestions: number;
  }) {
    return this.prisma.attempt.create({ data });
  }

  findById(id: string) {
    return this.prisma.attempt.findUnique({
      where: { id },
      include: { exam: { select: { id: true, title: true } } },
    });
  }

  /** Questions without the answer key (safe to send to students while taking the exam). */
  listQuestions(examId: string) {
    return this.prisma.question.findMany({
      where: { examId },
      orderBy: { position: 'asc' },
      select: { id: true, content: true, options: true, position: true },
    });
  }

  /** Questions including correctOptionIndex (grading / result review only). */
  listQuestionsWithKey(examId: string) {
    return this.prisma.question.findMany({
      where: { examId },
      orderBy: { position: 'asc' },
    });
  }

  findQuestionInExam(examId: string, questionId: string) {
    return this.prisma.question.findFirst({
      where: { id: questionId, examId },
      select: { id: true, options: true },
    });
  }

  listAnswers(attemptId: string) {
    return this.prisma.answer.findMany({
      where: { attemptId },
      select: {
        questionId: true,
        selectedOptionIndex: true,
        updatedAt: true,
      },
    });
  }

  upsertAnswer(
    attemptId: string,
    questionId: string,
    selectedOptionIndex: number,
  ) {
    return this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, selectedOptionIndex },
      update: { selectedOptionIndex },
    });
  }

  /** Atomic IN_PROGRESS -> SUBMITTED transition. Returns how many rows were updated (0 or 1). */
  async finalize(
    attemptId: string,
    data: {
      submittedAt: Date;
      score: number;
      correctCount: number;
      incorrectCount: number;
    },
  ) {
    const { count } = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: AttemptStatus.IN_PROGRESS },
      data: { ...data, status: AttemptStatus.SUBMITTED },
    });
    return count;
  }

  /** Atomic delete guarded by owner + status. Returns how many rows were deleted (0 or 1). */
  async deleteInProgress(attemptId: string, userId: string) {
    const { count } = await this.prisma.attempt.deleteMany({
      where: { id: attemptId, userId, status: AttemptStatus.IN_PROGRESS },
    });
    return count;
  }

  deleteAnswers(attemptId: string) {
    return this.prisma.answer.deleteMany({ where: { attemptId } });
  }

  async history(
    where: Prisma.AttemptWhereInput,
    skip: number,
    take: number,
  ) {
    const [items, total] = await Promise.all([
      this.prisma.attempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          status: true,
          startedAt: true,
          deadlineAt: true,
          submittedAt: true,
          score: true,
          totalQuestions: true,
          correctCount: true,
          incorrectCount: true,
          exam: { select: { id: true, title: true } },
        },
      }),
      this.prisma.attempt.count({ where }),
    ]);
    return { items, total };
  }
}
