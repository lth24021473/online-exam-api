import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import {
  ClassroomsRepository,
  stripPassword,
} from './classrooms.repository';

describe('ClassroomsRepository', () => {
  let repository: ClassroomsRepository;

  const mockPrismaService = {
    classroom: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    classroomMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    exam: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassroomsRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    repository = module.get<ClassroomsRepository>(ClassroomsRepository);
  });

  describe('stripPassword utility', () => {
    it('should remove password field from object', () => {
      const obj = { id: 'c1', name: 'Lop 10A', password: 'hashed_password' };
      const stripped = stripPassword(obj);
      expect(stripped).toEqual({ id: 'c1', name: 'Lop 10A' });
      expect((stripped as any).password).toBeUndefined();
    });
  });

  describe('create', () => {
    it('should create classroom and strip password', async () => {
      mockPrismaService.classroom.create.mockResolvedValue({
        id: 'c1',
        name: 'Lop 10A',
        code: 'ABC234',
        password: '$2b$10$hashedpassword',
        managerId: 'm1',
      });

      const result = await repository.create({
        name: 'Lop 10A',
        password: '$2b$10$hashedpassword',
        code: 'ABC234',
        managerId: 'm1',
      });

      expect(result.id).toBe('c1');
      expect((result as any).password).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should return classroom without password if found', async () => {
      mockPrismaService.classroom.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'Lop 10A',
        code: 'ABC234',
        password: '$2b$10$hashedpassword',
        managerId: 'm1',
      });

      const result = await repository.findById('c1');
      expect(result?.id).toBe('c1');
      expect((result as any)?.password).toBeUndefined();
    });

    it('should return null if classroom not found', async () => {
      mockPrismaService.classroom.findUnique.mockResolvedValue(null);
      const result = await repository.findById('c-none');
      expect(result).toBeNull();
    });
  });

  describe('findManaged', () => {
    it('should return classrooms without password', async () => {
      mockPrismaService.classroom.findMany.mockResolvedValue([
        {
          id: 'c1',
          name: 'Lop 10A',
          password: '$2b$10$hashedpassword',
        },
      ]);

      const result = await repository.findManaged('m1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
      expect((result[0] as any).password).toBeUndefined();
    });
  });
});
