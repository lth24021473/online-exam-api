import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AttemptStatus, ExamStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AttemptsService } from '../src/attempts/attempts.service';
import { AttemptsRepository } from '../src/attempts/attempts.repository';

// Opt in with a dedicated disposable database, never the application's DATABASE_URL.
const databaseUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = databaseUrl ? describe : describe.skip;

describeMongo('Attempts with real MongoDB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let managerToken: string;
  let studentId: string;
  let examId: string;
  let questionIds: string[];
  const ownedUserIds: string[] = [];

  beforeAll(async () => {
    if (
      !databaseUrl ||
      !new URL(databaseUrl).pathname.endsWith('_codex_test')
    ) {
      throw new Error(
        'MONGO_TEST_DATABASE_URL must use a database ending in _codex_test',
      );
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const suffix = `${Date.now()}-${process.pid}`;
    const manager = await prisma.user.create({
      data: {
        email: `manager-${suffix}@example.com`,
        fullName: 'Integration Manager',
        passwordHash: 'unused-in-token-tests',
        role: Role.EXAM_MANAGER,
      },
    });
    ownedUserIds.push(manager.id);
    managerToken = app.get(JwtService).sign({
      sub: manager.id,
      email: manager.email,
      role: Role.EXAM_MANAGER,
    });
    const student = await prisma.user.create({
      data: {
        email: `student-${suffix}@example.com`,
        fullName: 'Integration Student',
        passwordHash: 'unused-in-token-tests',
      },
    });
    ownedUserIds.push(student.id);
    studentId = student.id;
    token = app.get(JwtService).sign({
      sub: student.id,
      email: student.email,
      role: Role.STUDENT,
    });
    const exam = await prisma.exam.create({
      data: {
        title: 'Mongo integration exam',
        durationMinutes: 15,
        status: ExamStatus.PUBLISHED,
        managerId: manager.id,
        questions: {
          create: [1, 2].map((position) => ({
            content: `Question ${position}`,
            position,
            options: {
              create: [
                { content: 'Wrong', position: 0, isCorrect: false },
                { content: 'Correct', position: 1, isCorrect: true },
              ],
            },
          })),
        },
      },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    examId = exam.id;
    questionIds = exam.questions.map((q) => q.id);
  }, 30000);

  afterAll(async () => {
    try {
      if (prisma && examId) {
        const attempts = await prisma.attempt.findMany({
          where: { examId },
          select: { id: true },
        });
        await prisma.attemptAnswer.deleteMany({
          where: { attemptId: { in: attempts.map(({ id }) => id) } },
        });
        await prisma.attempt.deleteMany({ where: { examId } });
        await prisma.option.deleteMany({
          where: { questionId: { in: questionIds } },
        });
        await prisma.question.deleteMany({ where: { examId } });
        await prisma.exam.deleteMany({ where: { id: examId } });
      }
      if (prisma && ownedUserIds.length) {
        await prisma.user.deleteMany({
          where: { id: { in: ownedUserIds } },
        });
      }
    } finally {
      if (app) await app.close();
      else if (prisma) await prisma.$disconnect();
    }
  });

  const start = () =>
    request(app.getHttpServer())
      .post(`/api/v1/exams/${examId}/attempts`)
      .set('Authorization', `Bearer ${token}`);
  const save = (attemptId: string, questionId: string, index: number) =>
    request(app.getHttpServer())
      .put(`/api/v1/attempts/${attemptId}/answers/${questionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ selectedOptionIndex: index });
  const submit = (attemptId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${token}`);

  it('resumes one attempt when start requests arrive concurrently', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => start().expect(201)),
    );
    const ids = new Set(responses.map(({ body }) => body.attempt.id));
    expect(ids.size).toBe(1);
    expect(
      responses.filter(({ body }) => body.resumed === false),
    ).toHaveLength(1);
    expect(
      await prisma.attempt.count({
        where: { userId: studentId, examId, status: AttemptStatus.IN_PROGRESS },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${responses[0].body.attempt.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('persists normalized options, changes answers and grades without exposing the key early', async () => {
    const session = await start().expect(201);
    expect(JSON.stringify(session.body)).not.toMatch(
      /isCorrect|correctOptionIndex/,
    );
    expect(session.body.questions[0].options).toEqual(['Wrong', 'Correct']);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 1).expect(200);
    await save(attemptId, questionIds[0], 0).expect(200);
    await save(attemptId, questionIds[1], 1).expect(200);
    expect(await prisma.attemptAnswer.count({ where: { attemptId } })).toBe(2);
    const result = await submit(attemptId).expect(200);
    expect(result.body.summary).toMatchObject({
      score: 5,
      correctCount: 1,
      incorrectCount: 1,
    });
    expect(
      result.body.questions.map((q: { isCorrect: boolean }) => q.isCorrect),
    ).toEqual([false, true]);
    await save(attemptId, questionIds[0], 1).expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${attemptId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect((await submit(attemptId).expect(200)).body.summary).toEqual(
      result.body.summary,
    );
  });

  it('soft-cancels and retains both the attempt and saved answers in history', async () => {
    const session = await start().expect(201);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 1).expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${attemptId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    const stored = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(stored.status).toBe(AttemptStatus.CANCELLED);
    expect(stored.cancelledAt).toBeInstanceOf(Date);
    expect(await prisma.attemptAnswer.count({ where: { attemptId } })).toBe(1);
    await save(attemptId, questionIds[0], 0).expect(409);
    await submit(attemptId).expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/attempts/${attemptId}/result`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    const history = await request(app.getHttpServer())
      .get('/api/v1/attempts?status=CANCELLED')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(history.body.items.map((a: { id: string }) => a.id)).toContain(
      attemptId,
    );
  });

  it('prevents cancellation after expiry and grades saved answers through GET result', async () => {
    const session = await start().expect(201);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 1).expect(200);
    const deadlineAt = new Date(Date.now() - 1000);
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt },
    });
    // The database guard also protects a cancellation that reaches MongoDB
    // after the deadline, even if its service check ran just before expiry.
    expect(
      await app.get(AttemptsRepository).cancelInProgress(attemptId, studentId),
    ).toBe(0);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${attemptId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(
      await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } }),
    ).toMatchObject({ status: AttemptStatus.IN_PROGRESS, cancelledAt: null });
    expect(await prisma.attemptAnswer.count({ where: { attemptId } })).toBe(1);
    const result = await request(app.getHttpServer())
      .get(`/api/v1/attempts/${attemptId}/result`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(result.body.attempt).toMatchObject({
      status: 'SUBMITTED',
      examTitle: 'Mongo integration exam',
      submittedAt: deadlineAt.toISOString(),
    });
    expect(result.body.summary).toMatchObject({ score: 5, unansweredCount: 1 });
  });

  it('keeps grading consistent when answer changes race with concurrent submissions', async () => {
    const session = await start().expect(201);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 0).expect(200);
    const responses = await Promise.all([
      save(attemptId, questionIds[0], 1),
      submit(attemptId),
      submit(attemptId),
    ]);
    expect([200, 409]).toContain(responses[0].status);
    expect(responses[1].status).toBe(200);
    expect(responses[2].status).toBe(200);
    const result = await submit(attemptId).expect(200);
    const correctCount = result.body.questions.filter(
      (q: { isCorrect: boolean }) => q.isCorrect,
    ).length;
    expect(result.body.summary.correctCount).toBe(correctCount);
    expect(result.body.summary.score).toBe(correctCount * 5);
    const stored = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(stored.userId).toBe(studentId);
    expect(stored.correctCount).toBe(correctCount);
    await save(attemptId, questionIds[0], 0).expect(409);
  });

  it('finalizes expired exam results through the same grading flow and preserves a live attempt', async () => {
    const expiredAt = new Date(Date.now() - 1000);
    const expired = await Promise.all(
      [1, 2].map(() => prisma.attempt.create({
        data: {
          userId: studentId,
          examId,
          deadlineAt: expiredAt,
          totalQuestions: 2,
        },
      })),
    );
    const option = await prisma.option.findFirstOrThrow({
      where: { questionId: questionIds[0], isCorrect: true },
    });
    await prisma.attemptAnswer.create({
      data: {
        attemptId: expired[0].id,
        questionId: questionIds[0],
        selectedOptionId: option.id,
      },
    });
    const live = await prisma.attempt.create({
      data: {
        userId: studentId,
        examId,
        deadlineAt: new Date(Date.now() + 60000),
        totalQuestions: 2,
      },
    });
    await app.get(AttemptsService).finalizeExpiredForExam(examId);
    for (const [index, fixture] of expired.entries()) {
      const stored = await prisma.attempt.findUniqueOrThrow({
        where: { id: fixture.id },
      });
      expect(stored.status).toBe(AttemptStatus.SUBMITTED);
      expect(stored.score).toBe(index === 0 ? 5 : 0);
      expect(stored.submittedAt?.getTime()).toBe(expiredAt.getTime());
    }
    expect(
      (await prisma.attempt.findUniqueOrThrow({ where: { id: live.id } })).status,
    ).toBe(AttemptStatus.IN_PROGRESS);
  });

  it('allows reload/resume after the manager closes an exam, then blocks a new attempt', async () => {
    const session = await start().expect(201);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 1).expect(200);
    try {
      await request(app.getHttpServer())
        .put(`/api/v1/exams/${examId}/close`)
        .auth(managerToken, { type: 'bearer' })
        .expect(200);
      const resumed = await start().expect(201);
      expect(resumed.body.resumed).toBe(true);
      expect(resumed.body.attempt.id).toBe(attemptId);
      expect(resumed.body.attempt.deadlineAt).toBe(session.body.attempt.deadlineAt);
      expect(resumed.body.answers).toEqual([
        { questionId: questionIds[0], selectedOptionIndex: 1 },
      ]);
      const result = await submit(attemptId).expect(200);
      expect(result.body.summary.score).toBe(5);
      await start().expect(409);
    } finally {
      await prisma.exam.update({
        where: { id: examId },
        data: { status: ExamStatus.PUBLISHED, closedAt: null },
      });
    }
  });

  it('does not create a new attempt when closure wins after the service reads published metadata', async () => {
    const repository = app.get(AttemptsRepository);
    const original = repository.findExamForStart.bind(repository);
    const spy = jest.spyOn(repository, 'findExamForStart').mockImplementationOnce(
      async (id) => {
        const published = await original(id);
        await request(app.getHttpServer())
          .put(`/api/v1/exams/${examId}/close`)
          .auth(managerToken, { type: 'bearer' })
          .expect(200);
        return published;
      },
    );
    try {
      await start().expect(409);
      expect(await prisma.attempt.count({
        where: { userId: studentId, examId, status: AttemptStatus.IN_PROGRESS },
      })).toBe(0);
    } finally {
      spy.mockRestore();
      await prisma.exam.update({
        where: { id: examId },
        data: { status: ExamStatus.PUBLISHED, closedAt: null },
      });
    }
  });
});
