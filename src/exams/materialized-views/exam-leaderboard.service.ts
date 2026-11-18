import { Injectable, Logger } from '@nestjs/common';
import {
  Attempt,
  AttemptStatus,
  ExamLeaderboard,
  ExamSummaryStats,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type AttemptForLeaderboard = Pick<
  Attempt,
  'id' | 'examId' | 'userId' | 'startedAt'
> & {
  score?: number | null;
  submittedAt?: Date | null;
  user?: {
    fullName?: string;
    avatar?: string | null;
  };
};

@Injectable()
export class ExamLeaderboardService {
  private readonly logger = new Logger(ExamLeaderboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async updateLeaderboardOnSubmission(
    attempt: AttemptForLeaderboard,
  ): Promise<ExamLeaderboard | null> {
    if (attempt.score === null || attempt.score === undefined) {
      return null;
    }

    if (!this.prisma?.examLeaderboard || !this.prisma?.examSummaryStats) {
      return null;
    }

    const existing = await this.prisma.examLeaderboard.findUnique({
      where: {
        examId_userId: {
          examId: attempt.examId,
          userId: attempt.userId,
        },
      },
    });

    if (existing && attempt.score <= existing.bestScore) {
      return existing;
    }

    let fullName = attempt.user?.fullName;
    let avatar = attempt.user?.avatar;

    if (!fullName) {
      const user = this.prisma.user
        ? await this.prisma.user.findUnique({
            where: { id: attempt.userId },
            select: { fullName: true, avatar: true },
          })
        : null;
      fullName = user?.fullName ?? 'Thí sinh';
      avatar = user?.avatar ?? avatar ?? null;
    }

    const startedAt = attempt.startedAt ? new Date(attempt.startedAt) : null;
    const submittedAt = attempt.submittedAt
      ? new Date(attempt.submittedAt)
      : new Date();
    const durationSeconds =
      startedAt && submittedAt
        ? Math.max(
            0,
            Math.floor((submittedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : 0;

    const upserted = await this.prisma.examLeaderboard.upsert({
      where: {
        examId_userId: {
          examId: attempt.examId,
          userId: attempt.userId,
        },
      },
      create: {
        examId: attempt.examId,
        userId: attempt.userId,
        fullName,
        avatar: avatar ?? null,
        bestScore: attempt.score,
        durationSeconds,
        submittedAt,
      },
      update: {
        fullName,
        avatar: avatar ?? null,
        bestScore: attempt.score,
        durationSeconds,
        submittedAt,
      },
    });

    await this.recalculateSummaryStats(attempt.examId);

    return upserted;
  }

  async recalculateSummaryStats(
    examId: string,
  ): Promise<ExamSummaryStats | null> {
    if (
      !this.prisma?.examLeaderboard ||
      !this.prisma?.examSummaryStats ||
      !this.prisma?.attempt
    ) {
      return null;
    }

    const [totalAttempts, submittedCount, scoreAgg] = await Promise.all([
      this.prisma.attempt.count({
        where: { examId },
      }),
      this.prisma.attempt.count({
        where: { examId, status: AttemptStatus.SUBMITTED },
      }),
      this.prisma.attempt.aggregate({
        where: { examId, status: AttemptStatus.SUBMITTED },
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
      }),
    ]);

    const averageScore = scoreAgg._avg?.score ?? 0;
    const highestScore = scoreAgg._max?.score ?? 0;
    const lowestScore = scoreAgg._min?.score ?? 0;

    return this.prisma.examSummaryStats.upsert({
      where: { examId },
      create: {
        examId,
        totalAttempts,
        submittedCount,
        averageScore,
        highestScore,
        lowestScore,
      },
      update: {
        totalAttempts,
        submittedCount,
        averageScore,
        highestScore,
        lowestScore,
      },
    });
  }
}
