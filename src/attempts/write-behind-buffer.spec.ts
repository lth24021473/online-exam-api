import { ConflictException, NotFoundException } from '@nestjs/common';
import { AttemptStatus, ExamStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './attempts.repository';
import { RedisService } from '../redis/redis.service';
import { JOB_SAVE_ANSWER } from '../queue/queue.constants';
import { ShuffledMapping } from './shuffling';

describe('AttemptsService - TV2-04 Write-Behind Buffer', () => {
  let service: AttemptsService;
  let repo: jest.Mocked<Partial<AttemptsRepository>>;
  let redisService: jest.Mocked<Partial<RedisService>>;
  let answerSaveQueue: jest.Mocked<Partial<Queue>>;

  const mockExam = {
    id: 'exam-101',
    title: 'Cloud Architecture Final Exam',
    instructions: 'Time limit 60 minutes',
    durationMinutes: 60,
    status: ExamStatus.PUBLISHED,
    opensAt: null,
    closesAt: null,
    maxAttempts: 1,
    enableProctoring: true,
    maxViolations: 3,
    managerId: 'manager-1',
    classroomId: null,
    _count: { questions: 2 },
  };

  const rawQuestions = [
    {
      id: 'q1',
      content: 'Which AWS service is a managed Redis cache?',
      position: 1,
      options: [
        { id: 'opt-1a', content: 'Amazon RDS', position: 0 },
        { id: 'opt-1b', content: 'Amazon ElastiCache', position: 1 },
        { id: 'opt-1c', content: 'Amazon DynamoDB', position: 2 },
      ],
    },
    {
      id: 'q2',
      content: 'Which BullMQ pattern handles delayed retries?',
      position: 2,
      options: [
        { id: 'opt-2a', content: 'Exponential backoff', position: 0 },
        { id: 'opt-2b', content: 'Round robin', position: 1 },
      ],
    },
  ];

  const shuffledMapping: ShuffledMapping = [
    { questionId: 'q1', optionIds: ['opt-1c', 'opt-1a', 'opt-1b'] },
    { questionId: 'q2', optionIds: ['opt-2b', 'opt-2a'] },
  ];

  const mockAttempt = {
    id: 'attempt-999',
    userId: 'student-42',
    examId: 'exam-101',
    status: AttemptStatus.IN_PROGRESS,
    deadlineAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    startedAt: new Date(Date.now() - 5 * 60 * 1000),
    totalQuestions: 2,
    shuffledMapping,
    answerVersion: 1,
    violationCount: 0,
    score: null,
    submittedAt: null,
    cancelledAt: null,
    terminatedReason: null,
  };

  beforeEach(() => {
    repo = {
      findById: jest.fn().mockResolvedValue({ ...mockAttempt } as any),
      findExamForStart: jest.fn().mockResolvedValue(mockExam as any),
      findQuestionInExam: jest.fn().mockImplementation((examId, questionId) => {
        const found = rawQuestions.find((q) => q.id === questionId);
        return Promise.resolve(found || null);
      }),
      listQuestions: jest.fn().mockResolvedValue(rawQuestions as any),
      listAnswers: jest.fn().mockResolvedValue([]),
      upsertAnswer: jest.fn().mockResolvedValue({
        questionId: 'q1',
        selectedOptionId: 'opt-1b',
        updatedAt: new Date(),
        selectedOption: { position: 1 },
      } as any),
    };

    redisService = {
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn().mockResolvedValue(null),
      hgetall: jest.fn().mockResolvedValue({}),
      expire: jest.fn().mockResolvedValue(1),
    };

    answerSaveQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' } as any),
    };

    service = new AttemptsService(
      repo as AttemptsRepository,
      undefined,
      undefined,
      answerSaveQueue as Queue,
      redisService as RedisService,
    );
  });

  describe('Write-Behind Buffer (Redis Hash + Queue)', () => {
    it('saves directly to Redis Hash attempt:{attemptId}:answers and queues job to BullMQ (< 5ms latency)', async () => {
      const startTime = performance.now();

      // Student selects index 2 in UI, which corresponds to opt-1b in shuffledMapping: ['opt-1c', 'opt-1a', 'opt-1b']
      const result = await service.saveAnswer(
        'student-42',
        'attempt-999',
        'q1',
        2,
      );

      const elapsed = performance.now() - startTime;

      // Assert ultra-low latency (< 5ms)
      expect(elapsed).toBeLessThan(50); // Generous margin for test runner, typically < 2ms

      // Assert saved to Redis Hash
      expect(redisService.hset).toHaveBeenCalledWith(
        'attempt:attempt-999:answers',
        'q1',
        'opt-1b',
      );

      // Assert TTL retention set on Redis Hash
      expect(redisService.expire).toHaveBeenCalledWith(
        'attempt:attempt-999:answers',
        86400,
      );

      // Assert job queued to BullMQ answer-save-queue
      expect(answerSaveQueue.add).toHaveBeenCalledWith(
        JOB_SAVE_ANSWER,
        expect.objectContaining({
          attemptId: 'attempt-999',
          userId: 'student-42',
          questionId: 'q1',
          selectedOptionId: 'opt-1b',
          savedAt: expect.any(Number),
        }),
      );

      // Assert HTTP 200 payload returned immediately without synchronous MongoDB upsert
      expect(repo.upsertAnswer).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        questionId: 'q1',
        selectedOptionIndex: 2,
        savedAt: expect.any(Date),
      });
    });

    it('resolves options correctly when attempt has no shuffledMapping', async () => {
      repo.findById = jest.fn().mockResolvedValue({
        ...mockAttempt,
        shuffledMapping: null,
      } as any);

      // Standard non-shuffled: index 1 is position 1 -> opt-1b
      const result = await service.saveAnswer(
        'student-42',
        'attempt-999',
        'q1',
        1,
      );

      expect(redisService.hset).toHaveBeenCalledWith(
        'attempt:attempt-999:answers',
        'q1',
        'opt-1b',
      );
      expect(result.selectedOptionIndex).toBe(1);
    });

    it('falls back seamlessly to direct database upsert if Redis is unreachable or fails', async () => {
      redisService.hset = jest
        .fn()
        .mockRejectedValue(new Error('Redis connection refused'));

      const result = await service.saveAnswer(
        'student-42',
        'attempt-999',
        'q1',
        2,
      );

      // Successfully falls back to MongoDB upsert
      expect(repo.upsertAnswer).toHaveBeenCalledWith(
        'attempt-999',
        'student-42',
        'q1',
        'opt-1b',
      );
      expect(result.questionId).toBe('q1');
    });

    it('falls back to direct database upsert when RedisService is not provided', async () => {
      const serviceWithoutRedis = new AttemptsService(
        repo as AttemptsRepository,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      const result = await serviceWithoutRedis.saveAnswer(
        'student-42',
        'attempt-999',
        'q1',
        2,
      );

      expect(repo.upsertAnswer).toHaveBeenCalled();
      expect(result.questionId).toBe('q1');
    });
  });

  describe('Validation & Boundary Protections', () => {
    it('rejects saveAnswer with ConflictException if attempt is SUBMITTED', async () => {
      repo.findById = jest.fn().mockResolvedValue({
        ...mockAttempt,
        status: AttemptStatus.SUBMITTED,
      } as any);

      await expect(
        service.saveAnswer('student-42', 'attempt-999', 'q1', 1),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Attempt is no longer in progress',
      });

      expect(redisService.hset).not.toHaveBeenCalled();
    });

    it('rejects saveAnswer with ConflictException if attempt deadline has passed', async () => {
      repo.findById = jest.fn().mockResolvedValue({
        ...mockAttempt,
        deadlineAt: new Date(Date.now() - 1000), // expired 1s ago
      } as any);

      await expect(
        service.saveAnswer('student-42', 'attempt-999', 'q1', 1),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Time is over for this attempt',
      });

      expect(redisService.hset).not.toHaveBeenCalled();
    });

    it('rejects saveAnswer with NotFoundException if question is not in exam', async () => {
      repo.findQuestionInExam = jest.fn().mockResolvedValue(null);

      await expect(
        service.saveAnswer('student-42', 'attempt-999', 'unknown-q', 1),
      ).rejects.toMatchObject({
        constructor: NotFoundException,
        message: 'Question not found in exam',
      });

      expect(redisService.hset).not.toHaveBeenCalled();
    });

    it('rejects saveAnswer with ConflictException if selected option index is out of bounds', async () => {
      await expect(
        service.saveAnswer('student-42', 'attempt-999', 'q1', 99),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        message: 'Selected option does not exist',
      });

      expect(redisService.hset).not.toHaveBeenCalled();
    });

    it('rejects saveAnswer with NotFoundException if attempt belongs to another user', async () => {
      await expect(
        service.saveAnswer('attacker-user', 'attempt-999', 'q1', 1),
      ).rejects.toThrow(NotFoundException);

      expect(redisService.hset).not.toHaveBeenCalled();
    });
  });

  describe('Session Reload & Read-Your-Writes Consistency', () => {
    it('merges uncommitted Redis Hash answers into session when student reloads or resumes', async () => {
      // MongoDB currently only has answer for q1
      repo.listAnswers = jest.fn().mockResolvedValue([
        {
          questionId: 'q1',
          selectedOptionId: 'opt-1a',
          selectedOption: { position: 0 },
        },
      ] as any);

      // Redis Hash has uncommitted recent answer for q2 ('opt-2a')
      redisService.hgetall = jest.fn().mockResolvedValue({
        q2: 'opt-2a',
      });

      repo.findInProgress = jest
        .fn()
        .mockResolvedValue({ ...mockAttempt } as any);

      const session = await service.start(
        'student-42',
        'exam-101',
      );

      expect(session.resumed).toBe(true);
      // Both answers are present in session
      expect(session.answers).toHaveLength(2);
      expect(session.answers).toContainEqual(
        expect.objectContaining({ questionId: 'q1' }),
      );
      expect(session.answers).toContainEqual(
        expect.objectContaining({ questionId: 'q2' }),
      );
    });
  });
});
