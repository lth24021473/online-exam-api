jest.mock('@nestjs/common', () => ({
  Injectable: () => (target: any) => target,
  Logger: class {
    log() {}
    warn() {}
    error() {}
    debug() {}
  },
  BadRequestException: class extends Error {},
  ConflictException: class extends Error {},
  NotFoundException: class extends Error {},
}));

import { ExamsRepository } from './exams.repository';
import { ExamLeaderboardService } from './materialized-views/exam-leaderboard.service';
import { ExamResultsQueryDto } from './dto/exam-results-query.dto';

describe('ExamsResultsCqrsSpec (Task 5: R1 Unit Tests)', () => {
  let repository: ExamsRepository;
  let leaderboardService: ExamLeaderboardService;
  let mockPrisma: any;

  const examId = '660f9e1e8f1b2c0012345678';

  beforeEach(() => {
    mockPrisma = {
      examLeaderboard: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn(),
      },
      examSummaryStats: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      attempt: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    repository = new ExamsRepository(mockPrisma as any);
    leaderboardService = new ExamLeaderboardService(mockPrisma as any);
  });

  // =========================================================================
  // R1 Criteria 1: Tie-breaker
  // Cùng điểm số thì thí sinh làm ít thời gian hơn sẽ đứng trước trên bảng xếp hạng
  // =========================================================================
  describe('R1.1 - Tie-Breaker: Equal score ranks candidate with shorter duration higher', () => {
    it('queries examLeaderboard with primary bestScore DESC and secondary durationSeconds ASC', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      await repository.listResults(examId, { page: 1, limit: 10 });

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
        }),
      );
    });

    it('assigns rank 1 to shorter completion time when two candidates have equal scores', async () => {
      const mockItems = [
        {
          id: 'lb-1',
          examId,
          userId: 'user-alice',
          fullName: 'Alice Nguyen',
          avatar: null,
          bestScore: 90.0,
          durationSeconds: 120, // 2 minutes (shorter)
          submittedAt: new Date('2026-03-01T10:02:00Z'),
        },
        {
          id: 'lb-2',
          examId,
          userId: 'user-bob',
          fullName: 'Bob Tran',
          avatar: null,
          bestScore: 90.0,
          durationSeconds: 240, // 4 minutes (longer)
          submittedAt: new Date('2026-03-01T10:04:00Z'),
        },
      ];

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(mockItems);
      mockPrisma.examLeaderboard.count.mockResolvedValue(2);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(examId, { page: 1, limit: 10 });

      expect(result.items).toHaveLength(2);
      // Alice has shorter duration -> Rank 1
      expect(result.items[0].userId).toBe('user-alice');
      expect(result.items[0].rank).toBe(1);
      expect(result.items[0].bestScore).toBe(90.0);
      expect(result.items[0].durationSeconds).toBe(120);

      // Bob has longer duration -> Rank 2
      expect(result.items[1].userId).toBe('user-bob');
      expect(result.items[1].rank).toBe(2);
      expect(result.items[1].bestScore).toBe(90.0);
      expect(result.items[1].durationSeconds).toBe(240);
    });

    it('ranks higher score first regardless of duration (score priority over duration)', async () => {
      const mockItems = [
        {
          id: 'lb-1',
          examId,
          userId: 'user-charlie',
          fullName: 'Charlie Le',
          avatar: null,
          bestScore: 95.0,
          durationSeconds: 500, // Longer duration but higher score
          submittedAt: new Date('2026-03-01T10:10:00Z'),
        },
        {
          id: 'lb-2',
          examId,
          userId: 'user-alice',
          fullName: 'Alice Nguyen',
          avatar: null,
          bestScore: 90.0,
          durationSeconds: 120, // Shorter duration but lower score
          submittedAt: new Date('2026-03-01T10:02:00Z'),
        },
      ];

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(mockItems);
      mockPrisma.examLeaderboard.count.mockResolvedValue(2);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(examId, { page: 1, limit: 10 });

      expect(result.items[0].userId).toBe('user-charlie');
      expect(result.items[0].rank).toBe(1);
      expect(result.items[0].bestScore).toBe(95.0);

      expect(result.items[1].userId).toBe('user-alice');
      expect(result.items[1].rank).toBe(2);
      expect(result.items[1].bestScore).toBe(90.0);
    });

    it('correctly orders three candidates with identical scores by ascending duration', async () => {
      const mockItems = [
        {
          id: 'lb-fast',
          examId,
          userId: 'user-fast',
          fullName: 'Fast Candidate',
          avatar: null,
          bestScore: 85.0,
          durationSeconds: 60,
          submittedAt: new Date('2026-03-01T10:01:00Z'),
        },
        {
          id: 'lb-medium',
          examId,
          userId: 'user-medium',
          fullName: 'Medium Candidate',
          avatar: null,
          bestScore: 85.0,
          durationSeconds: 150,
          submittedAt: new Date('2026-03-01T10:02:30Z'),
        },
        {
          id: 'lb-slow',
          examId,
          userId: 'user-slow',
          fullName: 'Slow Candidate',
          avatar: null,
          bestScore: 85.0,
          durationSeconds: 300,
          submittedAt: new Date('2026-03-01T10:05:00Z'),
        },
      ];

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(mockItems);
      mockPrisma.examLeaderboard.count.mockResolvedValue(3);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(examId, { page: 1, limit: 10 });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].rank).toBe(1);
      expect(result.items[0].durationSeconds).toBe(60);
      expect(result.items[1].rank).toBe(2);
      expect(result.items[1].durationSeconds).toBe(150);
      expect(result.items[2].rank).toBe(3);
      expect(result.items[2].durationSeconds).toBe(300);
    });
  });

  // =========================================================================
  // R1 Criteria 2: Deduplication
  // Nhiều bài thi của 1 user thì chỉ lấy bài thi có điểm cao nhất
  // =========================================================================
  describe('R1.2 - Deduplication: Multiple attempts for 1 user retains only the highest score', () => {
    it('upserts initial score when user has no prior leaderboard record', async () => {
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        fullName: 'Student One',
        avatar: null,
      });
      mockPrisma.examLeaderboard.upsert.mockResolvedValue({
        id: 'lb-1',
        examId,
        userId: 'user-1',
        bestScore: 70.0,
        durationSeconds: 300,
      });
      jest.spyOn(leaderboardService, 'recalculateSummaryStats').mockResolvedValue({} as any);

      const attempt = {
        id: 'att-1',
        examId,
        userId: 'user-1',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        submittedAt: new Date('2026-01-01T10:05:00Z'),
        score: 70.0,
      };

      const result = await leaderboardService.updateLeaderboardOnSubmission(attempt);

      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { examId_userId: { examId, userId: 'user-1' } },
          create: expect.objectContaining({ bestScore: 70.0, durationSeconds: 300 }),
          update: expect.objectContaining({ bestScore: 70.0, durationSeconds: 300 }),
        }),
      );
      expect(result?.bestScore).toBe(70.0);
    });

    it('updates leaderboard when subsequent attempt achieves a HIGHER score', async () => {
      const existing = {
        id: 'lb-1',
        examId,
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 70.0,
        durationSeconds: 300,
        submittedAt: new Date('2026-01-01T10:05:00Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);
      mockPrisma.examLeaderboard.upsert.mockResolvedValue({
        ...existing,
        bestScore: 95.0,
        durationSeconds: 200,
      });
      jest.spyOn(leaderboardService, 'recalculateSummaryStats').mockResolvedValue({} as any);

      const attempt = {
        id: 'att-2',
        examId,
        userId: 'user-1',
        startedAt: new Date('2026-01-02T10:00:00Z'),
        submittedAt: new Date('2026-01-02T10:03:20Z'),
        score: 95.0,
      };

      const result = await leaderboardService.updateLeaderboardOnSubmission(attempt);

      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { examId_userId: { examId, userId: 'user-1' } },
          update: expect.objectContaining({ bestScore: 95.0, durationSeconds: 200 }),
        }),
      );
      expect(result?.bestScore).toBe(95.0);
    });

    it('does NOT overwrite leaderboard when subsequent attempt has a LOWER score', async () => {
      const existing = {
        id: 'lb-1',
        examId,
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 95.0,
        durationSeconds: 200,
        submittedAt: new Date('2026-01-02T10:03:20Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);

      const attempt = {
        id: 'att-3',
        examId,
        userId: 'user-1',
        startedAt: new Date('2026-01-03T10:00:00Z'),
        submittedAt: new Date('2026-01-03T10:05:00Z'),
        score: 80.0, // Lower than 95.0
      };

      const result = await leaderboardService.updateLeaderboardOnSubmission(attempt);

      expect(mockPrisma.examLeaderboard.upsert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
      expect(result?.bestScore).toBe(95.0);
    });

    it('does NOT overwrite leaderboard when subsequent attempt has an EQUAL score', async () => {
      const existing = {
        id: 'lb-1',
        examId,
        userId: 'user-1',
        fullName: 'Student One',
        avatar: null,
        bestScore: 95.0,
        durationSeconds: 200,
        submittedAt: new Date('2026-01-02T10:03:20Z'),
      };
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(existing);

      const attempt = {
        id: 'att-4',
        examId,
        userId: 'user-1',
        startedAt: new Date('2026-01-04T10:00:00Z'),
        submittedAt: new Date('2026-01-04T10:04:00Z'),
        score: 95.0, // Equal score
      };

      const result = await leaderboardService.updateLeaderboardOnSubmission(attempt);

      expect(mockPrisma.examLeaderboard.upsert).not.toHaveBeenCalled();
      expect(result).toBe(existing);
      expect(result?.bestScore).toBe(95.0);
    });
  });

  // =========================================================================
  // R1 Criteria 3: Pagination
  // Phân trang: page=1, page=2 trả về đúng offset và limit
  // =========================================================================
  describe('R1.3 - Pagination: page=1 and page=2 offsets and limits correctly applied', () => {
    it('applies skip=0 and take=10 for page=1 with ranks starting at 1', async () => {
      const page1Items = Array.from({ length: 10 }, (_, i) => ({
        id: `lb-${i + 1}`,
        examId,
        userId: `user-${i + 1}`,
        fullName: `Candidate ${i + 1}`,
        avatar: null,
        bestScore: 100 - i,
        durationSeconds: 100 + i * 10,
        submittedAt: new Date(),
      }));

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(page1Items);
      mockPrisma.examLeaderboard.count.mockResolvedValue(25);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const query: ExamResultsQueryDto = { page: 1, limit: 10 };
      const result = await repository.listResults(examId, query);

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 0,
        take: 10,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(result.items).toHaveLength(10);
      expect(result.items[0].rank).toBe(1);
      expect(result.items[9].rank).toBe(10);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('applies skip=10 and take=10 for page=2 with ranks starting at 11', async () => {
      const page2Items = Array.from({ length: 10 }, (_, i) => ({
        id: `lb-${i + 11}`,
        examId,
        userId: `user-${i + 11}`,
        fullName: `Candidate ${i + 11}`,
        avatar: null,
        bestScore: 90 - i,
        durationSeconds: 200 + i * 10,
        submittedAt: new Date(),
      }));

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(page2Items);
      mockPrisma.examLeaderboard.count.mockResolvedValue(25);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const query: ExamResultsQueryDto = { page: 2, limit: 10 };
      const result = await repository.listResults(examId, query);

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 10,
        take: 10,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(result.items).toHaveLength(10);
      expect(result.items[0].rank).toBe(11); // skip (10) + 0 + 1
      expect(result.items[9].rank).toBe(20); // skip (10) + 9 + 1
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('handles custom pagination parameters (e.g., page=3, limit=5)', async () => {
      const page3Items = Array.from({ length: 5 }, (_, i) => ({
        id: `lb-${i + 11}`,
        examId,
        userId: `user-${i + 11}`,
        fullName: `Candidate ${i + 11}`,
        avatar: null,
        bestScore: 80 - i,
        durationSeconds: 150 + i * 10,
        submittedAt: new Date(),
      }));

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(page3Items);
      mockPrisma.examLeaderboard.count.mockResolvedValue(50);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const query: ExamResultsQueryDto = { page: 3, limit: 5 };
      const result = await repository.listResults(examId, query);

      // skip = (3 - 1) * 5 = 10, take = 5
      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 10,
        take: 5,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(result.items[0].rank).toBe(11); // 10 + 0 + 1
      expect(result.items[4].rank).toBe(15); // 10 + 4 + 1
      expect(result.meta.totalPages).toBe(10);
    });

    it('defaults to page=1 and limit=10 when query parameters are omitted', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(examId, {} as ExamResultsQueryDto);

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 0,
        take: 10,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(10);
      expect(result.meta.totalPages).toBe(0);
    });

    it('supports custom skip and take directly on query object', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(50);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      await repository.listResults(examId, { skip: 30, take: 15 } as any);

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 30,
        take: 15,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });
    });
  });

  // =========================================================================
  // Robustness, Null-safety and Error Handling
  // =========================================================================
  describe('Robustness and Edge Cases', () => {
    it('returns null and skips upsert if attempt score is null or undefined', async () => {
      const nullScoreAttempt = {
        id: 'att-null',
        examId,
        userId: 'user-1',
        startedAt: new Date(),
        score: null,
      };

      const result = await leaderboardService.updateLeaderboardOnSubmission(nullScoreAttempt);

      expect(result).toBeNull();
      expect(mockPrisma.examLeaderboard.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.examLeaderboard.upsert).not.toHaveBeenCalled();
    });

    it('gracefully falls back to zeroed summary stats when stats record is missing', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(examId, { page: 1, limit: 10 });

      expect(result.stats).toEqual({
        totalAttempts: 0,
        submittedCount: 0,
        inProgressCount: 0,
        cancelledCount: 0,
        averageScore: null,
        highestScore: null,
        lowestScore: null,
      });
      expect(result.summary).toEqual(result.stats);
    });

    it('queries user profile when user fullName is not present in attempt', async () => {
      mockPrisma.examLeaderboard.findUnique.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        fullName: 'Lookup Name',
        avatar: 'https://example.com/lookup.png',
      });
      mockPrisma.examLeaderboard.upsert.mockResolvedValue({
        id: 'lb-1',
        examId,
        userId: 'user-lookup',
        bestScore: 88.0,
        durationSeconds: 180,
      });
      jest.spyOn(leaderboardService, 'recalculateSummaryStats').mockResolvedValue({} as any);

      const attempt = {
        id: 'att-lookup',
        examId,
        userId: 'user-lookup',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        submittedAt: new Date('2026-01-01T10:03:00Z'),
        score: 88.0,
      };

      await leaderboardService.updateLeaderboardOnSubmission(attempt);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-lookup' },
        select: { fullName: true, avatar: true },
      });
      expect(mockPrisma.examLeaderboard.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            fullName: 'Lookup Name',
            avatar: 'https://example.com/lookup.png',
          }),
        }),
      );
    });
  });
});
