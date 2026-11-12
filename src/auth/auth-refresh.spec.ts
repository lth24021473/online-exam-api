import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { TokenRevocationService } from './token-revocation.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ExecutionContext } from '@nestjs/common';

describe('AuthService - Refresh Token (Silent Refresh)', () => {
  let authService: AuthService;
  let jwtService: JwtService;
  let tokenRevocationService: TokenRevocationService;
  let guard: JwtAuthGuard;

  const mockUser: User = {
    id: '507f1f77bcf86cd799439011',
    email: 'student@example.com',
    passwordHash: 'hashed-password-123',
    fullName: 'Test Student',
    role: Role.STUDENT,
    avatar: null,
    cover: null,
    workplace: null,
    currentResidence: null,
    authVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const revokedTokens = new Set<string>();

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
    revokedToken: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const mockUsersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
  };

  const mockMailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  beforeEach(async () => {
    revokedTokens.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: 'test-secret-key-1234567890',
          signOptions: { expiresIn: 3600 },
        }),
      ],
      providers: [
        AuthService,
        JwtAuthGuard,
        TokenRevocationService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
    tokenRevocationService = module.get<TokenRevocationService>(TokenRevocationService);
    guard = module.get<JwtAuthGuard>(JwtAuthGuard);

    mockPrisma.revokedToken.findUnique.mockImplementation(async ({ where }) => {
      return revokedTokens.has(where.tokenHash)
        ? { tokenHash: where.tokenHash, expiresAt: new Date(Date.now() + 60000) }
        : null;
    });

    mockPrisma.revokedToken.upsert.mockImplementation(async ({ create }) => {
      revokedTokens.add(create.tokenHash);
      return create;
    });

    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
  });

  describe('createAuthResponse via login/register', () => {
    it('issues both accessToken and refreshToken with correct claims and stripped user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(mockUser);
      // Test via login or direct call
      const result = await authService['createAuthResponse'](mockUser);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');

      // Verify safe user
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('authVersion');
      expect(result.user.email).toBe(mockUser.email);
      expect(result.user.fullName).toBe(mockUser.fullName);

      // Verify access token claims
      const accessPayload = await jwtService.verifyAsync(result.accessToken);
      expect(accessPayload.sub).toBe(mockUser.id);
      expect(accessPayload.email).toBe(mockUser.email);
      expect(accessPayload.role).toBe(mockUser.role);
      expect(accessPayload.authVersion).toBe(mockUser.authVersion);
      expect(accessPayload.tokenType).toBe('access');

      // Verify refresh token claims
      const refreshPayload = await jwtService.verifyAsync(result.refreshToken);
      expect(refreshPayload.sub).toBe(mockUser.id);
      expect(refreshPayload.email).toBe(mockUser.email);
      expect(refreshPayload.role).toBe(mockUser.role);
      expect(refreshPayload.authVersion).toBe(mockUser.authVersion);
      expect(refreshPayload.tokenType).toBe('refresh');

      // Refresh token expires later than access token
      expect(refreshPayload.exp).toBeGreaterThan(accessPayload.exp);
    });
  });

  describe('refresh', () => {
    it('successfully refreshes tokens when given a valid refresh token', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);

      const result = await authService.refresh({ refreshToken });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.email).toBe(mockUser.email);

      // New tokens should also be valid
      const newAccessClaims = await jwtService.verifyAsync(result.accessToken);
      expect(newAccessClaims.tokenType).toBe('access');
      const newRefreshClaims = await jwtService.verifyAsync(result.refreshToken);
      expect(newRefreshClaims.tokenType).toBe('refresh');
    });

    it('rejects missing or empty refresh token', async () => {
      await expect(
        authService.refresh({ refreshToken: '' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects invalid or malformed refresh token', async () => {
      await expect(
        authService.refresh({ refreshToken: 'invalid.jwt.token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects expired refresh token', async () => {
      const expiredRefreshToken = await jwtService.signAsync(
        {
          sub: mockUser.id,
          email: mockUser.email,
          role: mockUser.role,
          authVersion: mockUser.authVersion,
          tokenType: 'refresh',
        },
        { expiresIn: -10 },
      );

      await expect(
        authService.refresh({ refreshToken: expiredRefreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an accessToken passed as a refresh token', async () => {
      const { accessToken } = await authService['createAuthResponse'](mockUser);

      await expect(
        authService.refresh({ refreshToken: accessToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a revoked refresh token', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);
      const decoded = jwtService.decode(refreshToken) as { exp: number };

      await tokenRevocationService.revoke(refreshToken, decoded.exp);

      await expect(
        authService.refresh({ refreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects refresh when user permissions or authVersion changed', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);

      // Simulate authVersion increment in DB
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        authVersion: (mockUser.authVersion ?? 0) + 1,
      });

      await expect(
        authService.refresh({ refreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects refresh when user role changed in DB', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);

      // Simulate role change in DB
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: Role.EXAM_MANAGER,
      });

      await expect(
        authService.refresh({ refreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects refresh when account no longer exists in DB', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);

      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('JwtAuthGuard protection against refresh token abuse', () => {
    it('rejects refresh token when used as Bearer token on protected endpoints', async () => {
      const { refreshToken } = await authService['createAuthResponse'](mockUser);

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              authorization: `Bearer ${refreshToken}`,
            },
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        new UnauthorizedException('Refresh token cannot be used as access token'),
      );
    });

    it('allows valid access token on protected endpoints', async () => {
      const { accessToken } = await authService['createAuthResponse'](mockUser);

      const req: any = {
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as unknown as ExecutionContext;

      const allowed = await guard.canActivate(mockContext);
      expect(allowed).toBe(true);
      expect(req.user.id).toBe(mockUser.id);
      expect(req.user.role).toBe(mockUser.role);
    });
  });

  describe('RefreshTokenDto validation', () => {
    it('validates a valid payload', async () => {
      const dto = plainToInstance(RefreshTokenDto, {
        refreshToken: 'valid-refresh-token-string',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects missing or empty refreshToken', async () => {
      const dto = plainToInstance(RefreshTokenDto, {
        refreshToken: '',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects non-string refreshToken', async () => {
      const dto = plainToInstance(RefreshTokenDto, {
        refreshToken: 12345,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

