import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ParseObjectIdPipe } from '../attempts/parse-object-id.pipe';
import { UsersService } from './users.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@ApiTags('Admin — Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] List all users' })
  @ApiOkResponse({ description: 'List of all users (passwordHash excluded)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'ADMIN role required' })
  findAll() {
    return this.usersService.findAllPublicUsers();
  }

  @Get(':id')
  @ApiOperation({ summary: '[ADMIN] Get a single user by ID' })
  @ApiOkResponse({ description: 'User detail' })
  @ApiBadRequestResponse({ description: 'Invalid user ID' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.findPublicUserOrFail(id);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: '[ADMIN] Change a user role' })
  @ApiOkResponse({ description: 'User role updated' })
  @ApiBadRequestResponse({ description: 'Invalid user ID or role' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async updateRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateRole(id, dto.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[ADMIN] Delete a user account' })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiBadRequestResponse({ description: 'Invalid user ID' })
  @ApiConflictResponse({ description: 'User still owns exams or attempts' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async remove(@Param('id', ParseObjectIdPipe) id: string) {
    await this.usersService.remove(id);
  }
}
