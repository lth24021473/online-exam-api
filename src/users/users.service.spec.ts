import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
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

    it('persists cover URL and clears avatar when avatar is null', async () => {
      repository.findById!.mockResolvedValue(mockUser);

      const dto: UpdateProfileDto = {
        avatar: null,
        cover: 'https://s3.example.com/covers/user-123.jpg',
      };

      const updatedUser = {
        ...mockUser,
        avatar: null,
        cover: 'https://s3.example.com/covers/user-123.jpg',
        updatedAt: new Date('2026-02-02T00:00:00Z'),
      };
      repository.updateProfile!.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(mockUser.id, dto);

      expect(repository.updateProfile).toHaveBeenCalledWith(mockUser.id, {
        avatar: null,
        cover: 'https://s3.example.com/covers/user-123.jpg',
      });
      expect(result.avatar).toBeNull();
      expect(result.cover).toBe('https://s3.example.com/covers/user-123.jpg');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('authVersion');
    });

    it('omits undefined properties on partial updates without overwriting existing images', async () => {
      repository.findById!.mockResolvedValue(mockUser);

      const dto = plainToInstance(UpdateProfileDto, {
        fullName: 'Nguyễn Văn C',
      });

      const updatedUser = {
        ...mockUser,
        fullName: 'Nguyễn Văn C',
        updatedAt: new Date('2026-02-03T00:00:00Z'),
      };
      repository.updateProfile!.mockResolvedValue(updatedUser);

      const result = await service.updateProfile(mockUser.id, dto);

      const passedPayload = repository.updateProfile!.mock.calls[0][1];
      expect(passedPayload).toEqual({ fullName: 'Nguyễn Văn C' });
      expect(Object.prototype.hasOwnProperty.call(passedPayload, 'avatar')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(passedPayload, 'cover')).toBe(false);
      expect(result.avatar).toBe(mockUser.avatar);
      expect(result.cover).toBe(mockUser.cover);
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

  describe('findAllPublicUsers', () => {
    it('delegates pagination and search query to repository', async () => {
      const mockResult = {
        data: [mockUser],
        meta: {
          total: 1,
          page: 2,
          limit: 10,
          totalPages: 1,
        },
      };
      repository.findAll!.mockResolvedValue(mockResult as any);

      const result = await service.findAllPublicUsers({
        page: 2,
        limit: 10,
        search: 'test@example.com',
      });

      expect(repository.findAll).toHaveBeenCalledWith(2, 10, 'test@example.com');
      expect(result).toEqual(mockResult);
    });

    it('uses undefined parameters when query is omitted', async () => {
      repository.findAll!.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } as any);

      await service.findAllPublicUsers();

      expect(repository.findAll).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  describe('UpdateProfileDto validation', () => {
    it('accepts valid URLs within 500 characters for avatar and cover', async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        avatar: 'https://s3.example.com/avatars/user-123.jpg',
        cover: 'https://cdn.example.com/covers/user-123.webp',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts exact 500-character URLs for avatar and cover', async () => {
      const prefix = 'https://s3.example.com/avatars/';
      const exact500Url = prefix + 'a'.repeat(500 - prefix.length);
      expect(exact500Url).toHaveLength(500);

      const dto = plainToInstance(UpdateProfileDto, {
        avatar: exact500Url,
        cover: exact500Url,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('accepts null and undefined for avatar and cover', async () => {
      const nullDto = plainToInstance(UpdateProfileDto, {
        avatar: null,
        cover: null,
      });
      expect(await validate(nullDto)).toHaveLength(0);
      expect(nullDto.avatar).toBeNull();
      expect(nullDto.cover).toBeNull();

      const omittedDto = plainToInstance(UpdateProfileDto, {});
      expect(await validate(omittedDto)).toHaveLength(0);
      expect(omittedDto.avatar).toBeUndefined();
      expect(omittedDto.cover).toBeUndefined();
    });

    it.each([
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    ])('rejects Base64 data URI (%s) for avatar and cover', async (base64) => {
      const avatarDto = plainToInstance(UpdateProfileDto, { avatar: base64 });
      const avatarErrors = await validate(avatarDto);
      const avatarError = avatarErrors.find((e) => e.property === 'avatar');
      expect(avatarError?.constraints?.isUrl).toBeDefined();

      const coverDto = plainToInstance(UpdateProfileDto, { cover: base64 });
      const coverErrors = await validate(coverDto);
      const coverError = coverErrors.find((e) => e.property === 'cover');
      expect(coverError?.constraints?.isUrl).toBeDefined();
    });

    it.each(['not-a-url', '', '   ', 'javascript:alert(1)', 12345])(
      'rejects invalid non-URL value (%p) for avatar and cover',
      async (invalidValue) => {
        const avatarDto = plainToInstance(UpdateProfileDto, {
          avatar: invalidValue,
        });
        const avatarErrors = await validate(avatarDto);
        const avatarError = avatarErrors.find((e) => e.property === 'avatar');
        expect(avatarError?.constraints?.isUrl).toBeDefined();

        const coverDto = plainToInstance(UpdateProfileDto, {
          cover: invalidValue,
        });
        const coverErrors = await validate(coverDto);
        const coverError = coverErrors.find((e) => e.property === 'cover');
        expect(coverError?.constraints?.isUrl).toBeDefined();
      },
    );

    it('rejects URLs exceeding 500 characters for avatar and cover', async () => {
      const prefix = 'https://s3.example.com/avatars/';
      const url501 = prefix + 'a'.repeat(501 - prefix.length);
      expect(url501).toHaveLength(501);

      const avatarDto = plainToInstance(UpdateProfileDto, { avatar: url501 });
      const avatarErrors = await validate(avatarDto);
      const avatarError = avatarErrors.find((e) => e.property === 'avatar');
      expect(avatarError?.constraints?.maxLength).toBeDefined();

      const coverDto = plainToInstance(UpdateProfileDto, { cover: url501 });
      const coverErrors = await validate(coverDto);
      const coverError = coverErrors.find((e) => e.property === 'cover');
      expect(coverError?.constraints?.maxLength).toBeDefined();
    });
  });
});

