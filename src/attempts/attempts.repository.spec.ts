import { ConflictException, NotFoundException } from '@nestjs/common';
import { AttemptStatus, Prisma, ViolationType } from '@prisma/client';
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
    violationCount: 0,
    terminatedReason: null,
    exam: {
      id: 'exam-id',
      title: 'Example exam',
      enableProctoring: true,
      maxViolations: 3,
    },
  };
  const answer = {
    questionId: 'question-id',
    selectedOptionId: 'option-id',
    updatedAt: new Date(),
    selectedOption: { position: 0 },
  };
  const tx = {
    exam: { findUnique: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    attempt: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    attemptAnswer: { upsert: jest.fn(), findMany: jest.fn() },
    attemptViolation: { create: jest.fn(), findMany: jest.fn() },
    question: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    attempt: { updateMany: jest.fn() },
    attemptViolation: { findMany: jest.fn() },
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
    tx.user.findUnique.mockResolvedValue({ updatedAt: new Date() });
    tx.user.update.mockResolvedValue({});
    tx.exam.findUnique.mockResolvedValue({ updatedAt: new Date() });
    tx.exam.updateMany.mockResolvedValue({ count: 1 });
    tx.attempt.create.mockResolvedValue(attempt);
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

  it('resumes an existing attempt without writing the account or creating another attempt', async () => {
    const result = await repository.createOrResume({
      userId: attempt.userId,
      examId: attempt.examId,
      deadlineAt: attempt.deadlineAt,
      totalQuestions: attempt.totalQuestions,
    });
    expect(result).toEqual({ attempt, resumed: true });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.exam.updateMany).not.toHaveBeenCalled();
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });

  it('rejects a new attempt when the exam no longer has published status inside its transaction', async () => {
    tx.attempt.findFirst.mockResolvedValue(null);
    tx.exam.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.createOrResume({
      userId: attempt.userId,
      examId: attempt.examId,
      deadlineAt: attempt.deadlineAt,
      totalQuestions: attempt.totalQuestions,
    })).rejects.toMatchObject({ status: 409, message: 'Exam is closed' });
    expect(tx.attempt.create).not.toHaveBeenCalled();
  });

  it('retries a concurrent start with a fresh transaction and advances the account timestamp without changing its JWT version', async () => {
    const updatedAt = new Date(Date.now() + 1000);
    tx.attempt.findFirst.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({ updatedAt });
    tx.user.update.mockRejectedValueOnce(writeConflict());
    const result = await repository.createOrResume({
      userId: attempt.userId,
      examId: attempt.examId,
      deadlineAt: attempt.deadlineAt,
      totalQuestions: attempt.totalQuestions,
    });
    expect(result).toEqual({ attempt, resumed: false });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.attempt.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update.mock.calls[1][0].data.updatedAt.getTime()).toBe(
      updatedAt.getTime() + 1,
    );
    expect(tx.user.update.mock.calls[1][0].data).not.toHaveProperty('authVersion');
  });

  it('automatically queries exam questions and generates shuffledMapping when creating a new attempt', async () => {
    tx.attempt.findFirst.mockResolvedValue(null);
    tx.question.findMany.mockResolvedValue([
      { id: 'q1', options: [{ id: 'opt1' }, { id: 'opt2' }] },
      { id: 'q2', options: [{ id: 'opt3' }, { id: 'opt4' }] },
    ]);

    await repository.createOrResume({
      userId: attempt.userId,
      examId: attempt.examId,
      deadlineAt: attempt.deadlineAt,
      totalQuestions: 2,
    });

    expect(tx.attempt.create).toHaveBeenCalledTimes(1);
    const createData = tx.attempt.create.mock.calls[0][0].data;
    expect(createData).toHaveProperty('shuffledMapping');
    expect(createData.shuffledMapping).toHaveLength(2);
    expect(createData.shuffledMapping.map((m: any) => m.questionId).sort()).toEqual([
      'q1',
      'q2',
    ]);
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

  describe('recordViolation', () => {
    const violationFixture = {
      id: 'violation-1',
      attemptId: attempt.id,
      type: ViolationType.TAB_SWITCH,
      detail: 'Left tab',
      createdAt: new Date(),
    };

    beforeEach(() => {
      tx.attempt.findFirst.mockResolvedValue(attempt);
      tx.attemptViolation.create.mockResolvedValue(violationFixture);
      tx.attempt.update.mockResolvedValue({
        ...attempt,
        violationCount: 1,
      });
    });

    it('records violation, increments count, and returns shouldTerminate false when count < maxViolations', async () => {
      const res = await repository.recordViolation(
        attempt.id,
        attempt.userId,
        ViolationType.TAB_SWITCH,
        '  Left tab  ',
      );

      expect(tx.attempt.findFirst).toHaveBeenCalledWith({
        where: { id: attempt.id, userId: attempt.userId },
        include: {
          exam: {
            select: { id: true, maxViolations: true, enableProctoring: true },
          },
        },
      });
      expect(tx.attemptViolation.create).toHaveBeenCalledWith({
        data: {
          attemptId: attempt.id,
          type: ViolationType.TAB_SWITCH,
          detail: 'Left tab',
        },
      });
      expect(tx.attempt.update).toHaveBeenCalledWith({
        where: { id: attempt.id },
        data: { violationCount: { increment: 1 } },
      });
      expect(res).toEqual({
        violation: violationFixture,
        violationCount: 1,
        maxViolations: 3,
        shouldTerminate: false,
      });
    });

    it('returns shouldTerminate true when violationCount reaches maxViolations', async () => {
      tx.attempt.update.mockResolvedValue({
        ...attempt,
        violationCount: 3,
      });

      const res = await repository.recordViolation(
        attempt.id,
        attempt.userId,
        ViolationType.FULLSCREEN_EXIT,
      );

      expect(tx.attemptViolation.create).toHaveBeenCalledWith({
        data: {
          attemptId: attempt.id,
          type: ViolationType.FULLSCREEN_EXIT,
          detail: null,
        },
      });
      expect(res.shouldTerminate).toBe(true);
      expect(res.violationCount).toBe(3);
    });

    it('throws NotFoundException if attempt is not found', async () => {
      tx.attempt.findFirst.mockResolvedValue(null);

      await expect(
        repository.recordViolation(
          'non-existent',
          attempt.userId,
          ViolationType.DEVTOOLS_OPEN,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if attempt is not IN_PROGRESS', async () => {
      tx.attempt.findFirst.mockResolvedValue({
        ...attempt,
        status: AttemptStatus.SUBMITTED,
      });

      await expect(
        repository.recordViolation(
          attempt.id,
          attempt.userId,
          ViolationType.DEVTOOLS_OPEN,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('retries P2034 and succeeds using a fresh operation', async () => {
      tx.attempt.update
        .mockRejectedValueOnce(writeConflict())
        .mockResolvedValue({
          ...attempt,
          violationCount: 1,
        });

      const result = await repository.recordViolation(
        attempt.id,
        attempt.userId,
        ViolationType.TAB_SWITCH,
      );

      expect(tx.attempt.update).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        violationCount: 1,
        maxViolations: 3,
        shouldTerminate: false,
      });
    });

    it('returns HTTP 409 after three write conflicts', async () => {
      tx.attempt.update.mockRejectedValue(writeConflict());

      await expect(
        repository.recordViolation(
          attempt.id,
          attempt.userId,
          ViolationType.TAB_SWITCH,
        ),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        status: 409,
        message: expect.stringContaining('Please retry'),
      });
      expect(tx.attempt.update).toHaveBeenCalledTimes(3);
    });
  });

  describe('findViolations', () => {
    it('returns violations ordered by createdAt asc', async () => {
      const violations = [
        {
          id: 'v1',
          attemptId: attempt.id,
          type: ViolationType.TAB_SWITCH,
          detail: 'Left tab',
          createdAt: new Date('2026-10-04T10:05:00Z'),
        },
        {
          id: 'v2',
          attemptId: attempt.id,
          type: ViolationType.FULLSCREEN_EXIT,
          detail: null,
          createdAt: new Date('2026-10-04T10:10:00Z'),
        },
      ];
      prisma.attemptViolation.findMany.mockResolvedValue(violations);

      const result = await repository.findViolations(attempt.id);

      expect(prisma.attemptViolation.findMany).toHaveBeenCalledWith({
        where: { attemptId: attempt.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual(violations);
    });
  });

  describe('upsertAnswerFromBuffer & upsertAnswersBatch (TV2-04)', () => {
    it('upsertAnswerFromBuffer updates answerVersion and upserts answer', async () => {
      tx.attempt.findFirst.mockResolvedValue({
        id: attempt.id,
        status: AttemptStatus.IN_PROGRESS,
      });
      tx.attempt.updateMany.mockResolvedValue({ count: 1 });
      tx.attemptAnswer.upsert.mockResolvedValue(answer);

      const result = await repository.upsertAnswerFromBuffer(
        attempt.id,
        attempt.userId,
        'question-id',
        'option-id',
      );

      expect(tx.attempt.findFirst).toHaveBeenCalledWith({
        where: { id: attempt.id, userId: attempt.userId },
        select: { id: true, status: true },
      });
      expect(tx.attempt.updateMany).toHaveBeenCalledWith({
        where: {
          id: attempt.id,
          userId: attempt.userId,
          status: AttemptStatus.IN_PROGRESS,
        },
        data: { answerVersion: { increment: 1 } },
      });
      expect(tx.attemptAnswer.upsert).toHaveBeenCalledWith({
        where: {
          attemptId_questionId: {
            attemptId: attempt.id,
            questionId: 'question-id',
          },
        },
        create: {
          attemptId: attempt.id,
          questionId: 'question-id',
          selectedOptionId: 'option-id',
        },
        update: { selectedOptionId: 'option-id' },
        select: expect.any(Object),
      });
      expect(result).toEqual(answer);
    });

    it('upsertAnswerFromBuffer throws NotFoundException if attempt is missing', async () => {
      tx.attempt.findFirst.mockResolvedValue(null);

      await expect(
        repository.upsertAnswerFromBuffer(
          'missing-id',
          attempt.userId,
          'question-id',
          'option-id',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('upsertAnswerFromBuffer throws ConflictException if attempt is not IN_PROGRESS', async () => {
      tx.attempt.findFirst.mockResolvedValue({
        id: attempt.id,
        status: AttemptStatus.SUBMITTED,
      });

      await expect(
        repository.upsertAnswerFromBuffer(
          attempt.id,
          attempt.userId,
          'question-id',
          'option-id',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('upsertAnswersBatch returns empty array when given empty input', async () => {
      const result = await repository.upsertAnswersBatch(
        attempt.id,
        attempt.userId,
        [],
      );
      expect(result).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('upsertAnswersBatch persists all answers in batch', async () => {
      tx.attempt.findFirst.mockResolvedValue({
        id: attempt.id,
        status: AttemptStatus.IN_PROGRESS,
      });
      tx.attempt.updateMany.mockResolvedValue({ count: 1 });
      tx.attemptAnswer.upsert.mockResolvedValue(answer);

      const batchData = [
        { questionId: 'q1', selectedOptionId: 'opt-1' },
        { questionId: 'q2', selectedOptionId: 'opt-2' },
      ];

      const results = await repository.upsertAnswersBatch(
        attempt.id,
        attempt.userId,
        batchData,
      );

      expect(results).toHaveLength(2);
      expect(tx.attemptAnswer.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
