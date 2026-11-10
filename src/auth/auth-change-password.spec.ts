import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { TokenRevocationService } from './token-revocation.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { ChangePasswordDto } from './dto/change-password.dto';

describe('AuthService - changePassword', () => {
  let authService: AuthService;

  const rawOldPassword = 'OldPassword123';
  let hashedOldPassword: string;

  const mockUser = {
    id: 'user-change-pass-1',
    email: 'student@example.com',
    passwordHash: '',
    fullName: 'Test Student',
    role: Role.STUDENT,
    authVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn(),
  };

  const mockUsersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
  };

  const mockRevocations = {
    revoke: jest.fn(),
    isRevoked: jest.fn(),
  };

  const mockMailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  beforeAll(async () => {
    hashedOldPassword = await bcrypt.hash(rawOldPassword, 10);
    mockUser.passwordHash = hashedOldPassword;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: TokenRevocationService, useValue: mockRevocations },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('successfully changes password when current password matches', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
    const updatedUser = {
      ...mockUser,
      passwordHash: '$2b$12$newHashedPasswordMock',
      authVersion: 2,
    };
    mockPrisma.user.update.mockResolvedValue(updatedUser);
    mockJwtService.signAsync.mockResolvedValue('mock-new-access-token');

    const dto: ChangePasswordDto = {
      currentPassword: rawOldPassword,
      newPassword: 'BrandNewSecret999',
    };

    const result = await authService.changePassword(mockUser.id, dto);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: mockUser.id },
    });
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: mockUser.id,
        OR: [{ authVersion: { isSet: false } }, { authVersion: null }],
      },
      data: { authVersion: 0 },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: mockUser.id },
      data: {
        passwordHash: expect.any(String),
        authVersion: { increment: 1 },
      },
    });
    expect(mockJwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: mockUser.id,
        email: mockUser.email,
        role: mockUser.role,
        authVersion: 2,
      }),
    );
    expect(result).toEqual({
      message: 'Password changed successfully',
      accessToken: 'mock-new-access-token',
    });
  });

  it('rejects when current password does not match', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const dto: ChangePasswordDto = {
      currentPassword: 'WrongPassword456',
      newPassword: 'BrandNewSecret999',
    };

    await expect(authService.changePassword(mockUser.id, dto)).rejects.toThrow(
      new BadRequestException('Current password is incorrect'),
    );
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects when new password is the same as current password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const dto: ChangePasswordDto = {
      currentPassword: rawOldPassword,
      newPassword: rawOldPassword,
    };

    await expect(authService.changePassword(mockUser.id, dto)).rejects.toThrow(
      new BadRequestException(
        'New password must be different from current password',
      ),
    );
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when user account does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const dto: ChangePasswordDto = {
      currentPassword: rawOldPassword,
      newPassword: 'BrandNewSecret999',
    };

    await expect(
      authService.changePassword('non-existent-user-id', dto),
    ).rejects.toThrow(new NotFoundException('Account no longer exists'));
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  describe('ChangePasswordDto validation', () => {
    it('validates a valid payload', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'OldPassword123',
        newPassword: 'NewPassword123',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects missing current password', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: '',
        newPassword: 'NewPassword123',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'currentPassword')).toBe(true);
    });

    it('rejects new password shorter than 6 characters', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'OldPassword123',
        newPassword: '12345',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
    });

    it('rejects new password exceeding 72 bytes', async () => {
      const dto = plainToInstance(ChangePasswordDto, {
        currentPassword: 'OldPassword123',
        newPassword: 'a'.repeat(73),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
    });
  });
});

