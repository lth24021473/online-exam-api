import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Attempt, AttemptStatus, ExamStatus, Prisma } from '@prisma/client';
import { AttemptsRepository } from './attempts.repository';

export const MAX_SCORE = 10;

type ExamInfo = {
  id: string;
  title: string;
  instructions: string | null;
  durationMinutes: number;
};

type OwnedAttempt = NonNullable<
  Awaited<ReturnType<AttemptsRepository['findById']>>
>;

@Injectable()
export class AttemptsService {
  constructor(private readonly repo: AttemptsRepository) {}

  async start(
    userId: string,
    examId: string,
  ): Promise<
    { resumed: boolean } &
      Awaited<ReturnType<AttemptsService['buildSession']>>
  > {
    const exam = await this.repo.findExamForStart(examId);
    if (!exam || exam.status === ExamStatus.DRAFT) {
      throw new NotFoundException('Exam not found');
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

    const totalQuestions = exam._count.questions;
    if (totalQuestions === 0) {
      throw new ConflictException('Exam has no questions');
    }

    const { attempt, resumed } = await this.repo.createOrResume({
      userId,
      examId,
      totalQuestions,
      deadlineAt: new Date(Date.now() + exam.durationMinutes * 60_000),
    });
    if (resumed && attempt.deadlineAt.getTime() <= Date.now()) {
      await this.finalize(attempt);
      return this.start(userId, examId);
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

    const answer = await this.repo.upsertAnswer(
      attemptId,
      userId,
      questionId,
      option.id,
    );
    return {
      questionId: answer.questionId,
      selectedOptionIndex: answer.selectedOption.position,
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

  /** Used after an exam manager's ownership/role check, before reading results. */
  async finalizeExpiredForExam(examId: string) {
    for (;;) {
      const expired = await this.repo.findExpiredForExam(examId, 50);
      if (expired.length === 0) return;
      for (const attempt of expired) {
        try {
          await this.finalize(attempt);
        } catch (error) {
          if (error instanceof ConflictException) {
            const current = await this.repo.findById(attempt.id);
            if (!current || current.status !== AttemptStatus.IN_PROGRESS) {
              continue;
            }
          }
          throw error;
        }
      }
    }
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
    return {
      attempt: {
        id: attempt.id,
        examId: attempt.examId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        totalQuestions: attempt.totalQuestions,
      },
      exam: {
        id: exam.id,
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.durationMinutes,
      },
      questions: questions.map((q) => ({
        id: q.id,
        content: q.content,
        position: q.position,
        options: q.options.map((o) => o.content),
      })),
      answers: answers.map(({ questionId, selectedOption }) => ({
        questionId,
        selectedOptionIndex: selectedOption.position,
      })),
    };
  }

  private async finalize(attempt: Attempt) {
    return this.repo.submitInProgress(
      attempt.id,
      attempt.userId,
      (questions, answers, current) => {
        const key = new Map(
          questions.map((q) => {
            const correctOptions = q.options.filter((o) => o.isCorrect);
            if (correctOptions.length !== 1) {
              throw new ConflictException(
                'Each question must have one correct option',
              );
            }
            return [q.id, correctOptions[0].id];
          }),
        );
        const correctCount = answers.filter(
          (a) => key.get(a.questionId) === a.selectedOptionId,
        ).length;
        const total = current.totalQuestions;
        const now = new Date();
        return {
          submittedAt: now > current.deadlineAt ? current.deadlineAt : now,
          correctCount,
          incorrectCount: total - correctCount,
          score: total
            ? Math.round((correctCount / total) * MAX_SCORE * 100) / 100
            : 0,
        };
      },
    );
  }

  private async buildResult(attempt: OwnedAttempt) {
    const [questions, answers] = await Promise.all([
      this.repo.listQuestionsWithKey(attempt.examId),
      this.repo.listAnswers(attempt.id),
    ]);
    const selected = new Map(
      answers.map((a) => [a.questionId, a.selectedOptionId]),
    );

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
        correctCount: attempt.correctCount,
        incorrectCount: attempt.incorrectCount,
        unansweredCount: attempt.totalQuestions - answers.length,
      },
      questions: questions.map((q) => {
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
      }),
    };
  }
}
