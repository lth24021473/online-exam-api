import { ConflictException } from '@nestjs/common';
import { StandardGradingStrategy } from './standard-grading.strategy';
import { GradingQuestion, GradingAnswer } from './grading-strategy.interface';

describe('StandardGradingStrategy', () => {
  let strategy: StandardGradingStrategy;

  beforeEach(() => {
    strategy = new StandardGradingStrategy();
  });

  const mockQuestions: GradingQuestion[] = [
    {
      id: 'q1',
      position: 0,
      content: 'Question 1',
      options: [
        { id: 'opt1_1', position: 0, content: 'A', isCorrect: true },
        { id: 'opt1_2', position: 1, content: 'B', isCorrect: false },
      ],
    },
    {
      id: 'q2',
      position: 1,
      content: 'Question 2',
      options: [
        { id: 'opt2_1', position: 0, content: 'A', isCorrect: false },
        { id: 'opt2_2', position: 1, content: 'B', isCorrect: true },
      ],
    },
  ];

  it('calculates perfect score (10/10) when all answers are correct', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1_1' },
      { questionId: 'q2', selectedOptionId: 'opt2_2' },
    ];

    const result = strategy.calculateScore(mockQuestions, answers);

    expect(result).toEqual({
      score: 10,
      correctCount: 2,
      incorrectCount: 0,
    });
  });

  it('calculates half score (5/10) when 1 of 2 answers is correct', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1_1' }, // correct
      { questionId: 'q2', selectedOptionId: 'opt2_1' }, // incorrect
    ];

    const result = strategy.calculateScore(mockQuestions, answers);

    expect(result).toEqual({
      score: 5,
      correctCount: 1,
      incorrectCount: 1,
    });
  });

  it('calculates zero score when all answers are incorrect', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1_2' }, // incorrect
      { questionId: 'q2', selectedOptionId: 'opt2_1' }, // incorrect
    ];

    const result = strategy.calculateScore(mockQuestions, answers);

    expect(result).toEqual({
      score: 0,
      correctCount: 0,
      incorrectCount: 2,
    });
  });

  it('treats unanswered questions as incorrect', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1_1' }, // 1 answered correctly, q2 unanswered
    ];

    const result = strategy.calculateScore(mockQuestions, answers);

    expect(result).toEqual({
      score: 5,
      correctCount: 1,
      incorrectCount: 1,
    });
  });

  it('uses explicit totalQuestions when provided', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1_1' },
    ];

    // Suppose exam has totalQuestions = 4, but only 2 questions in list
    const result = strategy.calculateScore(mockQuestions, answers, 4);

    expect(result).toEqual({
      score: 2.5, // (1 / 4) * 10
      correctCount: 1,
      incorrectCount: 3,
    });
  });

  it('returns 0 score when total questions is 0', () => {
    const result = strategy.calculateScore([], []);

    expect(result).toEqual({
      score: 0,
      correctCount: 0,
      incorrectCount: 0,
    });
  });

  it('rounds score to 2 decimal places', () => {
    const threeQuestions: GradingQuestion[] = [
      {
        id: 'q1',
        options: [{ id: 'opt1', isCorrect: true }],
      },
      {
        id: 'q2',
        options: [{ id: 'opt2', isCorrect: true }],
      },
      {
        id: 'q3',
        options: [{ id: 'opt3', isCorrect: true }],
      },
    ];
    const answers: GradingAnswer[] = [
      { questionId: 'q1', selectedOptionId: 'opt1' }, // 1/3 correct -> 3.33
    ];

    const result = strategy.calculateScore(threeQuestions, answers);

    expect(result).toEqual({
      score: 3.33,
      correctCount: 1,
      incorrectCount: 2,
    });
  });

  it('throws ConflictException if a question has no correct options', () => {
    const invalidQuestions: GradingQuestion[] = [
      {
        id: 'q_invalid',
        options: [
          { id: 'opt1', isCorrect: false },
          { id: 'opt2', isCorrect: false },
        ],
      },
    ];

    expect(() => strategy.calculateScore(invalidQuestions, [])).toThrow(
      ConflictException,
    );
    expect(() => strategy.calculateScore(invalidQuestions, [])).toThrow(
      'Each question must have one correct option',
    );
  });

  it('throws ConflictException if a question has multiple correct options in standard strategy', () => {
    const invalidQuestions: GradingQuestion[] = [
      {
        id: 'q_invalid',
        options: [
          { id: 'opt1', isCorrect: true },
          { id: 'opt2', isCorrect: true },
        ],
      },
    ];

    expect(() => strategy.calculateScore(invalidQuestions, [])).toThrow(
      ConflictException,
    );
    expect(() => strategy.calculateScore(invalidQuestions, [])).toThrow(
      'Each question must have one correct option',
    );
  });

  it('ignores answers that do not match any question id', () => {
    const answers: GradingAnswer[] = [
      { questionId: 'q_foreign', selectedOptionId: 'opt_any' },
    ];

    const result = strategy.calculateScore(mockQuestions, answers);

    expect(result).toEqual({
      score: 0,
      correctCount: 0,
      incorrectCount: 2,
    });
  });
});

