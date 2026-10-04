import { ConflictException } from '@nestjs/common';
import { AttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AttemptsRepository, AttemptWithExam } from './attempts.repository';

const writeConflict = () =>
  new Prisma.PrismaClientKnownRequestError('Write conflict', {
    code: 'P2034',
    clientVersion: '6.19.0',
  });

describe('AttemptsRepository write conflict retries', () => {
  const attempt: AttemptWithExam = {
    id: 'attempt-id',
    userId: 'user-id',
    examId: 'exam-id',
    status: AttemptStatus.IN_PROGRESS,
    startedAt: new Date('2026-10-04T10:00:00Z'),
    deadlineAt: new Date('2026-10-04T10:30:00Z'),
    submittedAt: null,
    cancelledAt: null,
    answerVersion: 0,
    score: null,
    totalQuestions: 1,
    correctCount: null,
    incorrectCount: null,
    exam: { id: 'exam-id', title: 'Example exam' },
  };
  const answer = {
    questionId: 'question-id',
    selectedOptionId: 'option-id',
    updatedAt: new Date(),
    selectedOption: { position: 0 },
  };
  const tx = {
    attempt: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    attemptAnswer: { upsert: jest.fn(), findMany: jest.fn() },
    question: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    attempt: { updateMany: jest.fn() },
  };
  const grade = jest.fn();
  let repository: AttemptsRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new AttemptsRepository(prisma as unknown as PrismaService);
    prisma.$transaction.mockImplementation(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );
    tx.attempt.findFirst.mockResolvedValue(attempt);
    tx.attempt.updateMany.mockResolvedValue({ count: 1 });
    tx.attemptAnswer.upsert.mockResolvedValue(answer);
    tx.attemptAnswer.findMany.mockResolvedValue([answer]);
    tx.question.findMany.mockResolvedValue([]);
    tx.attempt.update.mockResolvedValue({
      ...attempt,
      status: AttemptStatus.SUBMITTED,
    });
    prisma.attempt.updateMany.mockResolvedValue({ count: 1 });
    grade.mockReturnValue({
      submittedAt: new Date(),
      score: 10,
      correctCount: 1,
      incorrectCount: 0,
    });
  });

  describe.each(['save', 'submit', 'cancel'] as const)('%s', (operation) => {
    const run = (): Promise<unknown> => {
      if (operation === 'save') {
        return repository.upsertAnswer(
          attempt.id,
          attempt.userId,
          answer.questionId,
          answer.selectedOptionId,
        );
      }
      if (operation === 'submit') {
        return repository.submitInProgress(attempt.id, attempt.userId, grade);
      }
      return repository.cancelInProgress(attempt.id, attempt.userId);
    };

    const conflictPoint = () =>
      operation === 'cancel'
        ? prisma.attempt.updateMany
        : tx.attempt.updateMany;

    it('retries P2034 and succeeds using a fresh operation', async () => {
      conflictPoint().mockRejectedValueOnce(writeConflict());

      const result = await run();

      expect(conflictPoint()).toHaveBeenCalledTimes(2);
      if (operation === 'cancel') {
        expect(result).toBe(1);
      } else {
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        if (operation === 'save') {
          expect(result).toEqual(answer);
          expect(tx.attemptAnswer.upsert).toHaveBeenCalledTimes(1);
        } else {
          expect(tx.attempt.findFirst).toHaveBeenCalledTimes(2);
          expect(result).toMatchObject({ status: AttemptStatus.SUBMITTED });
          expect(grade).toHaveBeenCalledTimes(1);
        }
      }
    });

    it('propagates non-conflict failures without retrying', async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Database operation failed',
        { code: 'P2002', clientVersion: '6.19.0' },
      );
      conflictPoint().mockRejectedValue(error);

      await expect(run()).rejects.toBe(error);
      expect(conflictPoint()).toHaveBeenCalledTimes(1);
    });

    it('returns HTTP 409 after three write conflicts', async () => {
      conflictPoint().mockRejectedValue(writeConflict());

      await expect(run()).rejects.toMatchObject({
        constructor: ConflictException,
        status: 409,
        message: expect.stringContaining('Please retry'),
      });
      expect(conflictPoint()).toHaveBeenCalledTimes(3);
    });
  });
});
