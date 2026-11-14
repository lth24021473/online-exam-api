import { Test, TestingModule } from '@nestjs/testing';
import { AttemptStatus, ExamStatus, Role } from '@prisma/client';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './attempts.repository';
import { ShuffledMapping } from './shuffling';

describe('AttemptsService - Question & Option Shuffling (Anti-cheat)', () => {
  let service: AttemptsService;
  let repo: jest.Mocked<AttemptsRepository>;

  const exam = {
    id: 'exam-1',
    title: 'Toán học đại cương',
    instructions: 'Làm bài trong 30 phút',
    durationMinutes: 30,
    status: ExamStatus.PUBLISHED,
    opensAt: null,
    closesAt: null,
    maxAttempts: 2,
    enableProctoring: true,
    maxViolations: 3,
    managerId: 'manager-1',
    classroomId: null,
    _count: { questions: 3 },
  };

  const rawQuestions = [
    {
      id: 'q1',
      content: '1 + 1 = ?',
      position: 1,
      options: [
        { id: 'opt1-a', content: '2', position: 0 },
        { id: 'opt1-b', content: '3', position: 1 },
        { id: 'opt1-c', content: '4', position: 2 },
      ],
    },
    {
      id: 'q2',
      content: '2 * 3 = ?',
      position: 2,
      options: [
        { id: 'opt2-a', content: '5', position: 0 },
        { id: 'opt2-b', content: '6', position: 1 },
        { id: 'opt2-c', content: '7', position: 2 },
      ],
    },
    {
      id: 'q3',
      content: '10 / 2 = ?',
      position: 3,
      options: [
        { id: 'opt3-a', content: '4', position: 0 },
        { id: 'opt3-b', content: '5', position: 1 },
        { id: 'opt3-c', content: '6', position: 2 },
      ],
    },
  ];

  const rawQuestionsWithKey = [
    {
      id: 'q1',
      content: '1 + 1 = ?',
      position: 1,
      options: [
        { id: 'opt1-a', content: '2', position: 0, isCorrect: true },
        { id: 'opt1-b', content: '3', position: 1, isCorrect: false },
        { id: 'opt1-c', content: '4', position: 2, isCorrect: false },
      ],
    },
    {
      id: 'q2',
      content: '2 * 3 = ?',
      position: 2,
      options: [
        { id: 'opt2-a', content: '5', position: 0, isCorrect: false },
        { id: 'opt2-b', content: '6', position: 1, isCorrect: true },
        { id: 'opt2-c', content: '7', position: 2, isCorrect: false },
      ],
    },
    {
      id: 'q3',
      content: '10 / 2 = ?',
      position: 3,
      options: [
        { id: 'opt3-a', content: '4', position: 0, isCorrect: false },
        { id: 'opt3-b', content: '5', position: 1, isCorrect: true },
        { id: 'opt3-c', content: '6', position: 2, isCorrect: false },
      ],
    },
  ];

  beforeEach(async () => {
    const mockRepo: Partial<jest.Mocked<AttemptsRepository>> = {
      findExamForStart: jest.fn().mockResolvedValue(exam as any),
      findInProgress: jest.fn().mockResolvedValue(null),
      countSubmitted: jest.fn().mockResolvedValue(0),
      createOrResume: jest.fn(),
      findById: jest.fn(),
      findQuestionInExam: jest.fn(),
      listQuestions: jest.fn().mockResolvedValue(rawQuestions as any),
      listQuestionsWithKey: jest.fn().mockResolvedValue(rawQuestionsWithKey as any),
      listAnswers: jest.fn().mockResolvedValue([]),
      upsertAnswer: jest.fn(),
      submitInProgress: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptsService,
        { provide: AttemptsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get<AttemptsService>(AttemptsService);
    repo = module.get(AttemptsRepository);
  });

  it('renders questions and options in the shuffled mapping order for the student session', async () => {
    const shuffledMapping: ShuffledMapping = [
      { questionId: 'q3', optionIds: ['opt3-b', 'opt3-c', 'opt3-a'] },
      { questionId: 'q1', optionIds: ['opt1-c', 'opt1-a', 'opt1-b'] },
      { questionId: 'q2', optionIds: ['opt2-b', 'opt2-a', 'opt2-c'] },
    ];

    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.IN_PROGRESS,
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 1800_000),
      totalQuestions: 3,
      violationCount: 0,
      terminatedReason: null,
      shuffledMapping,
    };

    repo.createOrResume.mockResolvedValue({
      attempt: mockAttempt,
      resumed: false,
    });

    const session = await service.start('student-1', 'exam-1', Role.STUDENT);

    expect(session.resumed).toBe(false);
    expect(session.questions).toHaveLength(3);

    // Question 1 for student is q3
    expect(session.questions[0].id).toBe('q3');
    expect(session.questions[0].position).toBe(1);
    expect(session.questions[0].content).toBe('10 / 2 = ?');
    expect(session.questions[0].options).toEqual(['5', '6', '4']);

    // Question 2 for student is q1
    expect(session.questions[1].id).toBe('q1');
    expect(session.questions[1].position).toBe(2);
    expect(session.questions[1].content).toBe('1 + 1 = ?');
    expect(session.questions[1].options).toEqual(['4', '2', '3']);

    // Question 3 for student is q2
    expect(session.questions[2].id).toBe('q2');
    expect(session.questions[2].position).toBe(3);
    expect(session.questions[2].content).toBe('2 * 3 = ?');
    expect(session.questions[2].options).toEqual(['6', '5', '7']);
  });

  it('translates student display option index to the correct database optionId when saving answer', async () => {
    const shuffledMapping: ShuffledMapping = [
      { questionId: 'q1', optionIds: ['opt1-c', 'opt1-a', 'opt1-b'] },
      { questionId: 'q2', optionIds: ['opt2-b', 'opt2-a', 'opt2-c'] },
    ];

    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.IN_PROGRESS,
      deadlineAt: new Date(Date.now() + 1800_000),
      shuffledMapping,
    };

    repo.findById.mockResolvedValue(mockAttempt);
    repo.findQuestionInExam.mockResolvedValue({
      id: 'q1',
      options: [
        { id: 'opt1-a', position: 0 },
        { id: 'opt1-b', position: 1 },
        { id: 'opt1-c', position: 2 },
      ],
    } as any);

    repo.upsertAnswer.mockResolvedValue({
      questionId: 'q1',
      selectedOptionId: 'opt1-a',
      updatedAt: new Date(),
      selectedOption: { position: 0 },
    } as any);

    // Student selects index 1 in their UI (which corresponds to opt1-a in shuffled mapping: ['opt1-c', 'opt1-a', 'opt1-b'])
    const result = await service.saveAnswer('student-1', 'attempt-1', 'q1', 1);

    expect(repo.upsertAnswer).toHaveBeenCalledWith(
      'attempt-1',
      'student-1',
      'q1',
      'opt1-a',
    );
    expect(result.selectedOptionIndex).toBe(1);
  });

  it('rejects saveAnswer when selected index is out of bounds for shuffled options', async () => {
    const shuffledMapping: ShuffledMapping = [
      { questionId: 'q1', optionIds: ['opt1-a', 'opt1-b'] },
    ];

    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.IN_PROGRESS,
      deadlineAt: new Date(Date.now() + 1800_000),
      shuffledMapping,
    };

    repo.findById.mockResolvedValue(mockAttempt);
    repo.findQuestionInExam.mockResolvedValue({
      id: 'q1',
      options: [
        { id: 'opt1-a', position: 0 },
        { id: 'opt1-b', position: 1 },
      ],
    } as any);

    await expect(
      service.saveAnswer('student-1', 'attempt-1', 'q1', 5),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Selected option does not exist',
    });
  });

  it('maps previously saved answers back to student display indices upon session reload / resume', async () => {
    const shuffledMapping: ShuffledMapping = [
      { questionId: 'q1', optionIds: ['opt1-c', 'opt1-a', 'opt1-b'] },
    ];

    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.IN_PROGRESS,
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 1800_000),
      totalQuestions: 1,
      shuffledMapping,
    };

    repo.findInProgress.mockResolvedValue(mockAttempt);
    // Student previously selected opt1-a (which is at index 1 in ['opt1-c', 'opt1-a', 'opt1-b'])
    repo.listAnswers.mockResolvedValue([
      {
        questionId: 'q1',
        selectedOptionId: 'opt1-a',
        updatedAt: new Date(),
        selectedOption: { position: 0 },
      },
    ] as any);

    const session = await service.start('student-1', 'exam-1', Role.STUDENT);

    expect(session.resumed).toBe(true);
    expect(session.answers).toEqual([{ questionId: 'q1', selectedOptionIndex: 1 }]);
  });

  it('presents graded results in the attempt shuffled order with accurate display indices', async () => {
    const shuffledMapping: ShuffledMapping = [
      { questionId: 'q2', optionIds: ['opt2-c', 'opt2-b', 'opt2-a'] },
      { questionId: 'q1', optionIds: ['opt1-b', 'opt1-c', 'opt1-a'] },
    ];

    const mockAttempt: any = {
      id: 'attempt-1',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.SUBMITTED,
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + 1800_000),
      submittedAt: new Date(),
      score: 10,
      totalQuestions: 2,
      correctCount: 2,
      incorrectCount: 0,
      violationCount: 0,
      terminatedReason: 'NORMAL_SUBMIT',
      shuffledMapping,
      exam: { title: 'Toán học đại cương' },
    };

    repo.findById.mockResolvedValue(mockAttempt);
    repo.listAnswers.mockResolvedValue([
      {
        questionId: 'q2',
        selectedOptionId: 'opt2-b',
        updatedAt: new Date(),
        selectedOption: { position: 1 },
      },
      {
        questionId: 'q1',
        selectedOptionId: 'opt1-a',
        updatedAt: new Date(),
        selectedOption: { position: 0 },
      },
    ] as any);

    const result = await service.getResult('student-1', 'attempt-1');

    expect(result.questions).toHaveLength(2);

    // First question reviewed is q2
    expect(result.questions[0].id).toBe('q2');
    expect(result.questions[0].position).toBe(1);
    expect(result.questions[0].options).toEqual(['7', '6', '5']);
    // opt2-b is correct and was selected, at index 1 in ['opt2-c', 'opt2-b', 'opt2-a']
    expect(result.questions[0].selectedOptionIndex).toBe(1);
    expect(result.questions[0].correctOptionIndex).toBe(1);
    expect(result.questions[0].isCorrect).toBe(true);

    // Second question reviewed is q1
    expect(result.questions[1].id).toBe('q1');
    expect(result.questions[1].position).toBe(2);
    expect(result.questions[1].options).toEqual(['3', '4', '2']);
    // opt1-a is correct and was selected, at index 2 in ['opt1-b', 'opt1-c', 'opt1-a']
    expect(result.questions[1].selectedOptionIndex).toBe(2);
    expect(result.questions[1].correctOptionIndex).toBe(2);
    expect(result.questions[1].isCorrect).toBe(true);
  });

  it('falls back to database position ordering for legacy attempts without shuffledMapping', async () => {
    const mockAttempt: any = {
      id: 'attempt-legacy',
      userId: 'student-1',
      examId: 'exam-1',
      status: AttemptStatus.SUBMITTED,
      startedAt: new Date(),
      deadlineAt: new Date(),
      submittedAt: new Date(),
      score: 10,
      totalQuestions: 1,
      correctCount: 1,
      incorrectCount: 0,
      violationCount: 0,
      terminatedReason: 'NORMAL_SUBMIT',
      shuffledMapping: null,
      exam: { title: 'Toán học' },
    };

    repo.findById.mockResolvedValue(mockAttempt);
    repo.listQuestionsWithKey.mockResolvedValue([rawQuestionsWithKey[0]] as any);
    repo.listAnswers.mockResolvedValue([
      {
        questionId: 'q1',
        selectedOptionId: 'opt1-a',
        updatedAt: new Date(),
        selectedOption: { position: 0 },
      },
    ] as any);

    const result = await service.getResult('student-1', 'attempt-legacy');

    expect(result.questions[0].id).toBe('q1');
    expect(result.questions[0].position).toBe(1);
    expect(result.questions[0].options).toEqual(['2', '3', '4']);
    expect(result.questions[0].selectedOptionIndex).toBe(0);
    expect(result.questions[0].correctOptionIndex).toBe(0);
    expect(result.questions[0].isCorrect).toBe(true);
  });
});
