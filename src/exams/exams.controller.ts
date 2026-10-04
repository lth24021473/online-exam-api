import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ExamsService } from './exams.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

@ApiTags('Exams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @Post()
  @Roles(Role.EXAM_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[EXAM_MANAGER] Create a new exam (DRAFT)' })
  @ApiCreatedResponse({ description: 'Exam created in DRAFT status' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Insufficient role' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateExamDto) {
    return this.examsService.create(req.user.id, dto);
  }

  @Get()
  @Roles(Role.EXAM_MANAGER, Role.STUDENT, Role.ADMIN)
  @ApiOperation({ summary: 'List exams — admin: all; manager: own; student: published' })
  @ApiOkResponse({ description: 'List of exams' })
  findAll(@Req() req: AuthenticatedRequest) {
    return this.examsService.findAll(req.user.id, req.user.role as Role);
  }

  @Get(':id')
  @Roles(Role.EXAM_MANAGER, Role.STUDENT, Role.ADMIN)
  @ApiOperation({ summary: 'Get exam detail — admin: any; manager: own; student: published only' })
  @ApiOkResponse({ description: 'Exam detail with questions' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiForbiddenResponse({ description: 'Not published (student) or not owner (manager)' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.examsService.findOne(id, req.user.id, req.user.role as Role);
  }

  @Patch(':id')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Update exam metadata' })
  @ApiOkResponse({ description: 'Exam updated' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiForbiddenResponse({ description: 'Not the owner or insufficient role' })
  update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateExamDto,
  ) {
    return this.examsService.update(id, req.user.id, dto, req.user.role as Role);
  }

  @Delete(':id')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Delete a DRAFT exam' })
  @ApiNoContentResponse({ description: 'Exam deleted' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiForbiddenResponse({ description: 'Not the owner or not DRAFT' })
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.examsService.remove(id, req.user.id, req.user.role as Role);
  }

  @Put(':id/publish')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Publish a DRAFT exam' })
  @ApiOkResponse({ description: 'Exam is now PUBLISHED' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiForbiddenResponse({ description: 'Not the owner, not DRAFT, or no questions' })
  publish(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.examsService.publish(id, req.user.id, req.user.role as Role);
  }

  @Put(':id/close')
  @Roles(Role.EXAM_MANAGER, Role.ADMIN)
  @ApiOperation({ summary: '[EXAM_MANAGER/ADMIN] Close a PUBLISHED exam' })
  @ApiOkResponse({ description: 'Exam is now CLOSED' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiForbiddenResponse({ description: 'Not the owner or not PUBLISHED' })
  close(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.examsService.close(id, req.user.id, req.user.role as Role);
  }
}
