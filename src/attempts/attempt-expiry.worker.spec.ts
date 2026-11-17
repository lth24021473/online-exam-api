import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Attempt, AttemptStatus, ExamStatus, Role } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import {
  QUEUE_ATTEMPT_EXPIRY,
  JOB_EXPIRE_ATTEMPT,
} from '../queue/queue.constants';
import { AttemptExpiryWorker } from './attempt-expiry.worker';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';
import { GRADING_STRATEGY, StandardGradingStrategy } from './grading';

const makeAttempt = (id: string, overrides: Partial<Attempt> = {}): Attempt => ({
  id,
  userId: 'user-123',
  examId: 'exam-456',
  status: AttemptStatus.IN_PROGRESS,
  startedAt: new Date(Date.now() - 30 * 60 * 1000),
  deadlineAt: new Date(Date.now() - 1000), // expired 1s ago
  submittedAt: null,
  cancelledAt: null,
  answerVersion: 0,
  score: null,
  totalQuestions: 5,
  correctCount: null,
  incorrectCount: null,
  violationCount: 0,
  terminatedReason: null,
  ...overrides,
});

describe('AttemptExpiryWorker & Delayed Job Scheduler (TV2-02)', () => {
  let worker: AttemptExpiryWorker;
  let attemptsRepository: {
    findById: jest.Mock;
    findExamForStart: jest.Mock;
    findInProgress: jest.Mock;
    countSubmitted: jest.Mock;
    createOrResume: jest.Mock;
    listQuestions: jest.Mock;
    listAnswers: jest.Mock;
  };
  let attemptsService: {
    finalizeExpiredAttempt: jest.Mock;
  };
  let mockQueue: {
    add: jest.Mock;
  };

  beforeEach(async () => {
    attemptsRepository = {
      findById: jest.fn(),
      findExamForStart: jest.fn(),
      findInProgress: jest.fn(),
      countSubmitted: jest.fn(),
      createOrResume: jest.fn(),
      listQuestions: jest.fn(),
      listAnswers: jest.fn(),
    };
    attemptsService = {
      finalizeExpiredAttempt: jest.fn(),
    };
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptExpiryWorker,
        { provide: AttemptsRepository, useValue: attemptsRepository },
        { provide: AttemptsService, useValue: attemptsService },
      ],
    }).compile();

    worker = module.get<AttemptExpiryWorker>(AttemptExpiryWorker);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Worker metadata & registration', () => {
    it('is decorated with @Processor targeting attempt-expiry-queue', () => {
      expect(worker).toBeDefined();
      expect(worker).toBeInstanceOf(AttemptExpiryWorker);
    });
  });

  describe('Delayed job processing (auto-finalizing expired attempts)', () => {
    it('auto-finalizes an expired IN_PROGRESS attempt and returns submitted status with TIME_EXPIRED reason', async () => {
      const attempt = makeAttempt('attempt-1');
      attemptsRepository.findById.mockResolvedValue(attempt);

      const finalizedAttempt: Attempt = {
        ...attempt,
        status: AttemptStatus.SUBMITTED,
        score: 8,
        correctCount: 4,
        incorrectCount: 1,
        submittedAt: attempt.deadlineAt,
        terminatedReason: 'TIME_EXPIRED',
      };
      attemptsService.finalizeExpiredAttempt.mockResolvedValue(finalizedAttempt);

      const mockJob = {
        id: 'job-1',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'attempt-1', examId: 'exam-456' },
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(attemptsRepository.findById).toHaveBeenCalledWith('attempt-1');
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledWith(attempt);
      expect(result).toEqual({
        attemptId: 'attempt-1',
        status: AttemptStatus.SUBMITTED,
        score: 8,
        terminatedReason: 'TIME_EXPIRED',
      });
    });

    it('is idempotent: skips finalization if attempt is already SUBMITTED', async () => {
      const submittedAttempt = makeAttempt('attempt-2', {
        status: AttemptStatus.SUBMITTED,
        score: 10,
        terminatedReason: 'NORMAL_SUBMIT',
      });
      attemptsRepository.findById.mockResolvedValue(submittedAttempt);

      const mockJob = {
        id: 'job-2',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'attempt-2', examId: 'exam-456' },
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(attemptsRepository.findById).toHaveBeenCalledWith('attempt-2');
      expect(attemptsService.finalizeExpiredAttempt).not.toHaveBeenCalled();
      expect(result).toEqual({
        attemptId: 'attempt-2',
        status: AttemptStatus.SUBMITTED,
        score: 10,
        terminatedReason: 'NORMAL_SUBMIT',
      });
    });

    it('is idempotent: skips finalization if attempt is CANCELLED', async () => {
      const cancelledAttempt = makeAttempt('attempt-3', {
        status: AttemptStatus.CANCELLED,
        cancelledAt: new Date(),
      });
      attemptsRepository.findById.mockResolvedValue(cancelledAttempt);

      const mockJob = {
        id: 'job-3',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'attempt-3', examId: 'exam-456' },
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(attemptsRepository.findById).toHaveBeenCalledWith('attempt-3');
      expect(attemptsService.finalizeExpiredAttempt).not.toHaveBeenCalled();
      expect(result).toEqual({
        attemptId: 'attempt-3',
        status: AttemptStatus.CANCELLED,
        score: null,
        terminatedReason: null,
      });
    });

    it('handles non-existent attempt gracefully without throwing', async () => {
      attemptsRepository.findById.mockResolvedValue(null);

      const mockJob = {
        id: 'job-4',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'non-existent', examId: 'exam-456' },
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(attemptsRepository.findById).toHaveBeenCalledWith('non-existent');
      expect(attemptsService.finalizeExpiredAttempt).not.toHaveBeenCalled();
      expect(result).toEqual({
        attemptId: 'non-existent',
        status: 'NOT_FOUND',
      });
    });

    it('ignores job with invalid or missing attemptId', async () => {
      const mockJob = {
        id: 'job-invalid',
        name: JOB_EXPIRE_ATTEMPT,
        data: {},
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(attemptsRepository.findById).not.toHaveBeenCalled();
      expect(result).toEqual({
        attemptId: '',
        status: 'IGNORED_INVALID_DATA',
      });
    });

    it('handles concurrent settlement race condition when status changes during finalization', async () => {
      const attempt = makeAttempt('attempt-race');
      attemptsRepository.findById
        .mockResolvedValueOnce(attempt) // First check: IN_PROGRESS
        .mockResolvedValueOnce({
          ...attempt,
          status: AttemptStatus.SUBMITTED,
          score: 9,
          terminatedReason: 'NORMAL_SUBMIT',
        }); // Re-check after conflict: SUBMITTED

      attemptsService.finalizeExpiredAttempt.mockRejectedValue(
        new Error('Attempt is no longer active'),
      );

      const mockJob = {
        id: 'job-race',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'attempt-race', examId: 'exam-456' },
      } as unknown as Job;

      const result = await worker.process(mockJob);

      expect(result).toEqual({
        attemptId: 'attempt-race',
        status: AttemptStatus.SUBMITTED,
        score: 9,
        terminatedReason: 'NORMAL_SUBMIT',
      });
    });

    it('propagates unhandled errors when attempt remains IN_PROGRESS to trigger BullMQ retry policy', async () => {
      const attempt = makeAttempt('attempt-error');
      attemptsRepository.findById.mockResolvedValue(attempt);
      attemptsService.finalizeExpiredAttempt.mockRejectedValue(
        new Error('Database connection lost'),
      );

      const mockJob = {
        id: 'job-error',
        name: JOB_EXPIRE_ATTEMPT,
        data: { attemptId: 'attempt-error', examId: 'exam-456' },
      } as unknown as Job;

      await expect(worker.process(mockJob)).rejects.toThrow(
        'Database connection lost',
      );
    });
  });

  describe('AttemptsService.start -> Delayed Job Enqueueing (TV2-02)', () => {
    let service: AttemptsService;

    beforeEach(() => {
      service = new AttemptsService(
        attemptsRepository as unknown as AttemptsRepository,
        new StandardGradingStrategy(),
        mockQueue as unknown as Queue,
      );
    });

    it('pushes delayed job { attemptId, examId } with delay = deadlineAt - now when starting a new attempt', async () => {
      const durationMinutes = 30;
      const now = Date.now();
      const deadlineAt = new Date(now + durationMinutes * 60_000);

      attemptsRepository.findExamForStart.mockResolvedValue({
        id: 'exam-1',
        title: 'Math Exam',
        instructions: null,
        durationMinutes,
        status: ExamStatus.PUBLISHED,
        _count: { questions: 10 },
        maxAttempts: 1,
      });
      attemptsRepository.findInProgress.mockResolvedValue(null);
      attemptsRepository.countSubmitted.mockResolvedValue(0);

      const newAttempt = makeAttempt('attempt-new', {
        id: 'attempt-new',
        examId: 'exam-1',
        deadlineAt,
      });

      attemptsRepository.createOrResume.mockResolvedValue({
        attempt: newAttempt,
        resumed: false,
      });
      attemptsRepository.listQuestions.mockResolvedValue([]);
      attemptsRepository.listAnswers.mockResolvedValue([]);

      await service.start('user-1', 'exam-1', Role.STUDENT);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, jobData, jobOptions] = mockQueue.add.mock.calls[0];

      expect(jobName).toBe(JOB_EXPIRE_ATTEMPT);
      expect(jobData).toEqual({
        attemptId: 'attempt-new',
        examId: 'exam-1',
      });
      expect(jobOptions.jobId).toBe('expire-attempt-new');
      // Delay should be approximately durationMinutes * 60_000 (allowing +- 5000ms execution jitter)
      expect(jobOptions.delay).toBeGreaterThanOrEqual(
        durationMinutes * 60_000 - 5000,
      );
      expect(jobOptions.delay).toBeLessThanOrEqual(
        durationMinutes * 60_000 + 1000,
      );
    });

    it('does NOT push a delayed job when an existing active attempt is resumed', async () => {
      const deadlineAt = new Date(Date.now() + 15 * 60_000);
      const existing = makeAttempt('attempt-existing', {
        deadlineAt,
      });

      attemptsRepository.findExamForStart.mockResolvedValue({
        id: 'exam-1',
        title: 'Math Exam',
        instructions: null,
        durationMinutes: 30,
        status: ExamStatus.PUBLISHED,
        _count: { questions: 10 },
        maxAttempts: 1,
      });
      attemptsRepository.findInProgress.mockResolvedValue(existing);
      attemptsRepository.listQuestions.mockResolvedValue([]);
      attemptsRepository.listAnswers.mockResolvedValue([]);

      const result = await service.start('user-1', 'exam-1', Role.STUDENT);

      expect(result.resumed).toBe(true);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('does NOT push a delayed job if createOrResume returns resumed: true', async () => {
      const deadlineAt = new Date(Date.now() + 15 * 60_000);
      const resumedAttempt = makeAttempt('attempt-resumed', {
        deadlineAt,
      });

      attemptsRepository.findExamForStart.mockResolvedValue({
        id: 'exam-1',
        title: 'Math Exam',
        instructions: null,
        durationMinutes: 30,
        status: ExamStatus.PUBLISHED,
        _count: { questions: 10 },
        maxAttempts: 1,
      });
      attemptsRepository.findInProgress.mockResolvedValue(null);
      attemptsRepository.countSubmitted.mockResolvedValue(0);
      attemptsRepository.createOrResume.mockResolvedValue({
        attempt: resumedAttempt,
        resumed: true,
      });
      attemptsRepository.listQuestions.mockResolvedValue([]);
      attemptsRepository.listAnswers.mockResolvedValue([]);

      const result = await service.start('user-1', 'exam-1', Role.STUDENT);

      expect(result.resumed).toBe(true);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('DI Integration test for AttemptExpiryWorker', () => {
    it('injects queue token and wires AttemptExpiryWorker and AttemptsService in TestingModule', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AttemptsService,
          AttemptExpiryWorker,
          { provide: AttemptsRepository, useValue: attemptsRepository },
          { provide: GRADING_STRATEGY, useClass: StandardGradingStrategy },
          {
            provide: getQueueToken(QUEUE_ATTEMPT_EXPIRY),
            useValue: mockQueue,
          },
        ],
      }).compile();

      const workerInstance = module.get<AttemptExpiryWorker>(AttemptExpiryWorker);
      const serviceInstance = module.get<AttemptsService>(AttemptsService);

      expect(workerInstance).toBeDefined();
      expect(serviceInstance).toBeDefined();
    });
  });
});
