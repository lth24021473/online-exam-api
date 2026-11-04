import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AttemptStatus, Role, ViolationType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttemptsService } from './attempts.service';
import { AttemptsRepository } from './attempts.repository';
import { RecordViolationDto } from './dto/record-violation.dto';

describe('AttemptsService - Proctoring', () => {
  let service: AttemptsService;

  const mockRepository = {
    recordViolation: jest.fn(),
    findViolations: jest.fn(),
    findById: jest.fn(),
    submitInProgress: jest.fn(),
    listQuestionsWithKey: jest.fn(),
    listAnswers: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptsService,
        {
          provide: AttemptsRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<AttemptsService>(AttemptsService);
  });

  describe('recordViolation', () => {
    it('should record violation and not terminate when count < maxViolations', async () => {
      mockRepository.recordViolation.mockResolvedValue({
        violation: {
          id: 'v1',
          attemptId: 'att1',
          type: ViolationType.TAB_SWITCH,
          detail: 'Left tab',
          createdAt: new Date(),
        },
        violationCount: 1,
        maxViolations: 3,
        shouldTerminate: false,
      } as any);

      const res = await service.recordViolation('user1', 'att1', {
        type: ViolationType.TAB_SWITCH,
        detail: 'Left tab',
      });

      expect(res.violationCount).toBe(1);
      expect(res.maxViolations).toBe(3);
      expect(res.terminated).toBe(false);
      expect(res.submitted).toBe(false);
      expect(res.result).toBeNull();
    });

    it('should terminate and auto-submit attempt when count reaches maxViolations', async () => {
      mockRepository.recordViolation.mockResolvedValue({
        violation: {
          id: 'v3',
          attemptId: 'att1',
          type: ViolationType.FULLSCREEN_EXIT,
          detail: 'Exited fullscreen',
          createdAt: new Date(),
        },
        violationCount: 3,
        maxViolations: 3,
        shouldTerminate: true,
      } as any);

      const inProgressAttempt: any = {
        id: 'att1',
        userId: 'user1',
        examId: 'exam1',
        status: AttemptStatus.IN_PROGRESS,
        deadlineAt: new Date(Date.now() + 60000),
        totalQuestions: 2,
        violationCount: 3,
      };

      const submittedAttempt: any = {
        ...inProgressAttempt,
        status: AttemptStatus.SUBMITTED,
        submittedAt: new Date(),
        score: 5,
        correctCount: 1,
        incorrectCount: 1,
        terminatedReason: 'EXCEEDED_VIOLATIONS',
        exam: {
          id: 'exam1',
          title: 'Test Exam',
          instructions: null,
          durationMinutes: 30,
        },
      };

      mockRepository.findById.mockResolvedValue(inProgressAttempt);
      mockRepository.submitInProgress.mockImplementation(async (attId, uId, grade) => {
        const questions: any = [
          { id: 'q1', options: [{ id: 'o1', isCorrect: true }] },
          { id: 'q2', options: [{ id: 'o2', isCorrect: true }] },
        ];
        const answers: any = [
          { questionId: 'q1', selectedOptionId: 'o1' },
        ];
        const gradeData = grade(questions, answers, inProgressAttempt);
        return {
          ...submittedAttempt,
          ...gradeData,
        };
      });

      mockRepository.listQuestionsWithKey.mockResolvedValue([
        {
          id: 'q1',
          position: 0,
          content: 'Q1',
          options: [{ id: 'o1', position: 0, content: 'Opt 1', isCorrect: true }],
        },
        {
          id: 'q2',
          position: 1,
          content: 'Q2',
          options: [{ id: 'o2', position: 0, content: 'Opt 2', isCorrect: true }],
        },
      ] as any);

      mockRepository.listAnswers.mockResolvedValue([
        { questionId: 'q1', selectedOptionId: 'o1' },
      ] as any);

      const res = await service.recordViolation('user1', 'att1', {
        type: ViolationType.FULLSCREEN_EXIT,
        detail: 'Exited fullscreen',
      });

      expect(res.violationCount).toBe(3);
      expect(res.terminated).toBe(true);
      expect(res.submitted).toBe(true);
      expect(res.result).toBeDefined();
      expect(res.result.summary.terminatedReason).toBe('EXCEEDED_VIOLATIONS');
      expect(mockRepository.submitInProgress).toHaveBeenCalledTimes(1);
    });
  });

  describe('getViolations', () => {
    it('should allow student to view their own violations', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 'att1',
        userId: 'user1',
      } as any);
      mockRepository.findViolations.mockResolvedValue([
        {
          id: 'v1',
          attemptId: 'att1',
          type: ViolationType.TAB_SWITCH,
          detail: 'Left tab',
          createdAt: new Date(),
        },
      ] as any);

      const res = await service.getViolations('user1', Role.STUDENT, 'att1');
      expect(res.attemptId).toBe('att1');
      expect(res.violations).toHaveLength(1);
    });

    it('should throw NotFoundException if student tries to view another user attempt violations', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 'att1',
        userId: 'other_user',
      } as any);

      await expect(
        service.getViolations('user1', Role.STUDENT, 'att1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow exam manager to view violations for any student attempt', async () => {
      mockRepository.findById.mockResolvedValue({
        id: 'att1',
        userId: 'student1',
      } as any);
      mockRepository.findViolations.mockResolvedValue([
        {
          id: 'v1',
          attemptId: 'att1',
          type: ViolationType.DEVTOOLS_OPEN,
          detail: 'F12 pressed',
          createdAt: new Date(),
        },
      ] as any);

      const res = await service.getViolations('manager1', Role.EXAM_MANAGER, 'att1');
      expect(res.attemptId).toBe('att1');
      expect(res.violations).toHaveLength(1);
      expect(res.violations[0].type).toBe(ViolationType.DEVTOOLS_OPEN);
    });
  });

  describe('RecordViolationDto validation', () => {
    it('should validate valid violation type successfully', async () => {
      const dto = plainToInstance(RecordViolationDto, {
        type: ViolationType.TAB_SWITCH,
        detail: 'Rời khỏi tab thi 5 giây',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation on invalid violation type', async () => {
      const dto = plainToInstance(RecordViolationDto, {
        type: 'INVALID_VIOLATION_TYPE',
        detail: 'Some detail',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('type');
    });
  });
});
