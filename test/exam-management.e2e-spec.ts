import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AttemptStatus, ExamStatus, Role } from '@prisma/client';
import request from 'supertest';
import { ExamsController } from '../src/exams/exams.controller';
import { ExamsRepository } from '../src/exams/exams.repository';
import { ExamsService } from '../src/exams/exams.service';
import { QuestionsController } from '../src/exams/questions/questions.controller';
import { QuestionsRepository } from '../src/exams/questions/questions.repository';
import { QuestionsService } from '../src/exams/questions/questions.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { AttemptsService } from '../src/attempts/attempts.service';

const MANAGER = '111111111111111111111111';
const OTHER = '222222222222222222222222';
const EXAM = '333333333333333333333333';
const QUESTION = '444444444444444444444444';
const OPTIONS = ['555555555555555555555555', '666666666666666666666666'];

/** Authentication is replaced here; controllers, DTOs, role checks and services run. */
describe('Exam management HTTP validation and authorization', () => {
  let app: INestApplication;
  const attempts = {
    finalizeExpiredForExam: jest.fn().mockResolvedValue(undefined),
  };
  const exams = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    publish: jest.fn(),
    close: jest.fn(),
    listResults: jest.fn(),
  };
  const questions = {
    findByExam: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    existsByPosition: jest.fn(),
  };
  const exam = () => ({
    id: EXAM,
    title: 'Draft',
    status: ExamStatus.DRAFT,
    managerId: MANAGER,
    durationMinutes: 30,
    questions: [
      {
        id: QUESTION,
        examId: EXAM,
        content: '2 + 2?',
        position: 1,
        options: OPTIONS.map((id, position) => ({
          id,
          questionId: QUESTION,
          content: String(position + 3),
          position,
          isCorrect: position === 1,
        })),
      },
    ],
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExamsController, QuestionsController],
      providers: [
        ExamsService,
        QuestionsService,
        RolesGuard,
        { provide: ExamsRepository, useValue: exams },
        { provide: QuestionsRepository, useValue: questions },
        { provide: AttemptsService, useValue: attempts },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: { authorization?: string };
            user: { id: string; role: Role };
          }>();
          const role = req.headers.authorization?.replace(
            'Bearer ',
            '',
          ) as Role;
          if (!Object.values(Role).includes(role))
            throw new UnauthorizedException();
          req.user = { id: MANAGER, role };
          return true;
        },
      })
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
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    exams.findById.mockResolvedValue(exam());
    exams.listResults.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      summary: {},
    });
    questions.findById.mockResolvedValue(exam().questions[0]);
    questions.findByExam.mockResolvedValue(exam().questions);
    questions.existsByPosition.mockResolvedValue(null);
  });
  const get = (path: string, role: Role = Role.EXAM_MANAGER) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .auth(role, { type: 'bearer' });

  it('checks the owner even when the results are empty', async () => {
    exams.findById.mockResolvedValue({ ...exam(), managerId: OTHER });
    await get(`/exams/${EXAM}/results`).expect(403);
    expect(exams.listResults).not.toHaveBeenCalled();
    expect(attempts.finalizeExpiredForExam).not.toHaveBeenCalled();
  });
  it('allows ADMIN to view another manager result set and validates defaults', async () => {
    exams.findById.mockResolvedValue({ ...exam(), managerId: OTHER });
    const response = await get(`/exams/${EXAM}/results`, Role.ADMIN).expect(
      200,
    );
    expect(response.body.exam.id).toBe(EXAM);
    expect(exams.listResults).toHaveBeenCalledWith(EXAM, {
      page: 1,
      limit: 10,
    });
  });
  it('forbids students from reading manager results', async () => {
    await get(`/exams/${EXAM}/results`, Role.STUDENT).expect(403);
    expect(exams.findById).not.toHaveBeenCalled();
  });
  it.each([
    'page=0',
    'page=1.5',
    'limit=101',
    'limit=NaN',
    'status=UNKNOWN',
    'page=9007199254740992',
  ])('rejects invalid results query %s', async (query) => {
    await get(`/exams/${EXAM}/results?${query}`).expect(400);
    expect(exams.listResults).not.toHaveBeenCalled();
  });
  it('passes a typed status and pagination to persistence', async () => {
    await get(`/exams/${EXAM}/results?page=2&limit=5&status=SUBMITTED`).expect(
      200,
    );
    expect(exams.listResults).toHaveBeenCalledWith(EXAM, {
      page: 2,
      limit: 5,
      status: AttemptStatus.SUBMITTED,
    });
  });
  it.each([
    '/exams/invalid',
    '/exams/invalid/results',
    `/exams/${EXAM}/questions/invalid`,
    '/exams/invalid/questions',
  ])('returns 400 for malformed ID at %s', async (path) => {
    await get(path).expect(400);
    expect(exams.findById).not.toHaveBeenCalled();
  });
  it('does not disclose answer keys through a student exam detail', async () => {
    exams.findById.mockResolvedValue({
      ...exam(),
      status: ExamStatus.PUBLISHED,
    });
    const response = await get(`/exams/${EXAM}`, Role.STUDENT).expect(200);
    expect(response.body.questions[0].options[1]).toEqual({
      id: OPTIONS[1],
      content: '4',
      position: 1,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /isCorrect|correctOptionIndex/,
    );
    expect(exam().questions[0].options[1].isCorrect).toBe(true);
  });
  it('allows published question review for its manager without permitting edits', async () => {
    exams.findById.mockResolvedValue({
      ...exam(),
      status: ExamStatus.PUBLISHED,
    });
    await get(`/exams/${EXAM}/questions`).expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/exams/${EXAM}/questions/${QUESTION}`)
      .auth(Role.EXAM_MANAGER, { type: 'bearer' })
      .send({ content: 'Changed' })
      .expect(400);
    expect(questions.update).not.toHaveBeenCalled();
  });
  it('forbids metadata changes after publish, including by ADMIN', async () => {
    exams.findById.mockResolvedValue({
      ...exam(),
      status: ExamStatus.PUBLISHED,
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/exams/${EXAM}`)
      .auth(Role.ADMIN, { type: 'bearer' })
      .send({ durationMinutes: 99 })
      .expect(400);
    expect(exams.update).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ ...exam().questions[0], options: [] }],
      [
        {
          ...exam().questions[0],
          options: exam().questions[0].options.map((option) => ({
            ...option,
            isCorrect: true,
          })),
        },
      ],
    ].map((questions) => ({ questions })),
  )(
    'does not publish invalid questions',
    async ({ questions: invalidQuestions }) => {
      exams.findById.mockResolvedValue({
        ...exam(),
        questions: invalidQuestions,
      });
      await request(app.getHttpServer())
        .put(`/api/v1/exams/${EXAM}/publish`)
        .auth(Role.EXAM_MANAGER, { type: 'bearer' })
        .expect(400);
      expect(exams.publish).not.toHaveBeenCalled();
    },
  );
  it('rejects whitespace-only options before writes', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/exams/${EXAM}/questions`)
      .auth(Role.EXAM_MANAGER, { type: 'bearer' })
      .send({
        content: 'Question',
        options: ['   ', 'Valid'],
        correctOptionIndex: 1,
        position: 2,
      })
      .expect(400);
    expect(questions.create).not.toHaveBeenCalled();
  });
  it('allows ADMIN to create an exam under its own account', async () => {
    exams.create.mockResolvedValue({ id: EXAM });
    await request(app.getHttpServer())
      .post('/api/v1/exams')
      .auth(Role.ADMIN, { type: 'bearer' })
      .send({ title: 'Admin exam', durationMinutes: 5 })
      .expect(201);
    expect(exams.create).toHaveBeenCalledWith(
      expect.objectContaining({ manager: { connect: { id: MANAGER } } }),
    );
  });
});
