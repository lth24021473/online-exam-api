import { Test, TestingModule } from '@nestjs/testing';
import { AttemptStatus } from '@prisma/client';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './attempts.repository';
import {
  GRADING_STRATEGY,
  GradingStrategy,
  StandardGradingStrategy,
} from './grading';

describe('AttemptsService - Grading Strategy Integration', () => {
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      findById: jest.fn(),
      submitInProgress: jest.fn(),
    };
  });

  it('defaults to StandardGradingStrategy when no strategy is injected', () => {
    const defaultService = new AttemptsService(
      mockRepo as unknown as AttemptsRepository,
    );
    expect(defaultService.getGradingStrategy()).toBeInstanceOf(
      StandardGradingStrategy,
    );
  });

  it('uses custom GradingStrategy when provided via constructor', async () => {
    const customStrategy: GradingStrategy = {
      calculateScore: jest.fn().mockReturnValue({
        score: 8.5,
        correctCount: 4,
        incorrectCount: 1,
      }),
    };

    const customService = new AttemptsService(
      mockRepo as unknown as AttemptsRepository,
      customStrategy,
    );

    expect(customService.getGradingStrategy()).toBe(customStrategy);
  });

  it('injects custom GradingStrategy via Nest DI module', async () => {
    const customStrategy: GradingStrategy = {
      calculateScore: jest.fn().mockReturnValue({
        score: 9,
        correctCount: 9,
        incorrectCount: 1,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptsService,
        {
          provide: AttemptsRepository,
          useValue: mockRepo,
        },
        {
          provide: GRADING_STRATEGY,
          useValue: customStrategy,
        },
      ],
    }).compile();

    const injectedService = module.get<AttemptsService>(AttemptsService);
    expect(injectedService.getGradingStrategy()).toBe(customStrategy);
  });

  it('delegates score calculation to the strategy during attempt submission', async () => {
    const customStrategy: GradingStrategy = {
      calculateScore: jest.fn().mockReturnValue({
        score: 7.5,
        correctCount: 3,
        incorrectCount: 1,
      }),
    };

    const deadlineAt = new Date(Date.now() + 60_000);
    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'user-1',
      examId: 'exam-1',
      status: AttemptStatus.IN_PROGRESS,
      deadlineAt,
      totalQuestions: 4,
      exam: { id: 'exam-1', title: 'Test Exam' },
    };

    mockRepo.findById.mockResolvedValue(mockAttempt);
    mockRepo.submitInProgress.mockImplementation(
      async (
        attemptId: string,
        userId: string,
        grader: (questions: any[], answers: any[], current: any) => any,
      ) => {
        const questions = [{ id: 'q1', options: [] }];
        const answers = [{ questionId: 'q1', selectedOptionId: 'opt1' }];
        const gradeResult = grader(questions, answers, mockAttempt);
        return {
          ...mockAttempt,
          ...gradeResult,
          status: AttemptStatus.SUBMITTED,
        };
      },
    );

    mockRepo.listQuestionsWithKey = jest.fn().mockResolvedValue([]);
    mockRepo.listAnswers = jest.fn().mockResolvedValue([]);

    const serviceWithCustom = new AttemptsService(
      mockRepo as unknown as AttemptsRepository,
      customStrategy,
    );

    const result = await serviceWithCustom.submit('user-1', 'attempt-1');

    expect(customStrategy.calculateScore).toHaveBeenCalledWith(
      [{ id: 'q1', options: [] }],
      [{ questionId: 'q1', selectedOptionId: 'opt1' }],
      4,
    );
    expect(result.summary.score).toBe(7.5);
    expect(result.summary.correctCount).toBe(3);
    expect(result.summary.incorrectCount).toBe(1);
    expect(result.summary.terminatedReason).toBe('NORMAL_SUBMIT');
  });
});
