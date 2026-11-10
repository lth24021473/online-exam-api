import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated account' })
  @ApiOkResponse({ description: 'Current account without passwordHash' })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or revoked token, or deleted account',
  })
  async me(@Req() request: AuthenticatedRequest) {
    const user = await this.usersService.getPublicUserById(request.user.id);
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return user;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update profile information for the authenticated account' })
  @ApiOkResponse({ description: 'Updated account information' })
  @ApiBadRequestResponse({ description: 'Invalid profile data' })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired or revoked token, or deleted account',
  })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(request.user.id, dto);
  }
}
