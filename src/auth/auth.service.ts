import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { TokenRevocationService } from './token-revocation.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly revocations: TokenRevocationService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 12);
    let user: User;
    try {
      user = await this.usersService.create({
        email: registerDto.email,
        fullName: registerDto.fullName,
        passwordHash,
      });
    } catch (error) {
      // The unique index also protects concurrent registrations for one email.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }

    return this.createAuthResponse(user);
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    return this.createAuthResponse(user);
  }

  async logout(token: string, expiresAt: number) {
    await this.revocations.revoke(token, expiresAt);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    // Security best practice: Always return generic success message to prevent user enumeration
    if (!user) {
      return {
        message:
          'If your email is registered in our system, you will receive a password reset code shortly.',
      };
    }

    // Generate a 6-digit verification code (e.g. 100000 to 999999)
    let rawToken: string;
    let tokenHash: string;
    let attempts = 0;
    do {
      rawToken = randomInt(100000, 1000000).toString();
      tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const existing = await this.prisma.passwordResetToken.findUnique({
        where: { tokenHash },
      });
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes validity

    // Delete existing reset tokens for this email to prevent collisions
    await this.prisma.passwordResetToken.deleteMany({
      where: { email: user.email },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash,
        email: user.email,
        expiresAt,
      },
    });

    await this.mailService.sendPasswordResetEmail(user.email, rawToken);

    return {
      message:
        'If your email is registered in our system, you will receive a password reset code shortly.',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const normalizedToken = dto.token.replace(/\s+|-/g, '').trim();
    const tokenHash = createHash('sha256').update(normalizedToken).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.email !== dto.email) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    if (resetToken.expiresAt.getTime() < Date.now()) {
      await this.prisma.passwordResetToken
        .delete({ where: { tokenHash } })
        .catch(() => {});
      throw new BadRequestException(
        'Password reset token has expired. Please request a new one',
      );
    }

    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    // Set authVersion to 0 if missing, then increment to invalidate existing JWT sessions
    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ authVersion: { isSet: false } }, { authVersion: null }],
      },
      data: { authVersion: 0 },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
    });

    // Clean up reset token for this email
    await this.prisma.passwordResetToken
      .deleteMany({ where: { email: user.email } })
      .catch(() => {});

    return {
      message:
        'Password has been reset successfully. Please log in with your new password.',
    };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string; accessToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('Account no longer exists');
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    // Set authVersion to 0 if missing, then increment to invalidate existing JWT sessions
    await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ authVersion: { isSet: false } }, { authVersion: null }],
      },
      data: { authVersion: 0 },
    });

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
    });

    const payload = {
      sub: updated.id,
      email: updated.email,
      role: updated.role,
      authVersion: updated.authVersion ?? 0,
      jti: randomUUID(),
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      message: 'Password changed successfully',
      accessToken,
    };
  }

  async refresh(dto: RefreshTokenDto) {
    if (!dto?.refreshToken || typeof dto.refreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload: {
      sub: string;
      exp: number;
      email: string;
      role: Role;
      authVersion?: number;
      tokenType?: string;
    };

    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        algorithms: ['HS256'],
      });
      if (
        typeof payload.sub !== 'string' ||
        !/^[a-f\d]{24}$/i.test(payload.sub) ||
        typeof payload.email !== 'string' ||
        !payload.email ||
        !Object.values(Role).includes(payload.role) ||
        !Number.isFinite(payload.exp) ||
        (payload.authVersion !== undefined &&
          (!Number.isSafeInteger(payload.authVersion) ||
            payload.authVersion < 0))
      ) {
        throw new Error('Invalid token claims');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (await this.revocations.isRevoked(dto.refreshToken)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    if (
      user.role !== payload.role ||
      (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
    ) {
      throw new UnauthorizedException(
        'Account permissions have changed. Please sign in again',
      );
    }

    return this.createAuthResponse(user);
  }

  private async createAuthResponse(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
      tokenType: 'access',
      jti: randomUUID(),
    };

    const refreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      authVersion: user.authVersion ?? 0,
      tokenType: 'refresh',
      jti: randomUUID(),
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: 15 * 60, // 15 minutes
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      expiresIn: 7 * 24 * 60 * 60, // 7 days
    });

    const {
      passwordHash: _passwordHash,
      authVersion: _authVersion,
      ...safeUser
    } = user;

    return {
      accessToken,
      refreshToken,
      user: safeUser,
    };
  }
}
