import 'reflect-metadata';
import { ConflictException, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Attempt, AttemptStatus } from '@prisma/client';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_ATTEMPT_EXPIRY } from '../queue/queue.constants';
import {
  AttemptExpirySupervisor,
  SUPERVISOR_BATCH_SIZE,
  SUPERVISOR_CRON_SCHEDULE,
} from './attempt-expiry.supervisor';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

const makeAttempt = (id: string, overrides: Partial<Attempt> = {}): Attempt => ({
  id,
  userId: 'user-supervisor-1',
  examId: 'exam-supervisor-1',
  status: AttemptStatus.IN_PROGRESS,
  startedAt: new Date(Date.now() - 30 * 60 * 1000),
  deadlineAt: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
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

describe('AttemptExpirySupervisor (TV2-03)', () => {
  let supervisor: AttemptExpirySupervisor;
  let attemptsRepository: {
    findExpired: jest.Mock;
    findById: jest.Mock;
  };
  let attemptsService: {
    finalizeExpiredAttempt: jest.Mock;
  };
  let mockQueue: {
    getJob: jest.Mock;
  };

  beforeEach(async () => {
    attemptsRepository = {
      findExpired: jest.fn(),
      findById: jest.fn(),
    };
    attemptsService = {
      finalizeExpiredAttempt: jest.fn(),
    };
    mockQueue = {
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptExpirySupervisor,
        { provide: AttemptsRepository, useValue: attemptsRepository },
        { provide: AttemptsService, useValue: attemptsService },
        { provide: getQueueToken(QUEUE_ATTEMPT_EXPIRY), useValue: mockQueue },
      ],
    }).compile();

    supervisor = module.get(AttemptExpirySupervisor);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Cron & Constant Registration', () => {
    it('registers a 1-minute cron schedule (@Cron("*/1 * * * *")) on rescueExpiredAttempts', () => {
      const cronOptions = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        AttemptExpirySupervisor.prototype.rescueExpiredAttempts,
      ) as { cronTime?: string };

      expect(cronOptions).toBeDefined();
      expect(cronOptions.cronTime).toBe('*/1 * * * *');
    });

    it('exposes SUPERVISOR_CRON_SCHEDULE and SUPERVISOR_BATCH_SIZE constants', () => {
      expect(SUPERVISOR_CRON_SCHEDULE).toBe('*/1 * * * *');
      expect(SUPERVISOR_BATCH_SIZE).toBe(50);
    });
  });

  describe('Core Rescue Flow', () => {
    it('returns 0 when there are no expired attempts needing rescue', async () => {
      attemptsRepository.findExpired.mockResolvedValue([]);

      const rescuedCount = await supervisor.rescueExpiredAttempts();

      expect(rescuedCount).toBe(0);
      expect(attemptsRepository.findExpired).toHaveBeenCalledTimes(1);
      expect(attemptsRepository.findExpired).toHaveBeenCalledWith(50, []);
      expect(attemptsService.finalizeExpiredAttempt).not.toHaveBeenCalled();
    });

    it('rescues and auto-finalizes expired IN_PROGRESS attempts that missed delayed jobs', async () => {
      const expiredAttempts = [
        makeAttempt('attempt-orphaned-1'),
        makeAttempt('attempt-orphaned-2'),
      ];
      attemptsRepository.findExpired.mockResolvedValue(expiredAttempts);
      attemptsService.finalizeExpiredAttempt.mockResolvedValue({
        status: AttemptStatus.SUBMITTED,
        score: 8,
        terminatedReason: 'TIME_EXPIRED',
      });
      mockQueue.getJob.mockResolvedValue(null);

      const count = await supervisor.rescueExpiredAttempts();

      expect(count).toBe(2);
      expect(attemptsRepository.findExpired).toHaveBeenCalledWith(50, []);
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledTimes(2);
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenNthCalledWith(
        1,
        expiredAttempts[0],
      );
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenNthCalledWith(
        2,
        expiredAttempts[1],
      );
    });

    it('scans with a configurable batchSize (defaults to 50)', async () => {
      attemptsRepository.findExpired.mockResolvedValue([]);

      await supervisor.rescueExpiredAttempts(25);

      expect(attemptsRepository.findExpired).toHaveBeenCalledWith(25, []);
    });

    it('provides a detailed rescue report via rescueExpiredAttemptsWithReport', async () => {
      const expired = [makeAttempt('att-rep-1'), makeAttempt('att-rep-2')];
      attemptsRepository.findExpired.mockResolvedValue(expired);
      attemptsService.finalizeExpiredAttempt.mockResolvedValue({
        status: AttemptStatus.SUBMITTED,
        score: 10,
        terminatedReason: 'TIME_EXPIRED',
      });
      mockQueue.getJob.mockResolvedValue(null);

      const report = await supervisor.rescueExpiredAttemptsWithReport();

      expect(report).toEqual({
        scannedCount: 2,
        rescuedCount: 2,
        failedCount: 0,
        failedIds: [],
      });
    });

    it('provides handleExpiredAttempts as a backwards-compatible alias', async () => {
      attemptsRepository.findExpired.mockResolvedValue([]);

      const count = await supervisor.handleExpiredAttempts();

      expect(count).toBe(0);
      expect(attemptsRepository.findExpired).toHaveBeenCalledWith(50, []);
    });
  });

  describe('Concurrency & Non-overlapping Execution Guard', () => {
    it('skips overlapping supervisor ticks while a previous run is still active', async () => {
      let releaseFirstRun!: () => void;
      const pendingBatch = new Promise<Attempt[]>((resolve) => {
        releaseFirstRun = () => resolve([]);
      });
      attemptsRepository.findExpired.mockReturnValueOnce(pendingBatch);

      const firstRun = supervisor.rescueExpiredAttempts();
      expect(supervisor.running).toBe(true);

      const overlappingRun = await supervisor.rescueExpiredAttempts();
      expect(overlappingRun).toBe(0);
      expect(attemptsRepository.findExpired).toHaveBeenCalledTimes(1);

      releaseFirstRun();
      expect(await firstRun).toBe(0);
      expect(supervisor.running).toBe(false);
    });

    it('resets the isRunning flag cleanly even if repository scan throws an unexpected error', async () => {
      attemptsRepository.findExpired.mockRejectedValue(
        new Error('Database connectivity lost'),
      );

      const count = await supervisor.rescueExpiredAttempts();

      expect(count).toBe(0);
      expect(supervisor.running).toBe(false);
    });
  });

  describe('Race Condition & Error Resilience', () => {
    it('ignores ConflictException when an attempt was concurrently submitted or cancelled', async () => {
      const racedAttempt = makeAttempt('attempt-concurrent');
      const validAttempt = makeAttempt('attempt-valid');

      attemptsRepository.findExpired.mockResolvedValue([
        racedAttempt,
        validAttempt,
      ]);
      attemptsService.finalizeExpiredAttempt
        .mockRejectedValueOnce(
          new ConflictException('Attempt is no longer active'),
        )
        .mockResolvedValueOnce({
          status: AttemptStatus.SUBMITTED,
          score: 7,
          terminatedReason: 'TIME_EXPIRED',
        });
      attemptsRepository.findById.mockResolvedValueOnce({
        ...racedAttempt,
        status: AttemptStatus.SUBMITTED,
      });
      mockQueue.getJob.mockResolvedValue(null);

      const count = await supervisor.rescueExpiredAttempts();

      expect(count).toBe(1);
      expect(attemptsRepository.findById).toHaveBeenCalledWith('attempt-concurrent');
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledTimes(2);
    });

    it('isolates unhandled errors so subsequent attempts still finalize successfully', async () => {
      const faultyAttempt = makeAttempt('attempt-faulty');
      const goodAttempt = makeAttempt('attempt-good');

      attemptsRepository.findExpired.mockResolvedValue([
        faultyAttempt,
        goodAttempt,
      ]);
      attemptsService.finalizeExpiredAttempt
        .mockRejectedValueOnce(new Error('Corrupted question data'))
        .mockResolvedValueOnce({
          status: AttemptStatus.SUBMITTED,
          score: 10,
          terminatedReason: 'TIME_EXPIRED',
        });
      mockQueue.getJob.mockResolvedValue(null);

      const report = await supervisor.rescueExpiredAttemptsWithReport();

      expect(report.scannedCount).toBe(2);
      expect(report.rescuedCount).toBe(1);
      expect(report.failedCount).toBe(1);
      expect(report.failedIds).toContain('attempt-faulty');
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledTimes(2);
    });
  });

  describe('BullMQ Queue Integration & Delayed Job Cleanup', () => {
    it('cleans up pending delayed job from attemptExpiryQueue if present when rescued', async () => {
      const attempt = makeAttempt('attempt-with-job');
      attemptsRepository.findExpired.mockResolvedValue([attempt]);
      attemptsService.finalizeExpiredAttempt.mockResolvedValue({
        status: AttemptStatus.SUBMITTED,
        score: 9,
        terminatedReason: 'TIME_EXPIRED',
      });
      const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await supervisor.rescueExpiredAttempts();

      expect(mockQueue.getJob).toHaveBeenCalledWith('expire-attempt-with-job');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('handles queue job removal errors gracefully without interrupting rescue flow', async () => {
      const attempt = makeAttempt('attempt-job-error');
      attemptsRepository.findExpired.mockResolvedValue([attempt]);
      attemptsService.finalizeExpiredAttempt.mockResolvedValue({
        status: AttemptStatus.SUBMITTED,
        score: 6,
        terminatedReason: 'TIME_EXPIRED',
      });
      mockQueue.getJob.mockRejectedValue(new Error('Redis connection timeout'));

      const count = await supervisor.rescueExpiredAttempts();

      expect(count).toBe(1);
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalled();
    });

    it('functions seamlessly when optional queue is not provided in DI', async () => {
      const noQueueModule: TestingModule = await Test.createTestingModule({
        providers: [
          AttemptExpirySupervisor,
          { provide: AttemptsRepository, useValue: attemptsRepository },
          { provide: AttemptsService, useValue: attemptsService },
        ],
      }).compile();

      const noQueueSupervisor = noQueueModule.get(AttemptExpirySupervisor);
      const attempt = makeAttempt('attempt-no-queue');
      attemptsRepository.findExpired.mockResolvedValue([attempt]);
      attemptsService.finalizeExpiredAttempt.mockResolvedValue({
        status: AttemptStatus.SUBMITTED,
        score: 5,
        terminatedReason: 'TIME_EXPIRED',
      });

      const count = await noQueueSupervisor.rescueExpiredAttempts();

      expect(count).toBe(1);
      expect(attemptsService.finalizeExpiredAttempt).toHaveBeenCalledWith(attempt);
    });
  });
});
