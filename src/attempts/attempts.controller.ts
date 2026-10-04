import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AttemptStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ParseObjectIdPipe } from './parse-object-id.pipe';
import { AttemptsService } from './attempts.service';
import { SaveAnswerDto } from './dto/save-answer.dto'

@ApiTags('Attempts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, invalid or revoked token' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT)
@Controller()
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) { }

  @Post('exams/:examId/attempts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start an attempt (or resume the running one) for a published exam',
  })
  @ApiNotFoundResponse({ description: 'Exam not found' })
  @ApiConflictResponse({ description: 'Exam is closed or has no questions' })
  start(
    @Req() request: AuthenticatedRequest,
    @Param('examId', ParseObjectIdPipe) examId: string,
  ) {
    return this.attemptsService.start(request.user.id, examId);
  }

  // NOTE: must stay above any `attempts/:attemptId` GET route.
  @Get('attempts')
  @ApiOperation({ summary: 'Attempt history of the current student' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'examId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: AttemptStatus })
  @ApiOkResponse({ description: 'Paginated attempts, newest first' })
  history(
    @Req() request: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('examId', new ParseObjectIdPipe({ optional: true }))
    examId?: string,
    @Query('status', new ParseEnumPipe(AttemptStatus, { optional: true }))
    status?: AttemptStatus,
  ) {
    return this.attemptsService.getHistory(request.user.id, {
      page,
      limit,
      examId,
      status,
    });
  }

  @Put('attempts/:attemptId/answers/:questionId')
  @ApiOperation({ summary: 'Select / change the answer of one question' })
  @ApiNotFoundResponse({ description: 'Attempt or question not found' })
  @ApiConflictResponse({ description: 'Attempt submitted or time is over' })
  saveAnswer(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParseObjectIdPipe) attemptId: string,
    @Param('questionId', ParseObjectIdPipe) questionId: string,
    @Body() dto: SaveAnswerDto,
  ) {
    return this.attemptsService.saveAnswer(
      request.user.id,
      attemptId,
      questionId,
      dto.selectedOptionIndex,
    );
  }

  @Post('attempts/:attemptId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the attempt and get the graded result' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  submit(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParseObjectIdPipe) attemptId: string,
  ) {
    return this.attemptsService.submit(request.user.id, attemptId);
  }

  @Delete('attempts/:attemptId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an attempt that has not been submitted' })
  @ApiNoContentResponse({ description: 'Attempt and its answers deleted' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  @ApiConflictResponse({ description: 'Attempt already submitted' })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParseObjectIdPipe) attemptId: string,
  ) {
    await this.attemptsService.cancel(request.user.id, attemptId);
  }

  @Get('attempts/:attemptId/result')
  @ApiOperation({ summary: 'Score and per-question review of a submitted attempt' })
  @ApiNotFoundResponse({ description: 'Attempt not found' })
  @ApiConflictResponse({ description: 'Attempt has not been submitted yet' })
  result(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParseObjectIdPipe) attemptId: string,
  ) {
    return this.attemptsService.getResult(request.user.id, attemptId);
  }
}
