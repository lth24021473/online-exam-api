import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiForbiddenResponse,
  ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

@ApiTags('Questions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.EXAM_MANAGER)
@Controller('exams/:examId/questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[EXAM_MANAGER] Add a question to an exam' })
  @ApiCreatedResponse({ description: 'Question created' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Not the owner or exam is closed' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  create(
    @Param('examId') examId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionsService.create(examId, req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '[EXAM_MANAGER] List all questions in an exam' })
  @ApiOkResponse({ description: 'Questions ordered by position' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  findAll(@Param('examId') examId: string, @Req() req: AuthenticatedRequest) {
    return this.questionsService.findAll(examId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '[EXAM_MANAGER] Get a single question' })
  @ApiOkResponse({ description: 'Question detail' })
  @ApiNotFoundResponse({ description: 'Exam or question not found' })
  findOne(
    @Param('examId') examId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.questionsService.findOne(examId, id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[EXAM_MANAGER] Update a question' })
  @ApiOkResponse({ description: 'Question updated' })
  @ApiNotFoundResponse({ description: 'Exam or question not found' })
  @ApiForbiddenResponse({ description: 'Not the owner or exam is closed' })
  update(
    @Param('examId') examId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questionsService.update(examId, id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[EXAM_MANAGER] Delete a question' })
  @ApiNoContentResponse({ description: 'Question deleted' })
  @ApiNotFoundResponse({ description: 'Exam or question not found' })
  @ApiForbiddenResponse({ description: 'Not the owner or exam is closed' })
  async remove(
    @Param('examId') examId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.questionsService.remove(examId, id, req.user.id);
  }
}
