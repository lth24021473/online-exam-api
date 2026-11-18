import 'dotenv/config';
import { PrismaClient, AttemptStatus } from '@prisma/client';

const prisma = new PrismaClient();

export interface SubmittedAttemptWithUser {
  id: string;
  userId: string;
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  user: {
    fullName: string;
    avatar: string | null;
  };
}

export interface LeaderboardRecord {
  examId: string;
  userId: string;
  fullName: string;
  avatar: string | null;
  bestScore: number;
  durationSeconds: number;
  submittedAt: Date;
}

export function calculateDurationSeconds(
  startedAt: Date | null | undefined,
  submittedAt: Date | null | undefined,
): number {
  if (!startedAt || !submittedAt) {
    return 0;
  }
  return Math.max(
    0,
    Math.floor((submittedAt.getTime() - startedAt.getTime()) / 1000),
  );
}

export function compareAttempts(
  a: SubmittedAttemptWithUser,
  b: SubmittedAttemptWithUser,
): number {
  const scoreA = a.score ?? 0;
  const scoreB = b.score ?? 0;
  // Rule a: Highest score (score desc)
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }

  // Rule b: Shortest duration (durationSeconds asc)
  const durationA = calculateDurationSeconds(a.startedAt, a.submittedAt);
  const durationB = calculateDurationSeconds(b.startedAt, b.submittedAt);
  if (durationA !== durationB) {
    return durationA - durationB;
  }

  // Rule c: Earliest submission (submittedAt asc)
  const timeA = a.submittedAt ? a.submittedAt.getTime() : 0;
  const timeB = b.submittedAt ? b.submittedAt.getTime() : 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // Rule d: Fallback by id (att.id asc)
  return a.id.localeCompare(b.id);
}

async function main() {
  const startTime = Date.now();
  console.log('=== Starting Materialized Views Migration ===');

  try {
    // 1. Scan all exams that have at least one SUBMITTED attempt
    const targetExams = await prisma.exam.findMany({
      where: {
        attempts: {
          some: {
            status: AttemptStatus.SUBMITTED,
          },
        },
      },
      select: {
        id: true,
        title: true,
      },
    });

    console.log(
      `Found ${targetExams.length} exam(s) with submitted attempts to migrate.`,
    );

    if (targetExams.length === 0) {
      console.log('No exams require materialized view migration at this time.');
      console.log('=== Migration Finished (0 exams processed) ===');
      return;
    }

    let totalLeaderboardUpserted = 0;
    let totalStatsUpserted = 0;

    for (let examIndex = 0; examIndex < targetExams.length; examIndex++) {
      const exam = targetExams[examIndex];
      console.log(
        `\n[${examIndex + 1}/${targetExams.length}] Processing Exam: "${exam.title}" (ID: ${exam.id})`,
      );

      // 2. Query attempts for summary stats and leaderboard
      const totalAttempts = await prisma.attempt.count({
        where: { examId: exam.id },
      });

      const submittedAttempts: SubmittedAttemptWithUser[] =
        await prisma.attempt.findMany({
          where: {
            examId: exam.id,
            status: AttemptStatus.SUBMITTED,
          },
          select: {
            id: true,
            userId: true,
            score: true,
            startedAt: true,
            submittedAt: true,
            user: {
              select: {
                fullName: true,
                avatar: true,
              },
            },
          },
        });

      const submittedCount = submittedAttempts.length;

      // 3. Calculate Summary Statistics
      let sumScores = 0;
      let highestScore = 0;
      let lowestScore = 0;

      if (submittedCount > 0) {
        highestScore = submittedAttempts[0].score ?? 0;
        lowestScore = submittedAttempts[0].score ?? 0;
        for (const att of submittedAttempts) {
          const sc = att.score ?? 0;
          sumScores += sc;
          if (sc > highestScore) highestScore = sc;
          if (sc < lowestScore) lowestScore = sc;
        }
      }

      const averageScore =
        submittedCount === 0
          ? 0
          : Math.round((sumScores / submittedCount) * 100) / 100;

      // Upsert ExamSummaryStats
      await prisma.examSummaryStats.upsert({
        where: { examId: exam.id },
        create: {
          examId: exam.id,
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
      totalStatsUpserted++;

      console.log(
        `  - ExamSummaryStats upserted: totalAttempts=${totalAttempts}, submittedCount=${submittedCount}, avg=${averageScore}, max=${highestScore}, min=${lowestScore}`,
      );

      // 4. Calculate Best Attempt per student for ExamLeaderboard
      const studentAttemptsMap = new Map<string, SubmittedAttemptWithUser[]>();
      for (const att of submittedAttempts) {
        const existing = studentAttemptsMap.get(att.userId);
        if (existing) {
          existing.push(att);
        } else {
          studentAttemptsMap.set(att.userId, [att]);
        }
      }

      const leaderboardRecords: LeaderboardRecord[] = [];
      for (const [userId, userAttempts] of studentAttemptsMap.entries()) {
        userAttempts.sort(compareAttempts);
        const bestAttempt = userAttempts[0];

        const durationSeconds = calculateDurationSeconds(
          bestAttempt.startedAt,
          bestAttempt.submittedAt,
        );
        const submittedAt =
          bestAttempt.submittedAt ?? bestAttempt.startedAt ?? new Date();
        const bestScore = bestAttempt.score ?? 0;
        const fullName = bestAttempt.user?.fullName ?? 'Unknown User';
        const avatar = bestAttempt.user?.avatar ?? null;

        leaderboardRecords.push({
          examId: exam.id,
          userId,
          fullName,
          avatar,
          bestScore,
          durationSeconds,
          submittedAt,
        });
      }

      // Batch upsert leaderboard records in chunks of 50
      const BATCH_SIZE = 50;
      for (let i = 0; i < leaderboardRecords.length; i += BATCH_SIZE) {
        const chunk = leaderboardRecords.slice(i, i + BATCH_SIZE);
        await Promise.all(
          chunk.map((rec) =>
            prisma.examLeaderboard.upsert({
              where: {
                examId_userId: {
                  examId: rec.examId,
                  userId: rec.userId,
                },
              },
              create: {
                examId: rec.examId,
                userId: rec.userId,
                fullName: rec.fullName,
                avatar: rec.avatar,
                bestScore: rec.bestScore,
                durationSeconds: rec.durationSeconds,
                submittedAt: rec.submittedAt,
              },
              update: {
                fullName: rec.fullName,
                avatar: rec.avatar,
                bestScore: rec.bestScore,
                durationSeconds: rec.durationSeconds,
                submittedAt: rec.submittedAt,
              },
            }),
          ),
        );
      }

      totalLeaderboardUpserted += leaderboardRecords.length;
      console.log(
        `  - ExamLeaderboard upserted: ${leaderboardRecords.length} student entries across ${studentAttemptsMap.size} students.`,
      );
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n=== Migration Finished in ${elapsedSeconds}s ===`);
    console.log(`Exams processed: ${targetExams.length}`);
    console.log(`Summary stats upserted: ${totalStatsUpserted}`);
    console.log(`Leaderboard records upserted: ${totalLeaderboardUpserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (
  typeof require !== 'undefined' &&
  (require.main === module ||
    process.argv[1]?.includes('migrate-exam-materialized-views'))
) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Migration failed with error:', error);
      process.exit(1);
    });
}
