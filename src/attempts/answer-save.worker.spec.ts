import { ConflictException } from '@nestjs/common';
import { Job } from 'bullmq';
import { AnswerSaveWorker, AnswerSaveJobData } from './answer-save.worker';
import { AttemptsRepository } from './attempts.repository';
import { RedisService } from '../redis/redis.service';

describe('AnswerSaveWorker (TV2-04 Write-Behind Load-Leveling)', () => {
  let worker: AnswerSaveWorker;
  let repo: jest.Mocked<Partial<AttemptsRepository>>;
  let redisService: jest.Mocked<Partial<RedisService>>;

  beforeEach(() => {
    repo = {
      upsertAnswerFromBuffer: jest.fn().mockResolvedValue({} as any),
      upsertAnswersBatch: jest.fn().mockResolvedValue([] as any),
    };

    redisService = {
      hgetall: jest.fn().mockResolvedValue({}),
    };

    worker = new AnswerSaveWorker(
      repo as AttemptsRepository,
      redisService as RedisService,
    );
  });

  const createMockJob = (data: Partial<AnswerSaveJobData>): Job<AnswerSaveJobData> =>
    ({
      id: 'job-save-1',
      data,
    } as unknown as Job<AnswerSaveJobData>);

  describe('Validation & Edge Cases', () => {
    it('skips job with warning if attemptId or userId is missing', async () => {
      const job = createMockJob({ attemptId: '', userId: '' });
      const result = await worker.process(job);

      expect(result.status).toBe('SKIPPED_INVALID_DATA');
      expect(repo.upsertAnswerFromBuffer).not.toHaveBeenCalled();
      expect(repo.upsertAnswersBatch).not.toHaveBeenCalled();
    });

    it('skips single job if questionId or selectedOptionId is missing', async () => {
      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        // selectedOptionId missing
      });
      const result = await worker.process(job);

      expect(result.status).toBe('SKIPPED_INVALID_DATA');
      expect(repo.upsertAnswerFromBuffer).not.toHaveBeenCalled();
    });
  });

  describe('Single Answer Persistence', () => {
    it('successfully persists single answer via upsertAnswerFromBuffer', async () => {
      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOptionId: 'opt-a',
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SAVED');
      expect(result.savedCount).toBe(1);
      expect(result.questionId).toBe('q1');
      expect(repo.upsertAnswerFromBuffer).toHaveBeenCalledWith(
        'attempt-1',
        'user-1',
        'q1',
        'opt-a',
      );
    });

    it('gracefully handles ConflictException when attempt is no longer active', async () => {
      repo.upsertAnswerFromBuffer = jest
        .fn()
        .mockRejectedValue(new ConflictException('Attempt is no longer active'));

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOptionId: 'opt-a',
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SKIPPED_INACTIVE');
      expect(result.questionId).toBe('q1');
    });

    it('rethrows unexpected database errors to trigger BullMQ retry', async () => {
      repo.upsertAnswerFromBuffer = jest
        .fn()
        .mockRejectedValue(new Error('MongoDB replica set connection timed out'));

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOptionId: 'opt-a',
      });

      await expect(worker.process(job)).rejects.toThrow(
        'MongoDB replica set connection timed out',
      );
    });
  });

  describe('Write-Behind Load Leveling (Batching from Redis Hash)', () => {
    it('batches multiple answers from Redis Hash into a single MongoDB transaction', async () => {
      redisService.hgetall = jest.fn().mockResolvedValue({
        q1: 'opt-a',
        q2: 'opt-b',
        q3: 'opt-c',
      });
      repo.upsertAnswersBatch = jest
        .fn()
        .mockResolvedValue([{}, {}, {}] as any);

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOptionId: 'opt-a',
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SAVED');
      expect(result.savedCount).toBe(3);
      expect(repo.upsertAnswersBatch).toHaveBeenCalledWith(
        'attempt-1',
        'user-1',
        [
          { questionId: 'q1', selectedOptionId: 'opt-a' },
          { questionId: 'q2', selectedOptionId: 'opt-b' },
          { questionId: 'q3', selectedOptionId: 'opt-c' },
        ],
      );
      expect(repo.upsertAnswerFromBuffer).not.toHaveBeenCalled();
    });

    it('falls back to single answer save if Redis Hash lookup fails', async () => {
      redisService.hgetall = jest
        .fn()
        .mockRejectedValue(new Error('Redis connection lost'));

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        questionId: 'q1',
        selectedOptionId: 'opt-a',
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SAVED');
      expect(repo.upsertAnswerFromBuffer).toHaveBeenCalledWith(
        'attempt-1',
        'user-1',
        'q1',
        'opt-a',
      );
    });
  });

  describe('Explicit Batch Save', () => {
    it('persists explicit batch when answers array is provided in job payload', async () => {
      const answers = [
        { questionId: 'q1', selectedOptionId: 'opt-a' },
        { questionId: 'q2', selectedOptionId: 'opt-b' },
      ];
      repo.upsertAnswersBatch = jest.fn().mockResolvedValue([{}, {}] as any);

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        answers,
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SAVED');
      expect(result.savedCount).toBe(2);
      expect(repo.upsertAnswersBatch).toHaveBeenCalledWith(
        'attempt-1',
        'user-1',
        answers,
      );
    });

    it('gracefully handles ConflictException during explicit batch save', async () => {
      repo.upsertAnswersBatch = jest
        .fn()
        .mockRejectedValue(new ConflictException('Attempt is no longer active'));

      const job = createMockJob({
        attemptId: 'attempt-1',
        userId: 'user-1',
        answers: [{ questionId: 'q1', selectedOptionId: 'opt-a' }],
      });

      const result = await worker.process(job);

      expect(result.status).toBe('SKIPPED_INACTIVE');
    });
  });
});
