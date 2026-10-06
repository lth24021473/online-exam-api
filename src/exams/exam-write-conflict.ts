import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';

/** Every edit and status change writes the exam, protecting its question snapshot. */
export async function lockExamStatus(
  tx: Prisma.TransactionClient,
  id: string,
  status: ExamStatus,
) {
  const exam = await tx.exam.findUnique({
    where: { id },
    select: { updatedAt: true },
  });
  const updatedAt = new Date(
    Math.max(Date.now(), (exam?.updatedAt.getTime() ?? 0) + 1),
  );
  const result = await tx.exam.updateMany({
    where: { id, status },
    data: { updatedAt },
  });
  if (!result.count)
    throw new BadRequestException(
      `Only ${status} exams support this operation`,
    );
}

/** MongoDB transactions can conflict when publishing and editing at once. */
export async function retryExamWrite<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'A question or option with this position already exists',
        );
      }
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034'
      ) {
        throw error;
      }
      if (attempt >= 2) {
        throw new ConflictException(
          'Exam changed concurrently. Please retry the operation',
        );
      }
      // Give the competing transaction time to commit before retrying.
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}
