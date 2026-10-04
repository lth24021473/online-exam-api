import { Prisma, PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const mongoTestUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = mongoTestUrl ? describe : describe.skip;
const projectDirectory = resolve(__dirname, '..');

describeMongo('Legacy option migration (real MongoDB, opt-in)', () => {
  let prisma: PrismaClient;
  let databaseUrl: string;
  let fixture: {
    managerId: string;
    studentId: string;
    examId: string;
    questionId: string;
    attemptId: string;
    answerId: string;
  };
  const savedAt = '2026-01-01T00:05:00.123Z';

  beforeEach(() => {
    // Each test creates its own database. The supplied database and .env database
    // are never queried or modified; no collection/database cleanup is needed.
    const target = new URL(mongoTestUrl!);
    target.pathname = `/online_exam_migration_codex_test_${randomBytes(6).toString('hex')}`;
    databaseUrl = target.toString();
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    fixture = {
      managerId: randomBytes(12).toString('hex'),
      studentId: randomBytes(12).toString('hex'),
      examId: randomBytes(12).toString('hex'),
      questionId: randomBytes(12).toString('hex'),
      attemptId: randomBytes(12).toString('hex'),
      answerId: randomBytes(12).toString('hex'),
    };
  });

  afterEach(async () => {
    await prisma?.$disconnect();
  });

  async function insert(collection: string, document: Prisma.InputJsonObject) {
    const result = await prisma.$runCommandRaw({
      insert: collection,
      documents: [document],
    });
    expect(result.ok).toBe(1);
    expect(result.writeErrors).toBeUndefined();
    expect(result.n).toBe(1);
  }

  async function createLegacyFixture(selectedOptionIndex = 1) {
    for (const [id, role] of [
      [fixture.managerId, 'EXAM_MANAGER'],
      [fixture.studentId, 'STUDENT'],
    ]) {
      await insert('User', {
        _id: { $oid: id },
        email: `${id}@migration.example`,
        fullName: 'Migration fixture',
        passwordHash: 'unused-test-fixture',
        role,
        createdAt: { $date: savedAt },
        updatedAt: { $date: savedAt },
      });
    }
    await insert('Exam', {
      _id: { $oid: fixture.examId },
      managerId: { $oid: fixture.managerId },
      title: 'Migration integration fixture',
      durationMinutes: 15,
      status: 'PUBLISHED',
      createdAt: { $date: savedAt },
      updatedAt: { $date: savedAt },
    });
    await insert('Question', {
      _id: { $oid: fixture.questionId },
      examId: { $oid: fixture.examId },
      content: 'Choose the correct option.',
      position: 1,
      options: ['Wrong', 'Correct'],
      correctOptionIndex: 1,
    });
    await insert('Attempt', {
      _id: { $oid: fixture.attemptId },
      userId: { $oid: fixture.studentId },
      examId: { $oid: fixture.examId },
      status: 'SUBMITTED',
      startedAt: { $date: '2026-01-01T00:00:00.000Z' },
      deadlineAt: { $date: '2026-01-01T00:15:00.000Z' },
      submittedAt: { $date: savedAt },
      score: 10,
      totalQuestions: 1,
      correctCount: 1,
      incorrectCount: 0,
    });
    await insert('Answer', {
      _id: { $oid: fixture.answerId },
      attemptId: { $oid: fixture.attemptId },
      questionId: { $oid: fixture.questionId },
      selectedOptionIndex,
      updatedAt: { $date: savedAt },
    });
  }

  async function runMigration(apply = false) {
    const argumentsList = [
      '--require',
      'ts-node/register',
      'prisma/migrate-options.ts',
      ...(apply ? ['--apply'] : []),
    ];
    try {
      const result = await execute(process.execPath, argumentsList, {
        cwd: projectDirectory,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      return { ...result, code: 0 };
    } catch (error: unknown) {
      const failure = error as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      if (typeof failure.code !== 'number') throw error;
      return {
        code: failure.code,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    }
  }

  it('dry runs, converts and reruns while preserving legacy data', async () => {
    await createLegacyFixture();
    const legacyAnswer = await prisma.attemptAnswer.findRaw();
    const legacyAttempt = await prisma.attempt.findRaw();
    const legacyQuestion = await prisma.question.findRaw();

    const dryRun = await runMigration();
    expect(dryRun.code).toBe(0);
    expect(dryRun.stdout).toContain(
      'Pending: 2 options, 1 answer links, 1 attempt versions.',
    );
    expect(await prisma.option.count()).toBe(0);
    expect(await prisma.attemptAnswer.findRaw()).toEqual(legacyAnswer);
    expect(await prisma.attempt.findRaw()).toEqual(legacyAttempt);

    const applied = await runMigration(true);
    expect(applied.code).toBe(0);
    expect(applied.stdout).toContain('Migration complete.');

    const options = await prisma.option.findMany({
      orderBy: { position: 'asc' },
    });
    expect(options).toEqual([
      expect.objectContaining({
        questionId: fixture.questionId,
        content: 'Wrong',
        position: 0,
        isCorrect: false,
      }),
      expect.objectContaining({
        questionId: fixture.questionId,
        content: 'Correct',
        position: 1,
        isCorrect: true,
      }),
    ]);
    const answer = await prisma.attemptAnswer.findUniqueOrThrow({
      where: { id: fixture.answerId },
    });
    expect(answer).toEqual(
      expect.objectContaining({
        id: fixture.answerId,
        attemptId: fixture.attemptId,
        questionId: fixture.questionId,
        selectedOptionId: options[1].id,
        updatedAt: new Date(savedAt),
      }),
    );
    const attempt = await prisma.attempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
    });
    expect(attempt).toEqual(
      expect.objectContaining({
        id: fixture.attemptId,
        userId: fixture.studentId,
        examId: fixture.examId,
        status: 'SUBMITTED',
        score: 10,
        submittedAt: new Date(savedAt),
        answerVersion: 0,
      }),
    );
    expect(
      await prisma.user.findUnique({ where: { id: fixture.studentId } }),
    ).not.toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: fixture.managerId } }),
    ).not.toBeNull();
    expect(
      await prisma.exam.findUnique({ where: { id: fixture.examId } }),
    ).not.toBeNull();
    expect(await prisma.question.findRaw()).toEqual(legacyQuestion);
    expect(await prisma.attemptAnswer.findRaw()).toEqual([
      expect.objectContaining({ selectedOptionIndex: 1 }),
    ]);

    const convertedAnswers = await prisma.attemptAnswer.findRaw();
    const convertedAttempts = await prisma.attempt.findRaw();
    const repeated = await runMigration(true);
    expect(repeated.code).toBe(0);
    expect(repeated.stdout).toContain(
      'Pending: 0 options, 0 answer links, 0 attempt versions.',
    );
    expect(
      await prisma.option.findMany({ orderBy: { position: 'asc' } }),
    ).toEqual(options);
    expect(await prisma.attemptAnswer.findRaw()).toEqual(convertedAnswers);
    expect(await prisma.attempt.findRaw()).toEqual(convertedAttempts);

    // A later answer edit changes the ID while the retained legacy index stays
    // historical. Rerunning must preserve the current selection and timestamp.
    await prisma.attemptAnswer.update({
      where: { id: fixture.answerId },
      data: { selectedOptionId: options[0].id },
    });
    const editedAnswer = await prisma.attemptAnswer.findRaw();
    const afterEdit = await runMigration(true);
    expect(afterEdit.code).toBe(0);
    expect(afterEdit.stdout).toContain(
      'Pending: 0 options, 0 answer links, 0 attempt versions.',
    );
    expect(await prisma.attemptAnswer.findRaw()).toEqual(editedAnswer);
    expect(
      await prisma.attemptAnswer.findUniqueOrThrow({
        where: { id: fixture.answerId },
      }),
    ).toEqual(expect.objectContaining({ selectedOptionId: options[0].id }));
  }, 120_000);

  it('rejects an invalid answer index before creating any Options', async () => {
    await createLegacyFixture(99);
    const legacyAnswers = await prisma.attemptAnswer.findRaw();
    const legacyAttempts = await prisma.attempt.findRaw();
    const applied = await runMigration(true);
    expect(applied.code).toBe(1);
    expect(applied.stderr).toContain('selectedOptionIndex cannot be mapped');
    expect(await prisma.option.count()).toBe(0);
    expect(await prisma.attemptAnswer.findRaw()).toEqual(legacyAnswers);
    expect(await prisma.attempt.findRaw()).toEqual(legacyAttempts);
  }, 60_000);
});
