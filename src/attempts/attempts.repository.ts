import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttemptStatus, ExamStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockExamStatus } from '../exams/exam-write-conflict';

const examInfo = { select: { id: true, title: true } } as const;

const gradingQuestionSelect = {
  id: true,
  content: true,
  position: true,
  options: {
    orderBy: { position: 'asc' },
    select: { id: true, content: true, position: true, isCorrect: true },
  },
} as const;

const gradingAnswerSelect = {
  questionId: true,
  selectedOptionId: true,
  updatedAt: true,
  selectedOption: { select: { position: true } },
} as const;

export type GradingQuestion = Prisma.QuestionGetPayload<{
  select: typeof gradingQuestionSelect;
}>;

export type GradingAnswer = Prisma.AttemptAnswerGetPayload<{
  select: typeof gradingAnswerSelect;
}>;

export type AttemptWithExam = Prisma.AttemptGetPayload<{
  include: { exam: typeof examInfo };
}>;

type GradeAttempt = (
  questions: GradingQuestion[],
  answers: GradingAnswer[],
  attempt: AttemptWithExam,
) => {
  submittedAt: Date;
  score: number;
  correctCount: number;
  incorrectCount: number;
};

@Injectable()
export class AttemptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findExamForStart(examId: string) {
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

  createOrResume(data: {
    userId: string;
    examId: string;
    deadlineAt: Date;
    totalQuestions: number;
  }) {
    return this.withWriteConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const where = {
          userId: data.userId,
          examId: data.examId,
          status: AttemptStatus.IN_PROGRESS,
        };
        const existing = await tx.attempt.findFirst({
          where,
          orderBy: { startedAt: 'desc' },
        });
        if (existing) return { attempt: existing, resumed: true };

        const user = await tx.user.findUnique({
          where: { id: data.userId },
          select: { updatedAt: true },
        });
        if (!user) throw new NotFoundException('User not found');
        // Serialize new attempts for the same account across API processes.
        // A strictly later timestamp guarantees an actual write, even when
        // concurrent requests arrive in the same millisecond. No JWT version
        // changes, so starting an exam preserves every current session.
        await tx.user.update({
          where: { id: data.userId },
          data: {
            updatedAt: new Date(
              Math.max(Date.now(), user.updatedAt.getTime() + 1),
            ),
          },
        });

        // Share the exam write lock with publish/close so a stale service
        // snapshot cannot create a new attempt after closure has committed.
        try {
          await lockExamStatus(tx, data.examId, ExamStatus.PUBLISHED);
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw new ConflictException('Exam is closed');
          }
          throw error;
        }

        const running = await tx.attempt.findFirst({
          where,
          orderBy: { startedAt: 'desc' },
        });
        if (running) return { attempt: running, resumed: true };
        return {
          attempt: await tx.attempt.create({ data }),
          resumed: false,
        };
      }),
    );
  }

  findById(id: string) {
    return this.prisma.attempt.findUnique({
      where: { id },
      include: { exam: examInfo },
    });
  }

  findExpiredForExam(examId: string, take: number) {
    return this.prisma.attempt.findMany({
      where: {
        examId,
        status: AttemptStatus.IN_PROGRESS,
        deadlineAt: { lte: new Date() },
      },
      orderBy: { id: 'asc' },
      take,
      include: { exam: examInfo },
    });
  }

  /** Questions without the answer key (safe to send to students while taking the exam). */
  listQuestions(examId: string) {
    return this.prisma.question.findMany({
      where: { examId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        content: true,
        position: true,
        options: {
          orderBy: { position: 'asc' },
          select: { id: true, content: true, position: true },
        },
      },
    });
  }

  /** Questions including the answer key (grading / result review only). */
  listQuestionsWithKey(examId: string) {
    return this.prisma.question.findMany({
      where: { examId },
      orderBy: { position: 'asc' },
      select: gradingQuestionSelect,
    });
  }

  findQuestionInExam(examId: string, questionId: string) {
    return this.prisma.question.findFirst({
      where: { id: questionId, examId },
      select: {
        id: true,
        options: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true },
        },
      },
    });
  }

  listAnswers(attemptId: string) {
    return this.prisma.attemptAnswer.findMany({
      where: { attemptId },
      select: gradingAnswerSelect,
    });
  }

  upsertAnswer(
    attemptId: string,
    userId: string,
    questionId: string,
    selectedOptionId: string,
  ) {
    return this.withWriteConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.attempt.updateMany({
          where: {
            id: attemptId,
            userId,
            status: AttemptStatus.IN_PROGRESS,
            deadlineAt: { gt: new Date() },
          },
          data: { answerVersion: { increment: 1 } },
        });
        if (count === 0) {
          throw new ConflictException('Attempt is no longer active');
        }

        return tx.attemptAnswer.upsert({
          where: { attemptId_questionId: { attemptId, questionId } },
          create: { attemptId, questionId, selectedOptionId },
          update: { selectedOptionId },
          select: gradingAnswerSelect,
        });
      }),
    );
  }

  /** Save grading and transition status using the same answer snapshot. */
  submitInProgress(attemptId: string, userId: string, grade: GradeAttempt) {
    return this.withWriteConflictRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const attempt = await tx.attempt.findFirst({
          where: { id: attemptId, userId },
          include: { exam: examInfo },
        });
        if (!attempt) throw new NotFoundException('Attempt not found');
        if (attempt.status === AttemptStatus.CANCELLED) {
          throw new ConflictException('Cancelled attempts cannot be submitted');
        }
        if (attempt.status === AttemptStatus.SUBMITTED) return attempt;

        const { count } = await tx.attempt.updateMany({
          where: { id: attemptId, userId, status: AttemptStatus.IN_PROGRESS },
          data: { status: AttemptStatus.SUBMITTED },
        });
        if (count === 0) {
          throw new ConflictException('Attempt is no longer active');
        }

        const [questions, answers] = await Promise.all([
          tx.question.findMany({
            where: { examId: attempt.examId },
            orderBy: { position: 'asc' },
            select: gradingQuestionSelect,
          }),
          tx.attemptAnswer.findMany({
            where: { attemptId },
            select: gradingAnswerSelect,
          }),
        ]);

        return tx.attempt.update({
          where: { id: attemptId },
          data: grade(questions, answers, attempt),
          include: { exam: examInfo },
        });
      }),
    );
  }

  /** Preserve a cancelled attempt and its answers for history. */
  async cancelInProgress(attemptId: string, userId: string) {
    const { count } = await this.withWriteConflictRetry(() =>
      this.prisma.attempt.updateMany({
        where: { id: attemptId, userId, status: AttemptStatus.IN_PROGRESS },
        data: { status: AttemptStatus.CANCELLED, cancelledAt: new Date() },
      }),
    );
    return count;
  }

  async history(where: Prisma.AttemptWhereInput, skip: number, take: number) {
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
          cancelledAt: true,
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

  private async withWriteConflictRetry<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        ) {
          throw error;
        }
        // Let the winning MongoDB transaction commit before reading a fresh
        // snapshot. Immediate retries can consume all attempts while the same
        // concurrent submit is still grading.
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        }
      }
    }

    throw new ConflictException(
      'Attempt changed concurrently. Please retry the operation',
    );
  }
}
