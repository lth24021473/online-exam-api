import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';

type MockType<T> = { [P in keyof T]?: jest.Mock };

describe('UsersService', () => {
  let service: UsersService;
  let repository: MockType<UsersRepository>;

  const mockUser = {
    id: 'user-123',
    email: 'student@example.com',
    passwordHash: '$2b$12$someHashedPasswordString',
    fullName: 'Nguyễn Văn A',
    role: Role.STUDENT,
    avatar: 'https://example.com/avatar.png',
    cover: 'https://example.com/cover.png',
    workplace: 'Đại học Quốc gia',
    currentResidence: 'Hà Nội',
    authVersion: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findAll: jest.fn(),
      updateRole: jest.fn(),
      updateProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('updateProfile', () => {
    it('successfully updates user profile and strips sensitive properties', async () => {
      repository.findById!.mockResolvedValue(mockUser);

      const dto: UpdateProfileDto = {
        fullName: 'Nguyễn Văn B',
        workplace: 'FPT Software',
        currentResidence: 'Đà Nẵng',
        avatar: 'https://example.com/new-avatar.png',
        cover: null,
      };

      const updatedUser = {
        ...mockUser,
        ...dto,
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      };
      repository.updateProfile!.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(mockUser.id, dto);

      expect(repository.findById).toHaveBeenCalledWith(mockUser.id);
      expect(repository.updateProfile).toHaveBeenCalledWith(mockUser.id, dto);
      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        fullName: 'Nguyễn Văn B',
        role: Role.STUDENT,
        avatar: 'https://example.com/new-avatar.png',
        cover: null,
        workplace: 'FPT Software',
        currentResidence: 'Đà Nẵng',
        createdAt: mockUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('authVersion');
    });

    it('throws NotFoundException when updating non-existent user', async () => {
      repository.findById!.mockResolvedValue(null);

      const dto: UpdateProfileDto = {
        fullName: 'Nguyễn Văn B',
      };

      await expect(service.updateProfile('non-existent-id', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('getPublicUserById', () => {
    it('returns public user object without passwordHash and authVersion', async () => {
      repository.findById!.mockResolvedValue(mockUser);

      const result = await service.getPublicUserById(mockUser.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockUser.id);
      expect(result?.email).toBe(mockUser.email);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('authVersion');
    });

    it('returns null when user not found', async () => {
      repository.findById!.mockResolvedValue(null);

      const result = await service.getPublicUserById('unknown-id');
      expect(result).toBeNull();
    });
  });
});

