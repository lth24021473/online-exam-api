import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function retryWithWriteConflict<T>(
  operation: () => Promise<T>,
  entityName = 'Entity',
  maxAttempts = 3,
  baseDelayMs = 20,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034'
      ) {
        throw error;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * (attempt + 1)),
        );
      }
    }
  }

  throw new ConflictException(
    `${entityName} changed concurrently. Please retry the operation`,
  );
}
