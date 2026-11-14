import { randomInt } from 'node:crypto';

export interface ShuffledQuestionOrder {
  questionId: string;
  optionIds: string[];
}

export type ShuffledMapping = ShuffledQuestionOrder[];

/**
 * Immutably shuffles an array using Fisher-Yates (Knuth) shuffle
 * with cryptographically secure random integers.
 */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generates a randomized question order and option order for an attempt.
 */
export function generateShuffledMapping(
  questions: { id: string; options: { id: string }[] }[],
): ShuffledMapping {
  const shuffledQuestions = shuffleArray(questions);
  return shuffledQuestions.map((q) => ({
    questionId: q.id,
    optionIds: shuffleArray(q.options).map((o) => o.id),
  }));
}

/**
 * Validates whether an unknown value is a valid ShuffledMapping array.
 */
export function isShuffledMapping(value: unknown): value is ShuffledMapping {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as any).questionId === 'string' &&
      Array.isArray((item as any).optionIds) &&
      (item as any).optionIds.every((id: unknown) => typeof id === 'string'),
  );
}
