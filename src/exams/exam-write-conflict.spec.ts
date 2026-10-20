import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { retryExamWrite } from './exam-write-conflict';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('Database write failed', {
    code,
    clientVersion: 'test',
  });

describe('retryExamWrite', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('recovers from write conflicts after giving competing writes time to finish', async () => {
    const result = { id: 'exam-id' };
    const operation = jest
      .fn()
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockRejectedValueOnce(prismaError('P2034'))
      .mockResolvedValue(result);
    const pending = retryExamWrite(operation);

    await jest.advanceTimersByTimeAsync(19);
    expect(operation).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(39);
    expect(operation).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(result);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('returns a typed HTTP conflict after exhausting retries', async () => {
    const operation = jest.fn().mockRejectedValue(prismaError('P2034'));
    // Attach a rejection handler before advancing timers to avoid an
    // unhandled rejection while the third attempt is settling.
    const outcome = retryExamWrite(operation).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(60);
    const error = await outcome;

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).message).toBe(
      'Exam changed concurrently. Please retry the operation',
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('preserves duplicate-position validation without retrying', async () => {
    const operation = jest.fn().mockRejectedValue(prismaError('P2002'));
    await expect(retryExamWrite(operation)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('passes unrelated failures through without retrying', async () => {
    const failure = prismaError('P2025');
    const operation = jest.fn().mockRejectedValue(failure);
    await expect(retryExamWrite(operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
