import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiBadRequestResponse, ApiCreatedResponse,
  ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse,
  ApiOperation, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AttemptsService } from './attempts.service';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { SaveAnswersDto } from './dto/save-answers.dto';

@ApiTags('Attempts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[STUDENT] Start a new exam attempt' })
  @ApiCreatedResponse({ description: 'Attempt started with deadline calculated from exam duration' })
  @ApiBadRequestResponse({ description: 'Exam not published or already has an in-progress attempt' })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  start(@Req() req: AuthenticatedRequest, @Body() dto: StartAttemptDto) {
    return this.attemptsService.start(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: '[STUDENT] List all my attempts' })
  @ApiOkResponse({ description: 'List of attempts ordered by start date' })
  findAll(@Req() req: AuthenticatedRequest) {
    return this.attemptsService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '[STUDENT] Get attempt detail with answers' })
  @ApiOkResponse({ description: 'Attempt detail including answers saved so far' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  @ApiForbiddenResponse({ description: 'Not your attempt' })
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.attemptsService.findOne(id, req.user.id);
  }

  @Put(':id/answers')
  @ApiOperation({ summary: '[STUDENT] Save or update answers (can call multiple times before submit)' })
  @ApiOkResponse({ description: 'Answers saved' })
  @ApiBadRequestResponse({ description: 'Attempt already submitted or deadline passed' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  @ApiForbiddenResponse({ description: 'Not your attempt' })
  saveAnswers(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.attemptsService.saveAnswers(id, req.user.id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[STUDENT] Submit attempt and get score' })
  @ApiOkResponse({ description: 'Attempt submitted with score, correctCount, incorrectCount' })
  @ApiBadRequestResponse({ description: 'Attempt already submitted' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  @ApiForbiddenResponse({ description: 'Not your attempt' })
  submit(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.attemptsService.submit(id, req.user.id);
  }
}
