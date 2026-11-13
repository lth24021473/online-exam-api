export const MAX_SCORE = 10;
export const GRADING_STRATEGY = 'GRADING_STRATEGY';

export interface GradingOption {
  id: string;
  isCorrect: boolean;
  position?: number;
  content?: string;
}

export interface GradingQuestion {
  id: string;
  options: GradingOption[];
  position?: number;
  content?: string;
}

export interface GradingAnswer {
  questionId: string;
  selectedOptionId: string;
  selectedOption?: { position: number };
  updatedAt?: Date;
}

export interface GradingResult {
  score: number;
  correctCount: number;
  incorrectCount: number;
}

export interface GradingStrategy {
  calculateScore(
    questions: GradingQuestion[],
    answers: GradingAnswer[],
    totalQuestions?: number,
  ): GradingResult;
}

