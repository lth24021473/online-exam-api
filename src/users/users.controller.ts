import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';

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
}
