import 'reflect-metadata';
import { ConflictException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Attempt, AttemptStatus, ExamStatus } from '@prisma/client';
import { AttemptSchedulerService } from './attempt-scheduler.service';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import { ExamsRepository } from '../exams/exams.repository';
import { ExamsService } from '../exams/exams.service';

const makeAttempt = (id: string, overrides: Partial<Attempt> = {}): Attempt => ({
  id,
  userId: 'user-1',
  examId: 'exam-1',
  status: AttemptStatus.IN_PROGRESS,
  startedAt: new Date('2026-11-12T10:00:00Z'),
  deadlineAt: new Date('2026-11-12T10:30:00Z'),
  submittedAt: null,
  cancelledAt: null,
  answerVersion: 0,
  score: null,
  totalQuestions: 2,
  correctCount: null,
  incorrectCount: null,
  violationCount: 0,
  terminatedReason: null,
  ...overrides,
});

describe('AttemptSchedulerService (TASK-04)', () => {
  let scheduler: AttemptSchedulerService;
  let attemptsRepository: {
    findExpired: jest.Mock;
    findById: jest.Mock;
  };
  let attemptsService: {
    finalizeExpiredAttempt: jest.Mock;
  };

  beforeEach(async () => {
    attemptsRepository = {
      findExpired: jest.fn(),
      findById: jest.fn(),
    };
    attemptsService = {
      finalizeExpiredAttempt: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptSchedulerService,
        { provide: AttemptsRepository, useValue: attemptsRepository },
        { provide: AttemptsService, useValue: attemptsService },
      ],
    }).compile();

    scheduler = module.get(AttemptSchedulerService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a 10-second cron schedule (@Cron("*/10 * * * * *")) on handleExpiredAttempts', () => {
    const cronOptions = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      AttemptSchedulerService.prototype.handleExpiredAttempts,
    ) as { cronTime?: string };

    expect(cronOptions).toBeDefined();
    expect(cronOptions.cronTime).toBe('*/10 * * * * *');
  });

  it('returns 0 when there are no expired attempts', async () => {
    attemptsRepository.findExpired.mockResolvedValue([]);

    const count = await scheduler.handleExpiredAttempts();

    expect(count).toBe(0);
    expect(attemptsRepository.findExpired).toHaveBeenCalledTimes(1);
    expect(attemptsRepository.findExpired).toHaveBeenCalledWith(50, []);
    expect(attemptsService.finalizeExpiredAttempt).not.toHaveBeenCalled();
  });

  it('finalizes expired IN_PROGRESS attempts across multiple batches', async () => {
    const firstBatch = [makeAttempt('attempt-1'), makeAttempt('attempt-2')];
    const secondBatch = [makeAttempt('attempt-3')];

    attemptsRepository.findExpired
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch)
      .mockResolvedValueOnce([]);
    attemptsService.finalizeExpiredAttempt.mockResolvedValue({});

    const count = await scheduler.handleExpiredAttempts();

    expect(count).toBe(3);
    expect(attemptsRepository.findExpired).toHaveBeenCalledTimes(3);
    expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledTimes(3);
    expect(attemptsService.finalizeExpiredAttempt).toHaveBeenNthCalledWith(
      1,
      firstBatch[0],
    );
    expect(attemptsService.finalizeExpiredAttempt).toHaveBeenNthCalledWith(
      2,
      firstBatch[1],
    );
    expect(attemptsService.finalizeExpiredAttempt).toHaveBeenNthCalledWith(
      3,
      secondBatch[0],
    );
  });

  it('skips overlapping cron ticks while a previous run is still active', async () => {
    let releaseFirstBatch!: () => void;
    const pendingBatch = new Promise<Attempt[]>((resolve) => {
      releaseFirstBatch = () => resolve([]);
    });
    attemptsRepository.findExpired.mockReturnValueOnce(pendingBatch);

    const firstRun = scheduler.handleExpiredAttempts();
    const overlappingRun = await scheduler.handleExpiredAttempts();

    expect(overlappingRun).toBe(0);
    expect(attemptsRepository.findExpired).toHaveBeenCalledTimes(1);

    releaseFirstBatch();
    expect(await firstRun).toBe(0);
  });

  it('ignores ConflictException race when an attempt was already submitted or cancelled concurrently', async () => {
    const racedAttempt = makeAttempt('attempt-raced');
    const validAttempt = makeAttempt('attempt-valid');

    attemptsRepository.findExpired
      .mockResolvedValueOnce([racedAttempt, validAttempt])
      .mockResolvedValueOnce([]);
    attemptsService.finalizeExpiredAttempt
      .mockRejectedValueOnce(new ConflictException('Cancelled attempts cannot be submitted'))
      .mockResolvedValueOnce({});
    attemptsRepository.findById.mockResolvedValueOnce({
      ...racedAttempt,
      status: AttemptStatus.CANCELLED,
    });

    const count = await scheduler.handleExpiredAttempts();

    expect(count).toBe(1);
    expect(attemptsRepository.findById).toHaveBeenCalledWith('attempt-raced');
    expect(attemptsRepository.findExpired).toHaveBeenLastCalledWith(50, []);
  });

  it('excludes permanently failing attempts so the batch completes and remaining attempts still finalize', async () => {
    const brokenAttempt = makeAttempt('attempt-broken');
    const healthyAttempt = makeAttempt('attempt-healthy');

    attemptsRepository.findExpired
      .mockResolvedValueOnce([brokenAttempt, healthyAttempt])
      .mockResolvedValueOnce([]);
    attemptsService.finalizeExpiredAttempt
      .mockRejectedValueOnce(new Error('Malformed question key'))
      .mockResolvedValueOnce({});

    const count = await scheduler.handleExpiredAttempts();

    expect(count).toBe(1);
    expect(attemptsRepository.findExpired).toHaveBeenNthCalledWith(1, 50, []);
    expect(attemptsRepository.findExpired).toHaveBeenNthCalledWith(2, 50, [
      'attempt-broken',
    ]);
    expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledTimes(2);
  });
});

describe('AttemptsService.finalizeExpiredAttempt & ExamsService.results', () => {
  it('grades an expired attempt with deadlineAt as submittedAt and TIME_EXPIRED reason', async () => {
    const deadlineAt = new Date(Date.now() - 5_000);
    const attempt = makeAttempt('attempt-expired', { deadlineAt });
    const mockRepo = {
      submitInProgress: jest.fn(async (_id, _userId, grade) => {
        const questions = [
          {
            id: 'q1',
            content: '1 + 1?',
            position: 0,
            options: [
              { id: 'o1', content: '1', position: 0, isCorrect: false },
              { id: 'o2', content: '2', position: 1, isCorrect: true },
            ],
          },
          {
            id: 'q2',
            content: '2 + 2?',
            position: 1,
            options: [
              { id: 'o3', content: '4', position: 0, isCorrect: true },
              { id: 'o4', content: '5', position: 1, isCorrect: false },
            ],
          },
        ];
        const answers = [
          {
            questionId: 'q1',
            selectedOptionId: 'o2',
            updatedAt: new Date(deadlineAt.getTime() - 10_000),
            selectedOption: { position: 1 },
          },
        ];
        const graded = grade(questions, answers, attempt);
        return { ...attempt, ...graded, status: AttemptStatus.SUBMITTED };
      }),
    };

    const service = new AttemptsService(mockRepo as unknown as AttemptsRepository);
    const result = await service.finalizeExpiredAttempt(attempt);

    expect(result.status).toBe(AttemptStatus.SUBMITTED);
    expect(result.score).toBe(5);
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(1);
    expect(result.submittedAt?.getTime()).toBe(deadlineAt.getTime());
    expect(result.terminatedReason).toBe('TIME_EXPIRED');
  });

  it('ExamsService.results returns listResults directly without lazy finalization', async () => {
    const examsRepository = {
      findById: jest.fn().mockResolvedValue({
        id: 'exam-1',
        title: 'Final Exam',
        status: ExamStatus.PUBLISHED,
        durationMinutes: 30,
        enableProctoring: true,
        maxViolations: 3,
        managerId: 'manager-1',
        questions: [],
      }),
      listResults: jest.fn().mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
        summary: {
          submittedCount: 0,
          inProgressCount: 0,
          cancelledCount: 0,
          averageScore: null,
          highestScore: null,
          lowestScore: null,
        },
      }),
    };

    const examsService = new ExamsService(
      examsRepository as unknown as ExamsRepository,
    );

    const response = await examsService.results('exam-1', 'manager-1', 'EXAM_MANAGER', {
      page: 1,
      limit: 10,
    });

    expect(examsRepository.listResults).toHaveBeenCalledWith('exam-1', {
      page: 1,
      limit: 10,
    });
    expect(response.exam.id).toBe('exam-1');
    expect(response.data).toEqual([]);
  });
});

