import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AttemptStatus, ExamStatus, Role, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

const databaseUrl = process.env.MONGO_TEST_DATABASE_URL;
const describeMongo = databaseUrl ? describe : describe.skip;

describeMongo('Exam management with real MongoDB', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let manager: User;
  let stranger: User;
  let student: User;
  let admin: User;
  const ownedUsers: string[] = [];
  const ownedExams: string[] = [];
  const api = '/api/v1';

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Missing MONGO_TEST_DATABASE_URL');
    const url = new URL(databaseUrl);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !url.pathname.endsWith('_codex_test')
    ) {
      throw new Error(
        'Exam tests require loopback MongoDB and a _codex_test database',
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
    jwt = app.get(JwtService);
    [manager, stranger, student, admin] = await Promise.all([
      createUser(Role.EXAM_MANAGER),
      createUser(Role.EXAM_MANAGER),
      createUser(Role.STUDENT),
      createUser(Role.ADMIN),
    ]);
  }, 30000);

  async function createUser(role: Role) {
    const user = await prisma.user.create({
      data: {
        email: `exam-management-${randomUUID()}@example.com`,
        fullName: `Test ${role}`,
        passwordHash: 'unused-by-signed-token-fixture',
        role,
      },
    });
    ownedUsers.push(user.id);
    return user;
  }
  const token = (user: User) =>
    jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
    });
  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    user = manager,
  ) =>
    request(app.getHttpServer())
      [method](`${api}${path}`)
      .auth(token(user), { type: 'bearer' });
  async function draft(user = manager) {
    const response = await call('post', '/exams', user)
      .send({ title: `Test exam ${randomUUID()}`, durationMinutes: 10 })
      .expect(201);
    const id = response.body.id as string;
    ownedExams.push(id);
    return id;
  }
  async function question(examId: string, position = 1) {
    const response = await call('post', `/exams/${examId}/questions`)
      .send({
        content: '2 + 2 = ?',
        options: ['3', '4'],
        correctOptionIndex: 1,
        position,
      })
      .expect(201);
    return response.body as {
      id: string;
      options: { id: string; content: string; isCorrect: boolean }[];
    };
  }
  async function publish(examId: string) {
    await call('put', `/exams/${examId}/publish`).expect(200);
  }

  afterAll(async () => {
    if (prisma) {
      const questions = await prisma.question.findMany({
        where: { examId: { in: ownedExams } },
        select: { id: true },
      });
      const attempts = await prisma.attempt.findMany({
        where: { examId: { in: ownedExams } },
        select: { id: true },
      });
      await prisma.$transaction(async (tx) => {
        await tx.attemptAnswer.deleteMany({
          where: { attemptId: { in: attempts.map((entry) => entry.id) } },
        });
        await tx.attempt.deleteMany({
          where: { id: { in: attempts.map((entry) => entry.id) } },
        });
        await tx.option.deleteMany({
          where: { questionId: { in: questions.map((entry) => entry.id) } },
        });
        await tx.question.deleteMany({
          where: { id: { in: questions.map((entry) => entry.id) } },
        });
        await tx.exam.deleteMany({ where: { id: { in: ownedExams } } });
        await tx.user.deleteMany({ where: { id: { in: ownedUsers } } });
      });
    }
    if (app) await app.close();
    else if (prisma) await prisma.$disconnect();
  });

  it('supports draft metadata/options edits, review and publish without leaking answer keys', async () => {
    const id = await draft();
    await call('patch', `/exams/${id}`)
      .send({ title: 'Updated exam', durationMinutes: 15 })
      .expect(200);
    const q = await question(id);
    const changed = await call('patch', `/exams/${id}/questions/${q.id}`)
      .send({ options: ['2', '4', '6'], correctOptionIndex: 1 })
      .expect(200);
    expect(changed.body.options).toHaveLength(3);
    expect(
      changed.body.options.filter(
        (option: { isCorrect: boolean }) => option.isCorrect,
      ),
    ).toHaveLength(1);
    expect(
      await prisma.option.count({
        where: { id: { in: q.options.map((option) => option.id) } },
      }),
    ).toBe(0);
    await publish(id);
    const detail = await call('get', `/exams/${id}`, student).expect(200);
    expect(detail.body.title).toBe('Updated exam');
    expect(
      detail.body.questions[0].options.map(
        (option: { content: string }) => option.content,
      ),
    ).toEqual(['2', '4', '6']);
    expect(JSON.stringify(detail.body)).not.toMatch(
      /isCorrect|correctOptionIndex/,
    );
    const review = await call('get', `/exams/${id}/questions`).expect(200);
    expect(review.body[0].options[1].isCorrect).toBe(true);
    await call('patch', `/exams/${id}`)
      .send({ durationMinutes: 99 })
      .expect(400);
    await call('patch', `/exams/${id}/questions/${q.id}`)
      .send({ content: 'Changed' })
      .expect(400);
    await call('delete', `/exams/${id}/questions/${q.id}`).expect(400);
    await call('delete', `/exams/${id}`).expect(400);
    await call('put', `/exams/${id}/close`).expect(200);
    await call('get', `/exams/${id}`, student).expect(403);
  });

  it('rejects malformed IDs and inaccessible empty result sets before accessing attempts', async () => {
    const id = await draft();
    await call('get', `/exams/${id}/results`, stranger).expect(403);
    await call('get', `/exams/${id}/results`, student).expect(403);
    await call('get', '/exams/invalid/results').expect(400);
    const results = await call('get', `/exams/${id}/results`, admin).expect(
      200,
    );
    expect(results.body.data).toEqual([]);
    expect(results.body.summary).toEqual({
      totalAttempts: 0,
      inProgressCount: 0,
      submittedCount: 0,
      cancelledCount: 0,
      averageScore: null,
      highestScore: null,
      lowestScore: null,
    });
  });

  it('returns paginated safe identities, persisted grades and exam-wide statistics', async () => {
    const id = await draft();
    await question(id);
    await publish(id);
    const startedAt = new Date();
    const deadlineAt = new Date(Date.now() + 600000);
    for (const score of [5, 10]) {
      await prisma.attempt.create({
        data: {
          examId: id,
          userId: student.id,
          status: AttemptStatus.SUBMITTED,
          startedAt,
          deadlineAt,
          submittedAt: new Date(),
          score,
          totalQuestions: 2,
          correctCount: score / 5,
          incorrectCount: 2 - score / 5,
        },
      });
    }
    await prisma.attempt.create({
      data: {
        examId: id,
        userId: student.id,
        status: AttemptStatus.CANCELLED,
        startedAt,
        deadlineAt,
        cancelledAt: new Date(),
        totalQuestions: 1,
      },
    });
    await prisma.attempt.create({
      data: {
        examId: id,
        userId: student.id,
        status: AttemptStatus.IN_PROGRESS,
        startedAt,
        deadlineAt,
        totalQuestions: 1,
      },
    });
    const results = await call(
      'get',
      `/exams/${id}/results?status=SUBMITTED&limit=1&page=2`,
    ).expect(200);
    expect(results.body.data).toHaveLength(1);
    expect(results.body.data[0].user).toEqual({
      id: student.id,
      email: student.email,
      fullName: student.fullName,
    });
    expect(results.body.data[0].score).toBe(5);
    expect(results.body.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(results.body.summary).toEqual({
      totalAttempts: 4,
      submittedCount: 2,
      inProgressCount: 1,
      cancelledCount: 1,
      averageScore: 7.5,
      highestScore: 10,
      lowestScore: 5,
    });
    expect(JSON.stringify(results.body)).not.toMatch(
      /passwordHash|authVersion|selectedOption|isCorrect/,
    );
  });

  it('cascades draft questions/options and only deletes the selected exam', async () => {
    const id = await draft();
    const preservedId = await draft();
    const q = await question(id);
    const preservedQuestion = await question(preservedId);
    await call('delete', `/exams/${id}/questions/${q.id}`).expect(204);
    expect(await prisma.option.count({ where: { questionId: q.id } })).toBe(0);
    await question(id, 2);
    await call('delete', `/exams/${id}`).expect(204);
    expect(await prisma.question.count({ where: { examId: id } })).toBe(0);
    expect(
      await prisma.option.count({ where: { question: { examId: id } } }),
    ).toBe(0);
    expect(
      await prisma.question.findUnique({ where: { id: preservedQuestion.id } }),
    ).not.toBeNull();
    expect(
      await prisma.option.count({
        where: { questionId: preservedQuestion.id },
      }),
    ).toBe(2);
  });

  it('blocks deleting a draft that already has attempts', async () => {
    const id = await draft();
    const q = await question(id);
    const attempt = await prisma.attempt.create({
      data: {
        examId: id,
        userId: student.id,
        status: AttemptStatus.CANCELLED,
        deadlineAt: new Date(),
        totalQuestions: 1,
      },
    });
    await call('delete', `/exams/${id}`).expect(409);
    expect(
      await prisma.attempt.findUnique({ where: { id: attempt.id } }),
    ).not.toBeNull();
    expect(await prisma.option.count({ where: { questionId: q.id } })).toBe(2);
  });

  it('rejects publishing persisted invalid answer keys', async () => {
    const id = await draft();
    const q = await question(id);
    await prisma.option.updateMany({
      where: { questionId: q.id },
      data: { isCorrect: true },
    });
    await call('put', `/exams/${id}/publish`).expect(400);
    expect(
      (await prisma.exam.findUniqueOrThrow({ where: { id } })).status,
    ).toBe(ExamStatus.DRAFT);
    await call('patch', `/exams/${id}/questions/${q.id}`)
      .send({ correctOptionIndex: 0 })
      .expect(200);
    await publish(id);
  });

  it('supports ADMIN authoring and ownership bypass without exposing draft to students', async () => {
    const id = await draft(admin);
    const q = await call('post', `/exams/${id}/questions`, admin)
      .send({
        content: 'Admin question',
        options: ['A', 'B'],
        correctOptionIndex: 0,
        position: 1,
      })
      .expect(201);
    await call('get', `/exams/${id}`, student).expect(403);
    await call('get', `/exams/${id}/questions`, stranger).expect(403);
    await call('patch', `/exams/${id}/questions/${q.body.id}`, admin)
      .send({ content: 'Edited by admin' })
      .expect(200);
    await call('put', `/exams/${id}/publish`, admin).expect(200);
    await call('get', `/exams/${id}/results`, admin).expect(200);
  });

  it('keeps the published question snapshot intact under concurrent publish and edit', async () => {
    const id = await draft();
    const q = await question(id);
    const [published, changed] = await Promise.all([
      call('put', `/exams/${id}/publish`),
      call('patch', `/exams/${id}/questions/${q.id}`).send({
        content: 'Concurrent edit',
      }),
    ]);
    expect(published.status).toBe(200);
    expect([200, 400]).toContain(changed.status);
    const snapshot = await prisma.question.findUniqueOrThrow({
      where: { id: q.id },
    });
    await call('patch', `/exams/${id}/questions/${q.id}`)
      .send({ content: 'Late edit' })
      .expect(400);
    expect(await prisma.question.findUnique({ where: { id: q.id } })).toEqual(
      snapshot,
    );
  });

  it('grades expired attempts for the authorized manager and keeps repeated results stable', async () => {
    const id = await draft();
    const q = await question(id);
    await publish(id);
    const started = await call('post', `/exams/${id}/attempts`, student).expect(
      201,
    );
    const attemptId = started.body.attempt.id as string;
    await call('put', `/attempts/${attemptId}/answers/${q.id}`, student)
      .send({ selectedOptionIndex: 1 })
      .expect(200);
    await prisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    await call('get', `/exams/${id}/results`, stranger).expect(403);
    expect(
      (await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } }))
        .status,
    ).toBe(AttemptStatus.IN_PROGRESS);
    const first = await call('get', `/exams/${id}/results`).expect(200);
    expect(first.body.data[0]).toMatchObject({
      id: attemptId,
      status: AttemptStatus.SUBMITTED,
      score: 10,
      totalQuestions: 1,
      correctCount: 1,
      incorrectCount: 0,
    });
    expect(first.body.summary).toMatchObject({
      submittedCount: 1,
      inProgressCount: 0,
      averageScore: 10,
    });
    const repeated = await call('get', `/exams/${id}/results`).expect(200);
    expect(repeated.body).toEqual(first.body);
  });
});
