import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out the current access token' })
  @ApiNoContentResponse({ description: 'Access token revoked' })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired or revoked token',
  })
  async logout(@Req() request: AuthenticatedRequest) {
    await this.authService.logout(request.auth.token, request.auth.exp);
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a student account' })
  @ApiCreatedResponse({
    description:
      'Student account created; returns accessToken, refreshToken and user without passwordHash',
  })
  @ApiBadRequestResponse({ description: 'Invalid registration data' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login to the system',
  })
  @ApiOkResponse({
    description:
      'Login successful; returns accessToken, refreshToken and user without passwordHash',
  })
  @ApiUnauthorizedResponse({ description: 'Email or password is incorrect' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using a valid refresh token' })
  @ApiOkResponse({
    description:
      'Token refreshed successfully; returns new accessToken, refreshToken and user',
  })
  @ApiBadRequestResponse({ description: 'Invalid refresh token data' })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked refresh token',
  })
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset 6-digit code or link via email' })
  @ApiOkResponse({
    description:
      'If the email is registered, a 6-digit password reset code and link will be sent',
  })
  @ApiBadRequestResponse({ description: 'Invalid email address' })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using 6-digit code received via email' })
  @ApiOkResponse({ description: 'Password reset successfully' })
  @ApiBadRequestResponse({
    description: 'Invalid or expired code, or invalid new password',
  })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for the authenticated account' })
  @ApiOkResponse({ description: 'Password changed successfully' })
  @ApiBadRequestResponse({
    description: 'Current password incorrect or invalid new password',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired or revoked token',
  })
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(request.user.id, changePasswordDto);
  }
}
