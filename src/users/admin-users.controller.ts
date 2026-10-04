import {
  Controller, Delete, Get, HttpCode, HttpStatus,
  NotFoundException, Param, Patch, Body, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiNoContentResponse, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersRepository } from './users.repository';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@ApiTags('Admin — Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersRepository: UsersRepository) {}

  @Get()
  @ApiOperation({ summary: '[ADMIN] List all users' })
  @ApiOkResponse({ description: 'List of all users (passwordHash excluded)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'ADMIN role required' })
  findAll() {
    return this.usersRepository.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '[ADMIN] Get a single user by ID' })
  @ApiOkResponse({ description: 'User detail' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async findOne(@Param('id') id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash: _ph, ...publicUser } = user;
    return publicUser;
  }

  @Patch(':id/role')
  @ApiOperation({ summary: '[ADMIN] Change a user role' })
  @ApiOkResponse({ description: 'User role updated' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return this.usersRepository.updateRole(id, dto.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[ADMIN] Delete a user account' })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async remove(@Param('id') id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    await this.usersRepository.deleteById(id);
  }
}
