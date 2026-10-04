import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Attempt, AttemptStatus, ExamStatus, Prisma } from '@prisma/client';
import { AttemptsRepository } from './attempts.repository';

/** Scores are on a 10-point scale, rounded to 2 decimals. */
export const MAX_SCORE = 10;

type ExamInfo = {
  id: string;
  title: string;
  instructions: string | null;
  durationMinutes: number;
};

@Injectable()
export class AttemptsService {
  constructor(private readonly repo: AttemptsRepository) {}

  // ---------------------------------------------------------------- Start
  async start(userId: string, examId: string) {
    const exam = await this.repo.findExamForStart(examId);
    if (!exam || exam.status === ExamStatus.DRAFT) {
      throw new NotFoundException('Exam not found');
    }
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException('Exam is closed');
    }

    const existing = await this.repo.findInProgress(userId, examId);
    if (existing) {
      if (existing.deadlineAt.getTime() > Date.now()) {
        // Resume the running attempt instead of creating a duplicate.
        return { resumed: true, ...(await this.buildSession(existing, exam)) };
      }
      // The old attempt ran out of time: grade it, then allow a fresh one.
      await this.finalize(existing);
    }

    const totalQuestions = exam._count.questions;
    if (totalQuestions === 0) {
      throw new ConflictException('Exam has no questions');
    }

    const attempt = await this.repo.create({
      userId,
      examId,
      totalQuestions,
      deadlineAt: new Date(Date.now() + exam.durationMinutes * 60_000),
    });
    return { resumed: false, ...(await this.buildSession(attempt, exam)) };
  }

  // ---------------------------------------------------------- Save answer
  async saveAnswer(
    userId: string,
    attemptId: string,
    questionId: string,
    selectedOptionIndex: number,
  ) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Attempt has already been submitted');
    }
    if (attempt.deadlineAt.getTime() <= Date.now()) {
      throw new ConflictException('Time is over for this attempt');
    }

    const question = await this.repo.findQuestionInExam(
      attempt.examId,
      questionId,
    );
    if (!question) throw new NotFoundException('Question not found in exam');
    if (selectedOptionIndex >= question.options.length) {
      throw new ConflictException('Selected option does not exist');
    }

    const answer = await this.repo.upsertAnswer(
      attemptId,
      questionId,
      selectedOptionIndex,
    );
    return {
      questionId: answer.questionId,
      selectedOptionIndex: answer.selectedOptionIndex,
      savedAt: answer.updatedAt,
    };
  }

  // --------------------------------------------------------------- Submit
  async submit(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    // Idempotent: submitting twice just returns the existing result.
    if (attempt.status === AttemptStatus.SUBMITTED) {
      return this.buildResult(attempt);
    }
    const submitted = await this.finalize(attempt);
    return this.buildResult(submitted);
  }

  // --------------------------------------------------------------- Cancel
  async cancel(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictException('Submitted attempts cannot be cancelled');
    }
    // Claim the attempt atomically first, then remove its answers.
    const deleted = await this.repo.deleteInProgress(attemptId, userId);
    if (deleted === 0) {
      throw new ConflictException('Attempt was already submitted or cancelled');
    }
    await this.repo.deleteAnswers(attemptId);
  }

  // ----------------------------------------------------------- Get result
  async getResult(userId: string, attemptId: string) {
    let attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      if (attempt.deadlineAt.getTime() > Date.now()) {
        throw new ConflictException('Attempt has not been submitted yet');
      }
      attempt = await this.finalize(attempt); // time ran out -> auto-grade
    }
    return this.buildResult(attempt);
  }

  // ---------------------------------------------------------- Get history
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
        // Running attempts whose time is over are graded the next time they are opened.
        expired:
          a.status === AttemptStatus.IN_PROGRESS &&
          a.deadlineAt.getTime() <= now,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // -------------------------------------------------------------- Helpers
  /** Returns 404 for both "missing" and "belongs to someone else" to avoid leaking ids. */
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
      questions,
      answers: answers.map(({ questionId, selectedOptionIndex }) => ({
        questionId,
        selectedOptionIndex,
      })),
    };
  }

  /** Grades the attempt and moves it IN_PROGRESS -> SUBMITTED exactly once. */
  private async finalize(attempt: Attempt) {
    const [questions, answers] = await Promise.all([
      this.repo.listQuestionsWithKey(attempt.examId),
      this.repo.listAnswers(attempt.id),
    ]);
    const key = new Map(questions.map((q) => [q.id, q.correctOptionIndex]));
    const correctCount = answers.filter(
      (a) => key.get(a.questionId) === a.selectedOptionIndex,
    ).length;
    const total = attempt.totalQuestions;
    const now = new Date();

    await this.repo.finalize(attempt.id, {
      // If the deadline already passed, record the deadline as the submit time.
      submittedAt: now > attempt.deadlineAt ? attempt.deadlineAt : now,
      correctCount,
      incorrectCount: total - correctCount, // wrong answers + unanswered
      score: total ? Math.round((correctCount / total) * MAX_SCORE * 100) / 100 : 0,
    });
    // If a concurrent request won the race, we simply read what it saved.
    const fresh = await this.repo.findById(attempt.id);
    return fresh as Attempt;
  }

  private async buildResult(attempt: Attempt) {
    const [questions, answers, withExam] = await Promise.all([
      this.repo.listQuestionsWithKey(attempt.examId),
      this.repo.listAnswers(attempt.id),
      this.repo.findById(attempt.id),
    ]);
    const selected = new Map(
      answers.map((a) => [a.questionId, a.selectedOptionIndex]),
    );

    return {
      attempt: {
        id: attempt.id,
        examId: attempt.examId,
        examTitle: withExam?.exam.title ?? null,
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
        incorrectCount: attempt.incorrectCount, // includes unanswered
        unansweredCount: attempt.totalQuestions - answers.length,
      },
      questions: questions.map((q) => {
        const selectedOptionIndex = selected.get(q.id) ?? null;
        return {
          id: q.id,
          position: q.position,
          content: q.content,
          options: q.options,
          selectedOptionIndex,
          correctOptionIndex: q.correctOptionIndex,
          isCorrect: selectedOptionIndex === q.correctOptionIndex,
        };
      }),
    };
  }
}
