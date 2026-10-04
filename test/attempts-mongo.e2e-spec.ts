import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AttemptStatus, ExamStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Opt in with a dedicated disposable database, never the application's DATABASE_URL.
const databaseUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = databaseUrl ? describe : describe.skip;

describeMongo('Attempts with real MongoDB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let studentId: string;
  let examId: string;
  let questionIds: string[];

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
    const student = await prisma.user.create({
      data: {
        email: `student-${suffix}@example.com`,
        fullName: 'Integration Student',
        passwordHash: 'unused-in-token-tests',
      },
    });
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
    if (app) await app.close();
    else if (prisma) await prisma.$disconnect();
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

  it('grades an expired attempt through GET result and retains the exam relation', async () => {
    const session = await start().expect(201);
    const attemptId = session.body.attempt.id;
    await save(attemptId, questionIds[0], 1).expect(200);
    const deadlineAt = new Date(Date.now() - 1000);
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt },
    });
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
});
