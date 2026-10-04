import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Attempt, AttemptStatus, ExamStatus, Role } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AttemptsRepository } from '../src/attempts/attempts.repository';
import { PrismaService } from '../src/database/prisma.service';

const STUDENT_ID = '111111111111111111111111';
const OTHER_STUDENT_ID = '222222222222222222222222';
const MANAGER_ID = '333333333333333333333333';
const EXAM_ID = '444444444444444444444444';
const QUESTION_IDS = ['555555555555555555555555', '666666666666666666666666'];

type OptionFixture = {
  id: string;
  content: string;
  position: number;
  isCorrect: boolean;
};
type QuestionFixture = {
  id: string;
  examId: string;
  content: string;
  position: number;
  options: OptionFixture[];
};
type AnswerFixture = {
  questionId: string;
  selectedOptionId: string;
  updatedAt: Date;
  selectedOption: { position: number };
};
type AttemptWithExam = Attempt & { exam: { id: string; title: string } };
type Grade = {
  submittedAt: Date;
  score: number;
  correctCount: number;
  incorrectCount: number;
};
type SessionResponse = {
  resumed: boolean;
  attempt: { id: string; status: AttemptStatus; totalQuestions: number };
  questions: { id: string; options: string[] }[];
  answers: { questionId: string; selectedOptionIndex: number }[];
};
type ResultResponse = {
  attempt: { id: string; status: AttemptStatus; examTitle: string };
  summary: {
    score: number;
    maxScore: number;
    totalQuestions: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
  };
  questions: {
    id: string;
    options: string[];
    selectedOptionIndex: number | null;
    correctOptionIndex: number;
    isCorrect: boolean;
  }[];
};

/** Persistence fake: exercise the real module, service, JWT/role guards and DTOs. */
class InMemoryAttemptsRepository {
  readonly attempts = new Map<string, AttemptWithExam>();
  readonly answers = new Map<string, AnswerFixture[]>();
  readonly exam = {
    id: EXAM_ID,
    title: 'Sample exam',
    instructions: 'Select one answer per question.',
    durationMinutes: 30,
    status: ExamStatus.PUBLISHED,
    _count: { questions: 2 },
  };
  readonly questions: QuestionFixture[] = [
    {
      id: QUESTION_IDS[0],
      examId: EXAM_ID,
      content: '1 + 1 = ?',
      position: 0,
      options: [
        {
          id: '777777777777777777777777',
          content: '1',
          position: 0,
          isCorrect: false,
        },
        {
          id: '888888888888888888888888',
          content: '2',
          position: 1,
          isCorrect: true,
        },
      ],
    },
    {
      id: QUESTION_IDS[1],
      examId: EXAM_ID,
      content: '2 + 2 = ?',
      position: 1,
      options: [
        {
          id: '999999999999999999999999',
          content: '4',
          position: 0,
          isCorrect: true,
        },
        {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          content: '5',
          position: 1,
          isCorrect: false,
        },
      ],
    },
  ];

  findExamForStart(examId: string) {
    return examId === EXAM_ID ? this.exam : null;
  }

  findInProgress(userId: string, examId: string) {
    return (
      [...this.attempts.values()].find(
        (attempt) =>
          attempt.userId === userId &&
          attempt.examId === examId &&
          attempt.status === AttemptStatus.IN_PROGRESS,
      ) ?? null
    );
  }

  create(data: {
    userId: string;
    examId: string;
    deadlineAt: Date;
    totalQuestions: number;
  }) {
    const id = (this.attempts.size + 1).toString(16).padStart(24, '0');
    const attempt: AttemptWithExam = {
      id,
      ...data,
      status: AttemptStatus.IN_PROGRESS,
      startedAt: new Date(),
      submittedAt: null,
      cancelledAt: null,
      answerVersion: 0,
      score: null,
      correctCount: null,
      incorrectCount: null,
      exam: { id: EXAM_ID, title: this.exam.title },
    };
    this.attempts.set(id, attempt);
    this.answers.set(id, []);
    return { ...attempt };
  }

  findById(id: string) {
    const attempt = this.attempts.get(id);
    return attempt ? { ...attempt } : null;
  }

  listQuestions(examId: string) {
    return this.questions
      .filter((question) => question.examId === examId)
      .map(({ id, content, position, options }) => ({
        id,
        content,
        position,
        options: options.map(
          ({
            id: optionId,
            content: optionContent,
            position: optionPosition,
          }) => ({
            id: optionId,
            content: optionContent,
            position: optionPosition,
          }),
        ),
      }));
  }

  listQuestionsWithKey(examId: string) {
    return this.questions.filter((question) => question.examId === examId);
  }

  findQuestionInExam(examId: string, questionId: string) {
    const question = this.questions.find(
      (item) => item.examId === examId && item.id === questionId,
    );
    return question
      ? {
          id: question.id,
          options: question.options.map(({ id, position }) => ({
            id,
            position,
          })),
        }
      : null;
  }

  listAnswers(attemptId: string) {
    return this.answers.get(attemptId) ?? [];
  }

  upsertAnswer(
    attemptId: string,
    userId: string,
    questionId: string,
    selectedOptionId: string,
  ) {
    const attempt = this.attempts.get(attemptId);
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.status !== AttemptStatus.IN_PROGRESS
    ) {
      throw new ConflictException('Attempt is not in progress');
    }
    const option = this.questions
      .find((item) => item.id === questionId)!
      .options.find((item) => item.id === selectedOptionId)!;
    const answer: AnswerFixture = {
      questionId,
      selectedOptionId,
      updatedAt: new Date(),
      selectedOption: { position: option.position },
    };
    const answers = this.listAnswers(attemptId);
    const previousIndex = answers.findIndex(
      (item) => item.questionId === questionId,
    );
    if (previousIndex === -1) answers.push(answer);
    else answers[previousIndex] = answer;
    this.answers.set(attemptId, answers);
    attempt.answerVersion += 1;
    return answer;
  }

  cancelInProgress(attemptId: string, userId: string) {
    const attempt = this.attempts.get(attemptId);
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.status !== AttemptStatus.IN_PROGRESS
    )
      return 0;
    attempt.status = AttemptStatus.CANCELLED;
    attempt.cancelledAt = new Date();
    return 1;
  }

  async submitInProgress(
    attemptId: string,
    userId: string,
    grade: (
      questions: QuestionFixture[],
      answers: AnswerFixture[],
      attempt: AttemptWithExam,
    ) => Grade | Promise<Grade>,
  ) {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.userId !== userId) return null;
    if (attempt.status !== AttemptStatus.IN_PROGRESS) return { ...attempt };
    const result = await grade(
      this.listQuestionsWithKey(attempt.examId),
      this.listAnswers(attemptId),
      attempt,
    );
    Object.assign(attempt, result, { status: AttemptStatus.SUBMITTED });
    return { ...attempt };
  }

  history(
    where: { userId?: string; examId?: string; status?: AttemptStatus },
    skip: number,
    take: number,
  ) {
    const items = [...this.attempts.values()]
      .filter(
        (attempt) =>
          (!where.userId || attempt.userId === where.userId) &&
          (!where.examId || attempt.examId === where.examId) &&
          (!where.status || attempt.status === where.status),
      )
      .sort(
        (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
      );
    return { items: items.slice(skip, skip + take), total: items.length };
  }
}

describe('Attempts HTTP API (e2e, in-memory persistence)', () => {
  let app: INestApplication<App>;
  let repo: InMemoryAttemptsRepository;
  let studentToken: string;
  let otherStudentToken: string;
  let managerToken: string;
  let revokedTokenLookup: jest.Mock;
  const previousSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'attempts-e2e-test-secret';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  beforeEach(async () => {
    repo = new InMemoryAttemptsRepository();
    revokedTokenLookup = jest.fn().mockResolvedValue(null);
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ revokedToken: { findUnique: revokedTokenLookup } })
      .overrideProvider(AttemptsRepository)
      .useValue(repo)
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    const jwt = app.get(JwtService);
    studentToken = jwt.sign({
      sub: STUDENT_ID,
      email: 'student@example.test',
      role: Role.STUDENT,
    });
    otherStudentToken = jwt.sign({
      sub: OTHER_STUDENT_ID,
      email: 'other@example.test',
      role: Role.STUDENT,
    });
    managerToken = jwt.sign({
      sub: MANAGER_ID,
      email: 'manager@example.test',
      role: Role.EXAM_MANAGER,
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  async function start(token = studentToken): Promise<SessionResponse> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/exams/${EXAM_ID}/attempts`)
      .auth(token, { type: 'bearer' })
      .expect(201);
    return response.body as SessionResponse;
  }

  function save(
    attemptId: string,
    questionId: string,
    selectedOptionIndex: number,
    token = studentToken,
  ) {
    return request(app.getHttpServer())
      .put(`/api/v1/attempts/${attemptId}/answers/${questionId}`)
      .auth(token, { type: 'bearer' })
      .send({ selectedOptionIndex });
  }

  it('registers attempt routes and completes start, resume, change answer, submit, result and history', async () => {
    const session = await start();
    expect(session.resumed).toBe(false);
    expect(session.attempt).toMatchObject({
      status: AttemptStatus.IN_PROGRESS,
      totalQuestions: 2,
    });
    expect(session.questions).toHaveLength(2);
    expect(session.questions[0].options).toEqual(['1', '2']);
    expect(JSON.stringify(session)).not.toMatch(/correctOptionIndex|isCorrect/);

    await save(session.attempt.id, QUESTION_IDS[0], 0).expect(200);
    const changed = await save(session.attempt.id, QUESTION_IDS[0], 1).expect(
      200,
    );
    expect(changed.body).toMatchObject({
      questionId: QUESTION_IDS[0],
      selectedOptionIndex: 1,
    });
    await save(session.attempt.id, QUESTION_IDS[1], 0).expect(200);
    expect(repo.listAnswers(session.attempt.id)).toHaveLength(2);
    expect(repo.listAnswers(session.attempt.id)[0].selectedOptionId).toBe(
      '888888888888888888888888',
    );

    const resumed = await start();
    expect(resumed.resumed).toBe(true);
    expect(resumed.attempt.id).toBe(session.attempt.id);
    expect(resumed.answers).toEqual([
      { questionId: QUESTION_IDS[0], selectedOptionIndex: 1 },
      { questionId: QUESTION_IDS[1], selectedOptionIndex: 0 },
    ]);
    expect(JSON.stringify(resumed)).not.toMatch(/correctOptionIndex|isCorrect/);

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    const result = submitted.body as ResultResponse;
    expect(result.attempt).toMatchObject({
      status: AttemptStatus.SUBMITTED,
      examTitle: 'Sample exam',
    });
    expect(result.summary).toEqual({
      score: 10,
      maxScore: 10,
      totalQuestions: 2,
      correctCount: 2,
      incorrectCount: 0,
      unansweredCount: 0,
    });
    expect(
      result.questions.map(({ correctOptionIndex, isCorrect }) => ({
        correctOptionIndex,
        isCorrect,
      })),
    ).toEqual([
      { correctOptionIndex: 1, isCorrect: true },
      { correctOptionIndex: 0, isCorrect: true },
    ]);
    await request(app.getHttpServer())
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200)
      .expect(result);
    await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200)
      .expect(result);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/attempts?status=SUBMITTED&examId=${EXAM_ID}&page=1&limit=1`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(history.body.meta).toEqual({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({
      id: session.attempt.id,
      status: AttemptStatus.SUBMITTED,
      score: 10,
    });
    await save(session.attempt.id, QUESTION_IDS[0], 0).expect(409);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${session.attempt.id}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(409);
    expect(repo.attempts.get(session.attempt.id)?.status).toBe(
      AttemptStatus.SUBMITTED,
    );
  });

  it('counts unanswered questions against the full question count', async () => {
    const session = await start();
    await save(session.attempt.id, QUESTION_IDS[0], 1).expect(200);
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(submitted.body.summary).toMatchObject({
      score: 5,
      correctCount: 1,
      incorrectCount: 1,
      unansweredCount: 1,
    });
    expect(submitted.body.questions[1]).toMatchObject({
      selectedOptionIndex: null,
      isCorrect: false,
    });
  });

  it('marks a saved wrong answer incorrect and awards partial credit', async () => {
    const session = await start();
    await save(session.attempt.id, QUESTION_IDS[0], 0).expect(200);
    await save(session.attempt.id, QUESTION_IDS[1], 0).expect(200);
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(submitted.body.summary).toMatchObject({
      score: 5,
      correctCount: 1,
      incorrectCount: 1,
      unansweredCount: 0,
    });
    expect(submitted.body.questions[0]).toMatchObject({
      selectedOptionIndex: 0,
      correctOptionIndex: 1,
      isCorrect: false,
    });
  });

  it('finalizes an expired attempt before starting a new one and paginates history', async () => {
    const session = await start();
    const expired = repo.attempts.get(session.attempt.id)!;
    expired.startedAt = new Date(Date.now() - 60_000);
    expired.deadlineAt = new Date(Date.now() - 1_000);
    const nextSession = await start();
    expect(nextSession.resumed).toBe(false);
    expect(nextSession.attempt.id).not.toBe(session.attempt.id);
    expect(expired.status).toBe(AttemptStatus.SUBMITTED);
    expect(expired.score).toBe(0);
    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/attempts?page=1&limit=1')
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/attempts?page=2&limit=1')
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(firstPage.body.meta).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
    expect(firstPage.body.items[0].id).toBe(nextSession.attempt.id);
    expect(secondPage.body.items[0].id).toBe(session.attempt.id);
  });

  it('keeps a cancelled attempt and its answers, blocks further use and starts a fresh attempt', async () => {
    const session = await start();
    await save(session.attempt.id, QUESTION_IDS[0], 1).expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${session.attempt.id}`)
      .auth(studentToken, { type: 'bearer' })
      .expect(204);
    expect(repo.attempts.get(session.attempt.id)).toMatchObject({
      status: AttemptStatus.CANCELLED,
      cancelledAt: expect.any(Date),
      submittedAt: null,
      score: null,
    });
    expect(repo.listAnswers(session.attempt.id)).toHaveLength(1);
    await save(session.attempt.id, QUESTION_IDS[0], 0).expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(studentToken, { type: 'bearer' })
      .expect(409);
    await request(app.getHttpServer())
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(studentToken, { type: 'bearer' })
      .expect(409);
    const history = await request(app.getHttpServer())
      .get('/api/v1/attempts?status=CANCELLED')
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({
      id: session.attempt.id,
      status: AttemptStatus.CANCELLED,
    });
    const nextSession = await start();
    expect(nextSession.resumed).toBe(false);
    expect(nextSession.attempt.id).not.toBe(session.attempt.id);
    expect(repo.attempts).toHaveProperty('size', 2);
  });

  it('protects all attempt endpoints with JWT authentication', async () => {
    const session = await start();
    const server = app.getHttpServer();
    await request(server).post(`/api/v1/exams/${EXAM_ID}/attempts`).expect(401);
    await request(server).get('/api/v1/attempts').expect(401);
    await request(server)
      .put(`/api/v1/attempts/${session.attempt.id}/answers/${QUESTION_IDS[0]}`)
      .send({ selectedOptionIndex: 0 })
      .expect(401);
    await request(server)
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .expect(401);
    await request(server)
      .delete(`/api/v1/attempts/${session.attempt.id}`)
      .expect(401);
    await request(server)
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .expect(401);
  });

  it('rejects invalid and revoked JWT tokens with the real guard', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/attempts')
      .auth('invalid-token', { type: 'bearer' })
      .expect(401);
    revokedTokenLookup.mockResolvedValue({
      tokenHash: 'revoked',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await request(app.getHttpServer())
      .get('/api/v1/attempts')
      .auth(studentToken, { type: 'bearer' })
      .expect(401);
  });

  it('denies exam managers access to student attempt endpoints', async () => {
    const session = await start();
    const server = app.getHttpServer();
    await request(server)
      .post(`/api/v1/exams/${EXAM_ID}/attempts`)
      .auth(managerToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get('/api/v1/attempts')
      .auth(managerToken, { type: 'bearer' })
      .expect(403);
    await save(session.attempt.id, QUESTION_IDS[0], 0, managerToken).expect(
      403,
    );
    await request(server)
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(managerToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .delete(`/api/v1/attempts/${session.attempt.id}`)
      .auth(managerToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(managerToken, { type: 'bearer' })
      .expect(403);
  });

  it("hides another student's attempt and excludes it from their history", async () => {
    const session = await start();
    await save(
      session.attempt.id,
      QUESTION_IDS[0],
      0,
      otherStudentToken,
    ).expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/attempts/${session.attempt.id}/submit`)
      .auth(otherStudentToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/attempts/${session.attempt.id}`)
      .auth(otherStudentToken, { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(otherStudentToken, { type: 'bearer' })
      .expect(404);
    const history = await request(app.getHttpServer())
      .get('/api/v1/attempts')
      .auth(otherStudentToken, { type: 'bearer' })
      .expect(200);
    expect(history.body.items).toEqual([]);
    expect(history.body.meta.total).toBe(0);
    expect(repo.attempts.get(session.attempt.id)?.status).toBe(
      AttemptStatus.IN_PROGRESS,
    );
    expect(repo.listAnswers(session.attempt.id)).toEqual([]);
  });

  it.each([-1, 0.5, '1', null])(
    'rejects invalid selected option value %p',
    async (selectedOptionIndex) => {
      const session = await start();
      await request(app.getHttpServer())
        .put(
          `/api/v1/attempts/${session.attempt.id}/answers/${QUESTION_IDS[0]}`,
        )
        .auth(studentToken, { type: 'bearer' })
        .send({ selectedOptionIndex })
        .expect(400);
      expect(repo.listAnswers(session.attempt.id)).toEqual([]);
    },
  );

  it('rejects out-of-range options, missing fields, extra fields and foreign questions', async () => {
    const session = await start();
    await save(session.attempt.id, QUESTION_IDS[0], 2).expect(409);
    await request(app.getHttpServer())
      .put(`/api/v1/attempts/${session.attempt.id}/answers/${QUESTION_IDS[0]}`)
      .auth(studentToken, { type: 'bearer' })
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/attempts/${session.attempt.id}/answers/${QUESTION_IDS[0]}`)
      .auth(studentToken, { type: 'bearer' })
      .send({ selectedOptionIndex: 0, userId: OTHER_STUDENT_ID })
      .expect(400);
    await save(session.attempt.id, 'bbbbbbbbbbbbbbbbbbbbbbbb', 0).expect(404);
    expect(repo.listAnswers(session.attempt.id)).toEqual([]);
  });

  it('prevents review before submission and saving after the deadline, then grades at the deadline', async () => {
    const session = await start();
    await save(session.attempt.id, QUESTION_IDS[0], 1).expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(studentToken, { type: 'bearer' })
      .expect(409);
    const attempt = repo.attempts.get(session.attempt.id)!;
    const deadline = new Date(Date.now() - 1_000);
    attempt.deadlineAt = deadline;
    await save(session.attempt.id, QUESTION_IDS[0], 0).expect(409);
    const result = await request(app.getHttpServer())
      .get(`/api/v1/attempts/${session.attempt.id}/result`)
      .auth(studentToken, { type: 'bearer' })
      .expect(200);
    expect(result.body.summary).toMatchObject({ score: 5, correctCount: 1 });
    expect(repo.attempts.get(session.attempt.id)?.submittedAt).toEqual(
      deadline,
    );
  });
});
