import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamStatus, Role } from '@prisma/client';
import { ExamsService } from './exams.service';
import { AttemptsService } from '../attempts/attempts.service';

describe('Exam Scheduling, Reopening & Hard Cutoff', () => {
  describe('ExamsService.reopen', () => {
    it('throws BadRequestException if exam is not CLOSED', async () => {
      const mockRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 'exam-1',
          managerId: 'mgr-1',
          status: ExamStatus.PUBLISHED,
        }),
        reopen: jest.fn(),
      } as any;
      const service = new ExamsService(mockRepo, {} as any);

      await expect(
        service.reopen('exam-1', 'mgr-1', Role.EXAM_MANAGER),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepo.reopen).not.toHaveBeenCalled();
    });

    it('successfully calls repo.reopen when exam is CLOSED', async () => {
      const mockRepo = {
        findById: jest.fn().mockResolvedValue({
          id: 'exam-1',
          managerId: 'mgr-1',
          status: ExamStatus.CLOSED,
        }),
        reopen: jest.fn().mockResolvedValue({
          id: 'exam-1',
          status: ExamStatus.PUBLISHED,
        }),
      } as any;
      const service = new ExamsService(mockRepo, {} as any);

      const result = await service.reopen('exam-1', 'mgr-1', Role.EXAM_MANAGER, {
        closesAt: '2026-10-25T17:00:00.000Z',
      });
      expect(result.status).toBe(ExamStatus.PUBLISHED);
      expect(mockRepo.reopen).toHaveBeenCalledWith(
        'exam-1',
        new Date('2026-10-25T17:00:00.000Z'),
      );
    });
  });

  describe('AttemptsService.start - Scheduling & Quota checks', () => {
    const defaultExam = {
      id: 'exam-1',
      title: 'Exam 1',
      instructions: null,
      durationMinutes: 60,
      status: ExamStatus.PUBLISHED,
      opensAt: null as Date | null,
      closesAt: null as Date | null,
      maxAttempts: 1,
      _count: { questions: 5 },
    };

    it('rejects attempt when exam opensAt is in the future', async () => {
      const futureOpen = new Date(Date.now() + 3600_000);
      const mockRepo = {
        findExamForStart: jest.fn().mockResolvedValue({
          ...defaultExam,
          opensAt: futureOpen,
        }),
        findInProgress: jest.fn().mockResolvedValue(null),
        countSubmitted: jest.fn().mockResolvedValue(0),
      } as any;
      const service = new AttemptsService(mockRepo);

      await expect(service.start('user-1', 'exam-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects attempt when exam closesAt has already passed', async () => {
      const pastClose = new Date(Date.now() - 60_000);
      const mockRepo = {
        findExamForStart: jest.fn().mockResolvedValue({
          ...defaultExam,
          closesAt: pastClose,
        }),
        findInProgress: jest.fn().mockResolvedValue(null),
        countSubmitted: jest.fn().mockResolvedValue(0),
      } as any;
      const service = new AttemptsService(mockRepo);

      await expect(service.start('user-1', 'exam-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects attempt when user has already reached maxAttempts', async () => {
      const mockRepo = {
        findExamForStart: jest.fn().mockResolvedValue({
          ...defaultExam,
          maxAttempts: 2,
        }),
        findInProgress: jest.fn().mockResolvedValue(null),
        countSubmitted: jest.fn().mockResolvedValue(2),
      } as any;
      const service = new AttemptsService(mockRepo);

      await expect(service.start('user-1', 'exam-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockRepo.countSubmitted).toHaveBeenCalledWith('user-1', 'exam-1');
    });

    it('applies Hard Cutoff: bounds deadlineAt to closesAt if closesAt is sooner than full duration', async () => {
      // Closes in 10 minutes, but duration is 60 minutes
      const closesAt = new Date(Date.now() + 10 * 60_000);
      let capturedDeadline: Date | undefined;

      const mockRepo = {
        findExamForStart: jest.fn().mockResolvedValue({
          ...defaultExam,
          durationMinutes: 60,
          closesAt,
        }),
        findInProgress: jest.fn().mockResolvedValue(null),
        countSubmitted: jest.fn().mockResolvedValue(0),
        createOrResume: jest.fn().mockImplementation((args) => {
          capturedDeadline = args.deadlineAt;
          return {
            resumed: false,
            attempt: {
              id: 'attempt-1',
              deadlineAt: args.deadlineAt,
            },
          };
        }),
      } as any;

      const service = new AttemptsService(mockRepo);
      // Stub buildSession to avoid needing full questions
      (service as any).buildSession = jest.fn().mockResolvedValue({
        attemptId: 'attempt-1',
        deadlineAt: closesAt.toISOString(),
      });

      await service.start('user-1', 'exam-1');
      expect(capturedDeadline).toEqual(closesAt);
    });
  });
});
