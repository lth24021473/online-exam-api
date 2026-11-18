import { Test, TestingModule } from '@nestjs/testing';
import { AttemptStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ExamLeaderboardService } from './exam-leaderboard.service';

describe('ExamLeaderboardService', () => {
  let service: ExamLeaderboardService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      examLeaderboard: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      examSummaryStats: {
        upsert: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      attempt: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamLeaderboardService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ExamLeaderboardService>(ExamLeaderboardService);
  });

  describe('updateLeaderboardOnSubmission', () => {
    it('returns null if attempt score is null or undefined', async () => {
      const resultNull = await service.updateLeaderboardOnSubmission({
        id: 'att-1',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date(),
        score: null,
      });
      const resultUndefined = await service.updateLeaderboardOnSubmission({
        id: 'att-2',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date(),
        score: undefined,
      });

      expect(resultNull).toBeNull();
      expect(resultUndefined).toBeNull();
      expect(mockPrisma.examLeaderboard.findUnique).not.toHaveBeenCalled();
    });

    it('upserts leaderboard and recalculates stats on first attempt (existing == null)', async () => {
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        fullName: 'Student One',
        avatar: 'https://example.com/avatar.png',
      });
      mockPrisma.examLeaderboard.upsert.mockResolvedValue({
        id: 'lb-1',
        examId: 'exam-1',
        userId: 'user-1',
        fullName: 'Student One',
        avatar: 'https://example.com/avatar.png',
        bestScore: 8.5,
        durationSeconds: 120,
        submittedAt: new Date(),
      });
      jest
        .spyOn(service, 'recalculateSummaryStats')
        .mockResolvedValue({} as any);

      const startedAt = new Date('2026-01-01T10:00:00Z');
      const submittedAt = new Date('2026-01-01T10:02:00Z'); // 120s

      const result = await service.updateLeaderboardOnSubmission({
        id: 'att-1',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt,
        submittedAt,
        score: 8.5,
      });

      expect(mockPrisma.examLeaderboard.findUnique).toHaveBeenCalledWith({
        where: { examId_userId: { examId: 'exam-1', userId: 'user-1' } },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { fullName: true, avatar: true },
      });
      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith({
        where: { examId_userId: { examId: 'exam-1', userId: 'user-1' } },
        create: {
          examId: 'exam-1',
          userId: 'user-1',
          fullName: 'Student One',
          avatar: 'https://example.com/avatar.png',
          bestScore: 8.5,
          durationSeconds: 120,
          submittedAt,
        },
        update: {
          fullName: 'Student One',
          avatar: 'https://example.com/avatar.png',
          bestScore: 8.5,
          durationSeconds: 120,
          submittedAt,
        },
      });
      expect(service.recalculateSummaryStats).toHaveBeenCalledWith('exam-1');
      expect(result).toBeDefined();
      expect(result?.bestScore).toBe(8.5);
    });

    it('upserts leaderboard if new score is higher than existing bestScore', async () => {
      const existing = {
        id: 'lb-1',
        examId: 'exam-1',
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 7.0,
        durationSeconds: 300,
        submittedAt: new Date('2026-01-01T09:00:00Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);
      mockPrisma.user.findUnique.mockResolvedValue({
        fullName: 'Student One',
        avatar: null,
      });
      mockPrisma.examLeaderboard.upsert.mockResolvedValue({
        ...existing,
        bestScore: 9.0,
      });
      jest
        .spyOn(service, 'recalculateSummaryStats')
        .mockResolvedValue({} as any);

      const result = await service.updateLeaderboardOnSubmission({
        id: 'att-2',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date(),
        submittedAt: new Date(),
        score: 9.0,
      });

      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalled();
      expect(service.recalculateSummaryStats).toHaveBeenCalledWith('exam-1');
      expect(result?.bestScore).toBe(9.0);
    });

    it('does NOT upsert leaderboard if new score is lower than existing bestScore', async () => {
      const existing = {
        id: 'lb-1',
        examId: 'exam-1',
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 8.5,
        durationSeconds: 300,
        submittedAt: new Date('2026-01-01T09:00:00Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);
      jest
        .spyOn(service, 'recalculateSummaryStats')
        .mockResolvedValue({} as any);

      const result = await service.updateLeaderboardOnSubmission({
        id: 'att-3',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date(),
        submittedAt: new Date(),
        score: 6.0,
      });

      expect(mockPrisma.examLeaderboard.upsert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('does NOT upsert leaderboard if new score is equal to existing bestScore (ties do not overwrite)', async () => {
      const existing = {
        id: 'lb-1',
        examId: 'exam-1',
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 8.5,
        durationSeconds: 300,
        submittedAt: new Date('2026-01-01T09:00:00Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);

      const result = await service.updateLeaderboardOnSubmission({
        id: 'att-4',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date(),
        submittedAt: new Date(),
        score: 8.5,
      });

      expect(mockPrisma.examLeaderboard.upsert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('uses user details directly from attempt object if present without extra DB query', async () => {
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(null);
      mockPrisma.examLeaderboard.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'lb-2', ...create }),
      );
      jest
        .spyOn(service, 'recalculateSummaryStats')
        .mockResolvedValue({} as any);

      await service.updateLeaderboardOnSubmission({
        id: 'att-5',
        examId: 'exam-1',
        userId: 'user-2',
        startedAt: new Date(),
        submittedAt: new Date(),
        score: 10,
        user: { fullName: 'Cached User', avatar: 'cached.jpg' },
      });

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            fullName: 'Cached User',
            avatar: 'cached.jpg',
          }),
        }),
      );
    });

    it('falls back to default name if user lookup returns null', async () => {
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.examLeaderboard.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'lb-3', ...create }),
      );
      jest
        .spyOn(service, 'recalculateSummaryStats')
        .mockResolvedValue({} as any);

      await service.updateLeaderboardOnSubmission({
        id: 'att-6',
        examId: 'exam-1',
        userId: 'user-unknown',
        startedAt: new Date(),
        submittedAt: new Date(),
        score: 5.0,
      });

      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            fullName: 'Thí sinh',
          }),
        }),
      );
    });
  });

  describe('recalculateSummaryStats', () => {
    it('computes metrics correctly and upserts ExamSummaryStats', async () => {
      mockPrisma.attempt.count
        .mockResolvedValueOnce(10) // totalAttempts
        .mockResolvedValueOnce(7); // submittedCount
      mockPrisma.attempt.aggregate.mockResolvedValue({
        _avg: { score: 7.85 },
        _min: { score: 4.5 },
        _max: { score: 10.0 },
      });
      mockPrisma.examSummaryStats.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'stats-1', ...create, updatedAt: new Date() }),
      );

      const result = await service.recalculateSummaryStats('exam-1');

      expect(mockPrisma.attempt.count).toHaveBeenNthCalledWith(1, {
        where: { examId: 'exam-1' },
      });
      expect(mockPrisma.attempt.count).toHaveBeenNthCalledWith(2, {
        where: { examId: 'exam-1', status: AttemptStatus.SUBMITTED },
      });
      expect(mockPrisma.attempt.aggregate).toHaveBeenCalledWith({
        where: { examId: 'exam-1', status: AttemptStatus.SUBMITTED },
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
      });
      expect(mockPrisma.examSummaryStats.upsert).toHaveBeenCalledWith({
        where: { examId: 'exam-1' },
        create: {
          examId: 'exam-1',
          totalAttempts: 10,
          submittedCount: 7,
          averageScore: 7.85,
          highestScore: 10.0,
          lowestScore: 4.5,
        },
        update: {
          totalAttempts: 10,
          submittedCount: 7,
          averageScore: 7.85,
          highestScore: 10.0,
          lowestScore: 4.5,
        },
      });
      expect(result.averageScore).toBe(7.85);
      expect(result.submittedCount).toBe(7);
    });

    it('handles 0 submitted attempts gracefully by defaulting scores to 0', async () => {
      mockPrisma.attempt.count
        .mockResolvedValueOnce(3) // totalAttempts
        .mockResolvedValueOnce(0); // submittedCount
      mockPrisma.attempt.aggregate.mockResolvedValue({
        _avg: { score: null },
        _min: { score: null },
        _max: { score: null },
      });
      mockPrisma.examSummaryStats.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'stats-2', ...create, updatedAt: new Date() }),
      );

      const result = await service.recalculateSummaryStats('exam-empty');

      expect(mockPrisma.examSummaryStats.upsert).toHaveBeenCalledWith({
        where: { examId: 'exam-empty' },
        create: {
          examId: 'exam-empty',
          totalAttempts: 3,
          submittedCount: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
        },
        update: {
          totalAttempts: 3,
          submittedCount: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
        },
      });
      expect(result.averageScore).toBe(0);
      expect(result.highestScore).toBe(0);
      expect(result.lowestScore).toBe(0);
    });
  });
});
