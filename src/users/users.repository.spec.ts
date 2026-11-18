import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { UsersRepository } from './users.repository';
import { Role } from '@prisma/client';

describe('UsersRepository', () => {
  let repository: UsersRepository;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    repository = module.get<UsersRepository>(UsersRepository);
  });

  describe('findAll', () => {
    it('returns paginated data and meta with default page=1, limit=20', async () => {
      const mockUsers = [
        {
          id: 'u1',
          email: 'u1@example.com',
          fullName: 'User One',
          role: Role.STUDENT,
        },
      ];
      mockPrismaService.user.count.mockResolvedValue(45);
      mockPrismaService.user.findMany.mockResolvedValue(mockUsers);

      const result = await repository.findAll();

      expect(mockPrismaService.user.count).toHaveBeenCalledWith({ where: {} });
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: expect.objectContaining({
          id: true,
          email: true,
          fullName: true,
          role: true,
        }),
      });
      expect(result).toEqual({
        data: mockUsers,
        meta: {
          total: 45,
          page: 1,
          limit: 20,
          totalPages: 3,
        },
      });
    });

    it('calculates skip and take for custom page and limit', async () => {
      mockPrismaService.user.count.mockResolvedValue(50);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await repository.findAll(3, 15);

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 30, // (3 - 1) * 15
          take: 15,
        }),
      );
      expect(result.meta).toEqual({
        total: 50,
        page: 3,
        limit: 15,
        totalPages: 4, // Math.ceil(50 / 15)
      });
    });

    it('applies search filter on email and fullName with insensitive mode', async () => {
      mockPrismaService.user.count.mockResolvedValue(1);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      await repository.findAll(1, 20, '  john  ');

      const expectedWhere = {
        OR: [
          { email: { contains: 'john', mode: 'insensitive' } },
          { fullName: { contains: 'john', mode: 'insensitive' } },
        ],
      };

      expect(mockPrismaService.user.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
        }),
      );
    });

    it('clamps limit to maximum 100', async () => {
      mockPrismaService.user.count.mockResolvedValue(0);
      mockPrismaService.user.findMany.mockResolvedValue([]);

      const result = await repository.findAll(1, 500);

      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 100,
        }),
      );
      expect(result.meta.limit).toBe(100);
    });
  });

  describe('updateProfile', () => {
    it('updates user profile URLs via prisma.user.update', async () => {
      const payload = {
        avatar: 'https://s3.example.com/avatars/user-123.jpg',
        cover: 'https://s3.example.com/covers/user-123.jpg',
      };
      const updated = { id: 'u1', ...payload };
      mockPrismaService.user.update.mockResolvedValue(updated);

      const result = await repository.updateProfile('u1', payload);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: payload,
      });
      expect(result).toEqual(updated);
    });

    it('allows clearing avatar and cover by passing null', async () => {
      const payload = { avatar: null, cover: null };
      const updated = { id: 'u1', ...payload };
      mockPrismaService.user.update.mockResolvedValue(updated);

      const result = await repository.updateProfile('u1', payload);

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatar: null, cover: null },
      });
      expect(result).toEqual(updated);
    });
  });
});
