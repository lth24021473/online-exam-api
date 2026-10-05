import { AttemptStatus, PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const mongoTestUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = mongoTestUrl ? describe : describe.skip;

describeMongo('Demo seed (real MongoDB, opt-in)', () => {
  let prisma: PrismaClient;
  let databaseUrl: string;
  let ownedDatabaseName: string;

  beforeAll(() => {
    const target = new URL(mongoTestUrl!);
    if (
      target.protocol !== 'mongodb:' ||
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      target.username ||
      target.password
    ) {
      throw new Error(
        'Seed tests require an explicit local MongoDB URL without credentials',
      );
    }
    ownedDatabaseName = `online_exam_seed_codex_test_${randomBytes(6).toString('hex')}`;
    target.pathname = `/${ownedDatabaseName}`;
    databaseUrl = target.toString();
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      // This exact random database belongs solely to the current test run.
      // Never drop the supplied database, the application database or old runs.
      if (
        !/^online_exam_seed_codex_test_[a-f\d]{12}$/.test(ownedDatabaseName) ||
        new URL(databaseUrl).pathname !== `/${ownedDatabaseName}`
      ) {
        throw new Error(
          'Refusing cleanup outside the current seed test database',
        );
      }
      const database = await prisma.$runCommandRaw({ dbStats: 1 });
      if (database.db !== ownedDatabaseName) {
        throw new Error('Seed cleanup database identity does not match');
      }
      const result = await prisma.$runCommandRaw({ dropDatabase: 1 });
      if (result.ok !== 1) throw new Error('Seed test database cleanup failed');
    } finally {
      await prisma.$disconnect();
    }
  });

  async function runSeed() {
    return execute(
      process.execPath,
      ['--require', 'ts-node/register', 'prisma/seed.ts'],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
  }

  it('creates normalized options once and preserves an existing attempt and answer on rerun', async () => {
    const first = await runSeed();
    expect(first.stdout).toContain('Seed completed');
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.exam.count()).toBe(1);
    expect(await prisma.question.count()).toBe(5);
    expect(await prisma.option.count()).toBe(20);

    const student = await prisma.user.findUniqueOrThrow({
      where: { email: 'student@example.com' },
    });
    const exam = await prisma.exam.findFirstOrThrow({
      include: {
        questions: { include: { options: true }, orderBy: { position: 'asc' } },
      },
    });
    for (const question of exam.questions) {
      expect(question.options).toHaveLength(4);
      expect(
        question.options.filter((option) => option.isCorrect),
      ).toHaveLength(1);
      expect(question.options.map((option) => option.position).sort()).toEqual([
        0, 1, 2, 3,
      ]);
    }
    const attempt = await prisma.attempt.create({
      data: {
        userId: student.id,
        examId: exam.id,
        status: AttemptStatus.SUBMITTED,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        deadlineAt: new Date('2026-01-01T00:15:00.000Z'),
        submittedAt: new Date('2026-01-01T00:05:00.123Z'),
        totalQuestions: 5,
        score: 2,
        correctCount: 1,
        incorrectCount: 4,
        answers: {
          create: {
            questionId: exam.questions[0].id,
            selectedOptionId: exam.questions[0].options[0].id,
          },
        },
      },
      include: { answers: true },
    });

    const second = await runSeed();
    expect(second.stdout).toContain('Demo exam already exists');
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.exam.count()).toBe(1);
    expect(await prisma.question.count()).toBe(5);
    expect(await prisma.option.count()).toBe(20);
    expect(await prisma.attempt.count()).toBe(1);
    expect(await prisma.attemptAnswer.count()).toBe(1);
    expect(
      await prisma.attempt.findUniqueOrThrow({
        where: { id: attempt.id },
        include: { answers: true },
      }),
    ).toEqual(attempt);
    expect(
      await prisma.exam.findUniqueOrThrow({
        where: { id: exam.id },
        include: {
          questions: {
            include: { options: true },
            orderBy: { position: 'asc' },
          },
        },
      }),
    ).toEqual(exam);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: student.id },
      }),
    ).toEqual(student);
  }, 120_000);
});
