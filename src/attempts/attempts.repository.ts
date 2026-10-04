import { Injectable } from '@nestjs/common';
import { AttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AttemptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AttemptCreateInput) {
    return this.prisma.attempt.create({
      data,
      include: { exam: { include: { questions: { orderBy: { position: 'asc' } } } } },
    });
  }

  findByIdWithDetails(id: string) {
    return this.prisma.attempt.findUnique({
      where: { id },
      include: {
        exam: { select: { title: true, durationMinutes: true } },
        answers: { orderBy: { updatedAt: 'asc' } },
      },
    });
  }

  findByUser(userId: string) {
    return this.prisma.attempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: { exam: { select: { title: true, durationMinutes: true } } },
    });
  }

  findActiveByUserAndExam(userId: string, examId: string) {
    return this.prisma.attempt.findFirst({
      where: { userId, examId, status: AttemptStatus.IN_PROGRESS },
    });
  }

  upsertAnswer(attemptId: string, questionId: string, selectedOptionIndex: number) {
    return this.prisma.answer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, selectedOptionIndex },
      update: { selectedOptionIndex },
    });
  }

  submit(id: string, score: number, correctCount: number, incorrectCount: number) {
    return this.prisma.attempt.update({
      where: { id },
      data: {
        status: AttemptStatus.SUBMITTED,
        submittedAt: new Date(),
        score,
        correctCount,
        incorrectCount,
      },
      include: { answers: true },
    });
  }
}
