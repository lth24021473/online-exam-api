import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Attempt, AttemptStatus, ExamStatus, Prisma, Role } from '@prisma/client';
import { ExamLeaderboardService } from '../exams/materialized-views/exam-leaderboard.service';
import { RecordViolationDto } from './dto/record-violation.dto';
import { AttemptsRepository } from './attempts.repository';
import { isShuffledMapping } from './shuffling';
import {
  GRADING_STRATEGY,
  StandardGradingStrategy,
  MAX_SCORE,
} from './grading';
import type { GradingStrategy } from './grading';

export { MAX_SCORE };

type ExamInfo = {
  id: string;
  title: string;
  instructions: string | null;
  durationMinutes: number;
  enableProctoring?: boolean;
  maxViolations?: number;
};

type OwnedAttempt = NonNullable<
  Awaited<ReturnType<AttemptsRepository['findById']>>
>;

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);
  private readonly gradingStrategy: GradingStrategy;

  constructor(
    private readonly repo: AttemptsRepository,
    @Optional()
    @Inject(GRADING_STRATEGY)
    gradingStrategy?: GradingStrategy,
    @Optional()
    private readonly leaderboardService?: ExamLeaderboardService,
  ) {
    this.gradingStrategy = gradingStrategy ?? new StandardGradingStrategy();
  }

  getGradingStrategy(): GradingStrategy {
    return this.gradingStrategy;
  }

  async start(
    userId: string,
    examId: string,
    userRole?: Role,
  ): Promise<
    { resumed: boolean } &
      Awaited<ReturnType<AttemptsService['buildSession']>>
  > {
    const exam = await this.repo.findExamForStart(examId);
    if (!exam || exam.status === ExamStatus.DRAFT) {
      throw new NotFoundException('Exam not found');
    }

    if (exam.classroomId) {
      const isMember = await this.repo.isClassroomMember(
        exam.classroomId,
        userId,
      );
      const isOwner = exam.managerId === userId;
      let isAdmin = false;
      if (!isMember && !isOwner) {
        if (userRole !== undefined) {
          isAdmin = userRole === Role.ADMIN;
        } else {
          isAdmin = await this.repo.isUserAdmin(userId);
        }
      }
      if (!isMember && !isOwner && !isAdmin) {
        throw new ForbiddenException(
          'Đề thi này chỉ dành cho học sinh trong lớp',
        );
      }
    }
    const existing = await this.repo.findInProgress(userId, examId);
    if (existing) {
      if (existing.deadlineAt.getTime() > Date.now()) {
        // Resume the running attempt instead of creating a duplicate.
        return { resumed: true, ...(await this.buildSession(existing, exam)) };
      }
      await this.finalize(existing);
    }

    // Closing an exam prevents new attempts while allowing a student to
    // reload and finish the active attempt they already started.
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException('Exam is closed');
    }

    if (exam.opensAt && Date.now() < exam.opensAt.getTime()) {
      throw new ConflictException('Exam is not open yet');
    }

    if (exam.closesAt && Date.now() >= exam.closesAt.getTime()) {
      throw new ConflictException('Exam is closed');
    }

    const maxAttempts = exam.maxAttempts ?? 1;
    const submittedCount = await this.repo.countSubmitted(userId, examId);
    if (submittedCount >= maxAttempts) {
      throw new ConflictException(
        `Maximum attempts reached (${submittedCount}/${maxAttempts})`,
      );
    }

    const totalQuestions = exam._count.questions;
    if (totalQuestions === 0) {
      throw new ConflictException('Exam has no questions');
    }

    let deadlineAt = new Date(Date.now() + exam.durationMinutes * 60_000);
    if (exam.closesAt && exam.closesAt.getTime() < deadlineAt.getTime()) {
      deadlineAt = exam.closesAt;
    }

    const { attempt, resumed } = await this.repo.createOrResume({
      userId,
      examId,
      totalQuestions,
      deadlineAt,
    });
    if (resumed && attempt.deadlineAt.getTime() <= Date.now()) {
      await this.finalize(attempt);
      return this.start(userId, examId, userRole);
    }
    return { resumed, ...(await this.buildSession(attempt, exam)) };
  }

  async saveAnswer(
    userId: string,
    attemptId: string,
    questionId: string,
    selectedOptionIndex: number,
  ) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Attempt is no longer in progress');
    }
    if (attempt.deadlineAt.getTime() <= Date.now()) {
      throw new ConflictException('Time is over for this attempt');
    }

    const question = await this.repo.findQuestionInExam(
      attempt.examId,
      questionId,
    );
    if (!question) throw new NotFoundException('Question not found in exam');

    let selectedOptionId: string;
    if (isShuffledMapping(attempt.shuffledMapping)) {
      const qMap = attempt.shuffledMapping.find(
        (m) => m.questionId === questionId,
      );
      if (
        !qMap ||
        !Number.isInteger(selectedOptionIndex) ||
        selectedOptionIndex < 0 ||
        selectedOptionIndex >= qMap.optionIds.length
      ) {
        throw new ConflictException('Selected option does not exist');
      }
      selectedOptionId = qMap.optionIds[selectedOptionIndex];
      const optionExists = question.options.some((o) => o.id === selectedOptionId);
      if (!optionExists) {
        throw new ConflictException('Selected option does not exist');
      }
    } else {
      const option = question.options.find(
        (o) => o.position === selectedOptionIndex,
      );
      if (
        !Number.isInteger(selectedOptionIndex) ||
        selectedOptionIndex < 0 ||
        !option
      ) {
        throw new ConflictException('Selected option does not exist');
      }
      selectedOptionId = option.id;
    }

    const answer = await this.repo.upsertAnswer(
      attemptId,
      userId,
      questionId,
      selectedOptionId,
    );
    return {
      questionId: answer.questionId,
      selectedOptionIndex,
      savedAt: answer.updatedAt,
    };
  }

  async submit(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status === AttemptStatus.CANCELLED) {
      throw new ConflictException('Cancelled attempts cannot be submitted');
    }
    // Idempotent: submitting twice just returns the existing result.
    if (attempt.status === AttemptStatus.SUBMITTED) {
      return this.buildResult(attempt);
    }
    const submitted = await this.finalize(attempt);
    return this.buildResult(submitted);
  }

  async cancel(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Only in-progress attempts can be cancelled');
    }
    if (attempt.deadlineAt.getTime() <= Date.now()) {
      throw new ConflictException('Time is over for this attempt');
    }
    const cancelled = await this.repo.cancelInProgress(attemptId, userId);
    if (cancelled === 0) {
      throw new ConflictException('Attempt was already submitted or cancelled');
    }
  }

  async getResult(userId: string, attemptId: string) {
    let attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status === AttemptStatus.CANCELLED) {
      throw new ConflictException('Cancelled attempts have no graded result');
    }
    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      if (attempt.deadlineAt.getTime() > Date.now()) {
        throw new ConflictException('Attempt has not been submitted yet');
      }
      attempt = await this.finalize(attempt);
    }
    return this.buildResult(attempt);
  }

  /** Finalize a single expired attempt (used by the background auto-finalizer). */
  async finalizeExpiredAttempt(attempt: Attempt) {
    return this.finalize(attempt);
  }

  async getHistory(
    userId: string,
    query: {
      page: number;
      limit: number;
      examId?: string;
      status?: AttemptStatus;
    },
  ) {
    const page = Math.max(1, query.page);
    const limit = Math.min(Math.max(1, query.limit), 50);
    const where: Prisma.AttemptWhereInput = {
      userId,
      ...(query.examId && { examId: query.examId }),
      ...(query.status && { status: query.status }),
    };

    const { items, total } = await this.repo.history(
      where,
      (page - 1) * limit,
      limit,
    );
    const now = Date.now();
    return {
      items: items.map((a) => ({
        ...a,
        maxScore: MAX_SCORE,
        expired:
          a.status === AttemptStatus.IN_PROGRESS &&
          a.deadlineAt.getTime() <= now,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private async getOwnedAttempt(userId: string, attemptId: string) {
    const attempt = await this.repo.findById(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Attempt not found');
    }
    return attempt;
  }

  private async buildSession(attempt: Attempt, exam: ExamInfo) {
    const [questions, answers] = await Promise.all([
      this.repo.listQuestions(attempt.examId),
      this.repo.listAnswers(attempt.id),
    ]);

    let sessionQuestions: {
      id: string;
      content: string;
      position: number;
      options: string[];
    }[];

    let sessionAnswers: {
      questionId: string;
      selectedOptionIndex: number;
    }[];

    if (isShuffledMapping(attempt.shuffledMapping)) {
      const mapping = attempt.shuffledMapping;
      const questionDict = new Map(questions.map((q) => [q.id, q]));

      sessionQuestions = mapping
        .map((m, index) => {
          const q = questionDict.get(m.questionId);
          if (!q) return null;
          const optDict = new Map(q.options.map((o) => [o.id, o]));
          const shuffledOptions = m.optionIds
            .map((optId) => optDict.get(optId)?.content)
            .filter((c): c is string => c !== undefined);

          return {
            id: q.id,
            content: q.content,
            position: index + 1,
            options: shuffledOptions,
          };
        })
        .filter((q): q is NonNullable<typeof q> => q !== null);

      const mappingDict = new Map(
        mapping.map((m) => [m.questionId, m.optionIds]),
      );

      sessionAnswers = answers.map(
        ({ questionId, selectedOptionId, selectedOption }) => {
          const optionIds = mappingDict.get(questionId);
          if (optionIds) {
            const index = optionIds.indexOf(selectedOptionId);
            if (index !== -1) {
              return { questionId, selectedOptionIndex: index };
            }
          }
          return { questionId, selectedOptionIndex: selectedOption.position };
        },
      );
    } else {
      sessionQuestions = questions.map((q) => ({
        id: q.id,
        content: q.content,
        position: q.position,
        options: q.options.map((o) => o.content),
      }));

      sessionAnswers = answers.map(({ questionId, selectedOption }) => ({
        questionId,
        selectedOptionIndex: selectedOption.position,
      }));
    }

    return {
      attempt: {
        id: attempt.id,
        examId: attempt.examId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        totalQuestions: attempt.totalQuestions,
        violationCount: attempt.violationCount,
        terminatedReason: attempt.terminatedReason,
      },
      exam: {
        id: exam.id,
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.durationMinutes,
        enableProctoring: exam.enableProctoring ?? true,
        maxViolations: exam.maxViolations ?? 3,
      },
      questions: sessionQuestions,
      answers: sessionAnswers,
    };
  }

  private async finalize(attempt: Attempt, terminatedReason?: string) {
    const finalized = await this.repo.submitInProgress(
      attempt.id,
      attempt.userId,
      (questions, answers, current) => {
        const { score, correctCount, incorrectCount } =
          this.gradingStrategy.calculateScore(
            questions,
            answers,
            current.totalQuestions,
          );
        const now = new Date();
        const reason =
          terminatedReason ??
          (now > current.deadlineAt ? 'TIME_EXPIRED' : 'NORMAL_SUBMIT');
        return {
          submittedAt: now > current.deadlineAt ? current.deadlineAt : now,
          correctCount,
          incorrectCount,
          score,
          terminatedReason: reason,
        };
      },
    );

    this.triggerLeaderboardUpdate(finalized);

    return finalized;
  }

  private triggerLeaderboardUpdate(attempt: Attempt): void {
    const leaderboardService = this.leaderboardService;
    if (
      !leaderboardService ||
      attempt.score === null ||
      attempt.score === undefined
    ) {
      return;
    }

    (async () => {
      try {
        await leaderboardService.updateLeaderboardOnSubmission(attempt);
        await leaderboardService.recalculateSummaryStats(attempt.examId);
      } catch (error) {
        this.logger.error(
          `Failed to update leaderboard or summary stats for attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    })().catch((unhandled) => {
      this.logger.error(
        `Unhandled error in leaderboard background task for attempt ${attempt.id}: ${unhandled instanceof Error ? unhandled.message : String(unhandled)}`,
        unhandled instanceof Error ? unhandled.stack : undefined,
      );
    });
  }

  private async buildResult(attempt: OwnedAttempt) {
    const [questions, answers] = await Promise.all([
      this.repo.listQuestionsWithKey(attempt.examId),
      this.repo.listAnswers(attempt.id),
    ]);
    const selected = new Map(
      answers.map((a) => [a.questionId, a.selectedOptionId]),
    );

    let resultQuestions: {
      id: string;
      position: number;
      content: string;
      options: string[];
      selectedOptionIndex: number | null;
      correctOptionIndex: number | null;
      isCorrect: boolean;
    }[];

    if (isShuffledMapping(attempt.shuffledMapping)) {
      const mapping = attempt.shuffledMapping;
      const questionDict = new Map(questions.map((q) => [q.id, q]));

      resultQuestions = mapping
        .map((m, index) => {
          const q = questionDict.get(m.questionId);
          if (!q) return null;
          const optDict = new Map(q.options.map((o) => [o.id, o]));
          const selectedOptionId = selected.get(q.id);
          const correctOption = q.options.find((o) => o.isCorrect);

          const shuffledOptions = m.optionIds
            .map((optId) => optDict.get(optId))
            .filter((o): o is NonNullable<typeof o> => o !== undefined);

          const selectedOptionIndex = selectedOptionId
            ? m.optionIds.indexOf(selectedOptionId)
            : -1;
          const correctOptionIndex = correctOption
            ? m.optionIds.indexOf(correctOption.id)
            : -1;

          return {
            id: q.id,
            position: index + 1,
            content: q.content,
            options: shuffledOptions.map((o) => o.content),
            selectedOptionIndex:
              selectedOptionIndex !== -1 ? selectedOptionIndex : null,
            correctOptionIndex:
              correctOptionIndex !== -1 ? correctOptionIndex : null,
            isCorrect: Boolean(
              correctOption && selectedOptionId === correctOption.id,
            ),
          };
        })
        .filter((q): q is NonNullable<typeof q> => q !== null);
    } else {
      resultQuestions = questions.map((q) => {
        const selectedOptionId = selected.get(q.id);
        const selectedOptionIndex =
          q.options.find((o) => o.id === selectedOptionId)?.position ?? null;
        const correctOption = q.options.find((o) => o.isCorrect);
        return {
          id: q.id,
          position: q.position,
          content: q.content,
          options: q.options.map((o) => o.content),
          selectedOptionIndex,
          correctOptionIndex: correctOption?.position ?? null,
          isCorrect: Boolean(
            correctOption && selectedOptionId === correctOption.id,
          ),
        };
      });
    }

    return {
      attempt: {
        id: attempt.id,
        examId: attempt.examId,
        examTitle: attempt.exam.title,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        submittedAt: attempt.submittedAt,
      },
      summary: {
        score: attempt.score,
        maxScore: MAX_SCORE,
        totalQuestions: attempt.totalQuestions,
        violationCount: attempt.violationCount,
        terminatedReason: attempt.terminatedReason,
        correctCount: attempt.correctCount,
        incorrectCount: attempt.incorrectCount,
        unansweredCount: attempt.totalQuestions - answers.length,
      },
      questions: resultQuestions,
    };
  }
  async recordViolation(
    userId: string,
    attemptId: string,
    dto: RecordViolationDto,
  ) {
    const res = await this.repo.recordViolation(
      attemptId,
      userId,
      dto.type,
      dto.detail,
    );

    let submitted = false;
    let result: any = null;
    if (res.shouldTerminate) {
      const attempt = await this.repo.findById(attemptId);
      if (attempt && attempt.status === AttemptStatus.IN_PROGRESS) {
        const finalized = await this.finalize(attempt, 'EXCEEDED_VIOLATIONS');
        submitted = true;
        result = await this.buildResult(finalized);
      }
    }

    return {
      violation: res.violation,
      violationCount: res.violationCount,
      maxViolations: res.maxViolations,
      terminated: res.shouldTerminate,
      submitted,
      result,
    };
  }

  async getViolations(userId: string, role: Role, attemptId: string) {
    if (role === Role.STUDENT) {
      await this.getOwnedAttempt(userId, attemptId);
    } else {
      const attempt = await this.repo.findById(attemptId);
      if (!attempt) {
        throw new NotFoundException('Attempt not found');
      }

      if (role === Role.EXAM_MANAGER) {
        if (attempt.exam.managerId !== userId) {
          throw new ForbiddenException(
            'Bạn không sở hữu đề thi của lượt làm bài này',
          );
        }
      }
    }

    const violations = await this.repo.findViolations(attemptId);
    return {
      attemptId,
      violations,
    };
  }
}
