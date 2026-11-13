import { ConflictException, Injectable } from '@nestjs/common';
import {
  GradingAnswer,
  GradingQuestion,
  GradingResult,
  GradingStrategy,
  MAX_SCORE,
} from './grading-strategy.interface';

@Injectable()
export class StandardGradingStrategy implements GradingStrategy {
  calculateScore(
    questions: GradingQuestion[],
    answers: GradingAnswer[],
    totalQuestions?: number,
  ): GradingResult {
    const key = new Map<string, string>();

    for (const q of questions) {
      const correctOptions = q.options.filter((o) => o.isCorrect);
      if (correctOptions.length !== 1) {
        throw new ConflictException(
          'Each question must have one correct option',
        );
      }
      key.set(q.id, correctOptions[0].id);
    }

    const correctCount = answers.filter(
      (a) => key.get(a.questionId) === a.selectedOptionId,
    ).length;

    const total = totalQuestions ?? questions.length;
    const incorrectCount = total ? total - correctCount : 0;
    const score = total
      ? Math.round((correctCount / total) * MAX_SCORE * 100) / 100
      : 0;

    return {
      score,
      correctCount,
      incorrectCount,
    };
  }
}

