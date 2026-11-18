import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { ExamsRepository } from './exams.repository';
import { ExamResultsQueryDto } from './dto/exam-results-query.dto';

describe('ExamsRepository', () => {
  let repository: ExamsRepository;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      examLeaderboard: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      examSummaryStats: {
        findUnique: jest.fn(),
      },
      attempt: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      exam: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamsRepository,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    repository = module.get<ExamsRepository>(ExamsRepository);
  });

  describe('listResults', () => {
    const examId = '660f9e1e8f1b2c0012345678';

    it('queries examLeaderboard and examSummaryStats with correct pagination and sorting', async () => {
      const mockItems = [
        {
          id: 'lb-1',
          examId,
          userId: 'user-1',
          fullName: 'Alice Smith',
          avatar: 'https://example.com/avatar1.png',
          bestScore: 98.5,
          durationSeconds: 120,
          submittedAt: new Date('2026-03-01T10:00:00Z'),
        },
        {
          id: 'lb-2',
          examId,
          userId: 'user-2',
          fullName: 'Bob Jones',
          avatar: null,
          bestScore: 95.0,
          durationSeconds: 180,
          submittedAt: new Date('2026-03-01T10:05:00Z'),
        },
      ];

      const mockStats = {
        id: 'stats-1',
        examId,
        totalAttempts: 45,
        submittedCount: 30,
        averageScore: 82.4,
        highestScore: 98.5,
        lowestScore: 40.0,
        updatedAt: new Date('2026-03-01T10:10:00Z'),
      };

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(mockItems);
      mockPrisma.examLeaderboard.count.mockResolvedValue(30);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(mockStats);

      const query: ExamResultsQueryDto = { page: 2, limit: 10 };
      const result = await repository.listResults(examId, query);

      // Verify queries and parameters
      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 10,
        take: 10,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(mockPrisma.examLeaderboard.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.examLeaderboard.count).toHaveBeenCalledWith({
        where: { examId },
      });

      expect(mockPrisma.examSummaryStats.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.examSummaryStats.findUnique).toHaveBeenCalledWith({
        where: { examId },
      });

      // Verify prisma.attempt is NOT called
      expect(mockPrisma.attempt.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.attempt.count).not.toHaveBeenCalled();
      expect(mockPrisma.attempt.groupBy).not.toHaveBeenCalled();
      expect(mockPrisma.attempt.aggregate).not.toHaveBeenCalled();

      // Verify ranks: skip (10) + idx + 1
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        rank: 11,
        ...mockItems[0],
      });
      expect(result.items[1]).toEqual({
        rank: 12,
        ...mockItems[1],
      });

      // Verify pagination meta
      expect(result.total).toBe(30);
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 30,
        totalPages: 3,
      });

      // Verify aliases
      expect(result.data).toEqual(result.items);
      expect(result.leaderboard).toEqual(result.items);

      // Verify stats and summary
      expect(result.stats).toMatchObject({
        totalAttempts: 45,
        submittedCount: 30,
        averageScore: 82.4,
        highestScore: 98.5,
        lowestScore: 40.0,
      });
      expect(result.summary).toMatchObject({
        totalAttempts: 45,
        submittedCount: 30,
        averageScore: 82.4,
        highestScore: 98.5,
        lowestScore: 40.0,
        inProgressCount: 0,
        cancelledCount: 0,
      });
    });

    it('uses default pagination (page=1, limit=10) when query parameters are omitted', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const result = await repository.listResults(
        examId,
        {} as ExamResultsQueryDto,
      );

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 0,
        take: 10,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('supports custom skip and take if provided', async () => {
      const mockItems = [
        {
          id: 'lb-1',
          examId,
          userId: 'user-1',
          fullName: 'Test User',
          avatar: null,
          bestScore: 100,
          durationSeconds: 60,
          submittedAt: new Date(),
        },
      ];

      mockPrisma.examLeaderboard.findMany.mockResolvedValue(mockItems);
      mockPrisma.examLeaderboard.count.mockResolvedValue(50);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const query = {
        page: 3,
        limit: 5,
        skip: 10,
        take: 5,
      } as unknown as ExamResultsQueryDto;
      const result = await repository.listResults(examId, query);

      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalledWith({
        where: { examId },
        skip: 10,
        take: 5,
        orderBy: [{ bestScore: 'desc' }, { durationSeconds: 'asc' }],
      });

      expect(result.items[0].rank).toBe(11); // skip (10) + 0 + 1
      expect(result.meta.totalPages).toBe(10); // Math.ceil(50 / 5)
    });

    it('provides null-safe fallback when examSummaryStats returns null', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      const query: ExamResultsQueryDto = { page: 1, limit: 10 };
      const result = await repository.listResults(examId, query);

      expect(result.stats).toEqual({
        totalAttempts: 0,
        submittedCount: 0,
        inProgressCount: 0,
        cancelledCount: 0,
        averageScore: null,
        highestScore: null,
        lowestScore: null,
      });

      expect(result.summary).toEqual({
        totalAttempts: 0,
        submittedCount: 0,
        inProgressCount: 0,
        cancelledCount: 0,
        averageScore: null,
        highestScore: null,
        lowestScore: null,
      });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('never calls prisma.attempt.findMany even when query includes status', async () => {
      mockPrisma.examLeaderboard.findMany.mockResolvedValue([]);
      mockPrisma.examLeaderboard.count.mockResolvedValue(0);
      mockPrisma.examSummaryStats.findUnique.mockResolvedValue(null);

      await repository.listResults(examId, {
        page: 1,
        limit: 10,
        status: 'SUBMITTED' as any,
      });

      expect(mockPrisma.attempt.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.examLeaderboard.findMany).toHaveBeenCalled();
    });
  });
});
