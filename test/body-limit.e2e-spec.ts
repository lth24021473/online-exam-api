import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Attempt, AttemptStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AttemptsRepository } from '../src/attempts/attempts.repository';
import { PrismaService } from '../src/database/prisma.service';
import { ExamLeaderboardService } from '../src/exams/materialized-views/exam-leaderboard.service';
import { configureApp } from '../src/main';

const STUDENT_ID = '111111111111111111111111';
const EXAM_ID = '444444444444444444444444';
const ATTEMPT_ID = '777777777777777777777777';
const QUESTION_ID = '555555555555555555555555';
const OPTION_0_ID = '888888888888888888888888';
const OPTION_1_ID = '999999999999999999999999';

type ExpressRouterStack = {
  router?: {
    stack?: Array<{ handle?: { name?: string } }>;
  };
};

type AnswerFixture = {
  questionId: string;
  selectedOptionId: string;
  updatedAt: Date;
  selectedOption: { position: number };
};

type AttemptWithExam = Attempt & { exam: { id: string; title: string } };

function createInMemoryAttemptsRepo() {
  const attempt: AttemptWithExam = {
    id: ATTEMPT_ID,
    userId: STUDENT_ID,
    examId: EXAM_ID,
    status: AttemptStatus.IN_PROGRESS,
    startedAt: new Date(),
    deadlineAt: new Date(Date.now() + 30 * 60 * 1000),
    submittedAt: null,
    cancelledAt: null,
    totalQuestions: 1,
    answerVersion: 0,
    score: null,
    correctCount: null,
    incorrectCount: null,
    violationCount: 0,
    terminatedReason: null,
    shuffledMapping: null,
    exam: { id: EXAM_ID, title: 'Sample Exam' },
  };
  const answers: AnswerFixture[] = [];
  const questions = [
    {
      id: QUESTION_ID,
      examId: EXAM_ID,
      content: '2 + 2 = ?',
      position: 0,
      options: [
        { id: OPTION_0_ID, content: '3', position: 0, isCorrect: false },
        { id: OPTION_1_ID, content: '4', position: 1, isCorrect: true },
      ],
    },
  ];

  return {
    findById(id: string) {
      return id === attempt.id ? { ...attempt } : null;
    },
    findExpired() {
      return [];
    },
    findQuestionInExam(examId: string, questionId: string) {
      const q = questions.find(
        (item) => item.examId === examId && item.id === questionId,
      );
      return q
        ? {
            id: q.id,
            options: q.options.map(({ id, position }) => ({ id, position })),
          }
        : null;
    },
    upsertAnswer(
      attemptId: string,
      userId: string,
      questionId: string,
      selectedOptionId: string,
    ) {
      if (attempt.id !== attemptId || attempt.userId !== userId) {
        return null;
      }
      const option = questions[0].options.find(
        (o) => o.id === selectedOptionId,
      )!;
      const saved: AnswerFixture = {
        questionId,
        selectedOptionId,
        updatedAt: new Date(),
        selectedOption: { position: option.position },
      };
      const existingIndex = answers.findIndex(
        (item) => item.questionId === questionId,
      );
      if (existingIndex === -1) answers.push(saved);
      else answers[existingIndex] = saved;
      attempt.answerVersion += 1;
      return saved;
    },
    listQuestionsWithKey(examId: string) {
      return questions.filter((q) => q.examId === examId);
    },
    listAnswers(attemptId: string) {
      return attemptId === attempt.id ? [...answers] : [];
    },
    async submitInProgress(
      attemptId: string,
      userId: string,
      grade: (
        qs: typeof questions,
        ans: AnswerFixture[],
        current: AttemptWithExam,
      ) =>
        | {
            submittedAt: Date;
            score: number;
            correctCount: number;
            incorrectCount: number;
            terminatedReason?: string | null;
          }
        | Promise<{
            submittedAt: Date;
            score: number;
            correctCount: number;
            incorrectCount: number;
            terminatedReason?: string | null;
          }>,
    ) {
      if (attempt.id !== attemptId || attempt.userId !== userId) return null;
      if (attempt.status !== AttemptStatus.IN_PROGRESS) return { ...attempt };
      const result = await grade(
        this.listQuestionsWithKey(attempt.examId),
        this.listAnswers(attemptId),
        attempt,
      );
      Object.assign(attempt, result, { status: AttemptStatus.SUBMITTED });
      return { ...attempt };
    },
  };
}

describe('Body Parser 100KB Limit (e2e)', () => {
  let app: INestApplication<App>;
  let parserNamesBeforeConfigure: string[] = [];
  let parserNamesAfterConfigureBeforeInit: string[] = [];
  let parserNamesAfterInit: string[] = [];
  let jsonParserSpy: jest.SpyInstance;
  let urlencodedParserSpy: jest.SpyInstance;
  const previousSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'body-limit-e2e-secret';
    const passwordHash = await bcrypt.hash('Student123', 4);
    const studentUser = {
      id: STUDENT_ID,
      email: 'student@example.com',
      fullName: 'Nguyen Van An',
      passwordHash,
      role: Role.STUDENT,
      authVersion: 0,
      avatar: null,
      cover: null,
      workplace: null,
      currentResidence: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const attemptsRepo = createInMemoryAttemptsRepo();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        revokedToken: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        user: {
          findUnique: jest.fn(
            async ({
              where,
            }: {
              where: { id?: string; email?: string };
            }) => {
              if (
                where.email === studentUser.email ||
                where.id === studentUser.id
              ) {
                return { ...studentUser };
              }
              return null;
            },
          ),
        },
      })
      .overrideProvider(AttemptsRepository)
      .useValue(attemptsRepo)
      .overrideProvider(ExamLeaderboardService)
      .useValue({
        updateLeaderboardOnSubmission: jest.fn().mockResolvedValue(undefined),
        recalculateSummaryStats: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    const getParserNames = () => {
      const instance = app.getHttpAdapter().getInstance() as ExpressRouterStack;
      return (instance.router?.stack ?? [])
        .map((layer) => layer.handle?.name)
        .filter(
          (name): name is string =>
            name === 'jsonParser' || name === 'urlencodedParser',
        );
    };

    parserNamesBeforeConfigure = getParserNames();

    jsonParserSpy = jest.spyOn(express, 'json');
    urlencodedParserSpy = jest.spyOn(express, 'urlencoded');

    configureApp(app, { enableSwagger: false });

    parserNamesAfterConfigureBeforeInit = getParserNames();

    await app.init();

    parserNamesAfterInit = getParserNames();
  });

  afterAll(async () => {
    jsonParserSpy?.mockRestore();
    urlencodedParserSpy?.mockRestore();
    await app?.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it('verifies configureApp registers 100kb jsonParser and urlencodedParser before app.init() and src/main.ts has no 10mb', () => {
    const mainSource = readFileSync(
      join(__dirname, '..', 'src', 'main.ts'),
      'utf8',
    );
    expect(mainSource).toContain("express.json({ limit: '100kb' })");
    expect(mainSource).toContain(
      "express.urlencoded({ limit: '100kb', extended: true })",
    );
    expect(mainSource).not.toContain('10mb');

    expect(jsonParserSpy).toHaveBeenCalledWith({ limit: '100kb' });
    expect(urlencodedParserSpy).toHaveBeenCalledWith({
      limit: '100kb',
      extended: true,
    });

    expect(parserNamesBeforeConfigure).toEqual([]);
    expect(parserNamesAfterConfigureBeforeInit).toEqual([
      'jsonParser',
      'urlencodedParser',
    ]);
    expect(parserNamesAfterInit).toEqual(['jsonParser', 'urlencodedParser']);
  });

  it('rejects 150KB JSON payload with HTTP 413 Payload Too Large', async () => {
    const payload = JSON.stringify({
      email: 'student@example.com',
      password: 'a'.repeat(150 * 1024),
    });
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThanOrEqual(
      150 * 1024,
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(413);

    expect(response.body).toMatchObject({ statusCode: 413 });
  });

  it('rejects >100KB application/x-www-form-urlencoded payload with HTTP 413 Payload Too Large', async () => {
    const payload = `email=student%40example.com&password=${'b'.repeat(120 * 1024)}`;
    expect(Buffer.byteLength(payload, 'utf8')).toBeGreaterThan(100 * 1024);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(payload)
      .expect(413);

    expect(response.body).toMatchObject({ statusCode: 413 });
  });

  it('does not reject ~90KB JSON or urlencoded payloads with 413', async () => {
    const jsonPayload = JSON.stringify({
      unexpectedField: 'c'.repeat(90 * 1024),
    });
    expect(Buffer.byteLength(jsonPayload, 'utf8')).toBeLessThan(100 * 1024);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Content-Type', 'application/json')
      .send(jsonPayload)
      .expect(400);

    const formPayload = `unexpectedField=${'c'.repeat(90 * 1024)}`;
    expect(Buffer.byteLength(formPayload, 'utf8')).toBeLessThan(100 * 1024);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(formPayload)
      .expect(400);
  });

  it('allows normal business requests (<10KB): login, save answer, and submit exam', async () => {
    // 1. Login
    const loginPayload = JSON.stringify({
      email: 'student@example.com',
      password: 'Student123',
    });
    expect(Buffer.byteLength(loginPayload, 'utf8')).toBeLessThan(10 * 1024);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(loginPayload)
      .expect(200);

    expect(typeof loginResponse.body.accessToken).toBe('string');
    expect(loginResponse.body.user).toMatchObject({
      id: STUDENT_ID,
      email: 'student@example.com',
      role: Role.STUDENT,
    });

    const token = loginResponse.body.accessToken as string;

    // 2. Save Answer
    const saveAnswerPayload = JSON.stringify({ selectedOptionIndex: 1 });
    expect(Buffer.byteLength(saveAnswerPayload, 'utf8')).toBeLessThan(
      10 * 1024,
    );

    const saveResponse = await request(app.getHttpServer())
      .put(`/api/v1/attempts/${ATTEMPT_ID}/answers/${QUESTION_ID}`)
      .auth(token, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send(saveAnswerPayload)
      .expect(200);

    expect(saveResponse.body).toMatchObject({
      questionId: QUESTION_ID,
      selectedOptionIndex: 1,
    });

    // 3. Submit Exam
    const submitPayload = '';
    expect(Buffer.byteLength(submitPayload, 'utf8')).toBeLessThan(10 * 1024);

    const submitResponse = await request(app.getHttpServer())
      .post(`/api/v1/attempts/${ATTEMPT_ID}/submit`)
      .auth(token, { type: 'bearer' })
      .expect(200);

    expect(submitResponse.body.attempt).toMatchObject({
      id: ATTEMPT_ID,
      status: AttemptStatus.SUBMITTED,
    });
    expect(submitResponse.body.summary).toMatchObject({
      score: 10,
      maxScore: 10,
      totalQuestions: 1,
      correctCount: 1,
      incorrectCount: 0,
      unansweredCount: 0,
    });
  });
});
