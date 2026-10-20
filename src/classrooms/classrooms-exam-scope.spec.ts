import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExamStatus, Role } from '@prisma/client';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { ExamsService } from '../exams/exams.service';
import { ExamsRepository } from '../exams/exams.repository';
import { AttemptsService } from '../attempts/attempts.service';
import { AttemptsRepository } from '../attempts/attempts.repository';

describe('Classrooms & Exam Scope Isolation', () => {
  describe('Exam Scope Filtering in ExamsRepository / ExamsService', () => {
    let examsService: ExamsService;
    let mockExamsRepo: jest.Mocked<Partial<ExamsRepository>>;

    beforeEach(() => {
      mockExamsRepo = {
        findAll: jest.fn(),
        findManyByManager: jest.fn(),
        findManyPublished: jest.fn(),
        findByClassroom: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        findClassroomById: jest.fn(),
        isClassroomMember: jest.fn(),
      };
      examsService = new ExamsService(mockExamsRepo as any, {} as any);
    });

    it('hides class exams from student GET /exams (only returns public published exams)', async () => {
      const publicExam = { id: 'exam-pub', title: 'Public Exam', status: ExamStatus.PUBLISHED, classroomId: null };
      mockExamsRepo.findManyPublished!.mockResolvedValue([publicExam] as any);

      const result = await examsService.findAll('student-1', Role.STUDENT);

      expect(mockExamsRepo.findManyPublished).toHaveBeenCalled();
      expect(result).toEqual([publicExam]);
    });

    it('hides class exams from manager GET /exams (only returns public manager exams)', async () => {
      const managerPublicExam = { id: 'exam-mgr-pub', title: 'Mgr Exam', managerId: 'mgr-1', classroomId: null };
      mockExamsRepo.findManyByManager!.mockResolvedValue([managerPublicExam] as any);

      const result = await examsService.findAll('mgr-1', Role.EXAM_MANAGER);

      expect(mockExamsRepo.findManyByManager).toHaveBeenCalledWith('mgr-1');
      expect(result).toEqual([managerPublicExam]);
    });

    it('returns class exams only via findByClassroom', async () => {
      const classExam = { id: 'exam-class-1', title: 'Class 10A1 Exam', classroomId: 'class-1' };
      mockExamsRepo.findByClassroom!.mockResolvedValue([classExam] as any);

      const result = await examsService.findByClassroom('class-1', Role.STUDENT);

      expect(mockExamsRepo.findByClassroom).toHaveBeenCalledWith('class-1', Role.STUDENT);
      expect(result).toEqual([classExam]);
    });

    it('throws ForbiddenException when manager creates exam for classroom they do not own', async () => {
      mockExamsRepo.findClassroomById!.mockResolvedValue({
        id: 'class-1',
        managerId: 'other-manager',
      } as any);

      await expect(
        examsService.create('mgr-1', {
          title: 'Unauthorized Exam',
          durationMinutes: 45,
          classroomId: 'class-1',
        }),
      ).rejects.toThrow(
        new ForbiddenException('Bạn không quản lý lớp học này'),
      );
      expect(mockExamsRepo.create).not.toHaveBeenCalled();
    });

    it('allows manager who owns classroom to create class exam', async () => {
      mockExamsRepo.findClassroomById!.mockResolvedValue({
        id: 'class-1',
        managerId: 'mgr-1',
      } as any);
      mockExamsRepo.create!.mockResolvedValue({
        id: 'exam-new',
        title: 'Math Test',
        classroomId: 'class-1',
      } as any);

      const result = await examsService.create('mgr-1', {
        title: 'Math Test',
        durationMinutes: 45,
        classroomId: 'class-1',
      });

      expect(mockExamsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Math Test',
          classroom: { connect: { id: 'class-1' } },
        }),
      );
      expect(result.id).toBe('exam-new');
    });

    it('blocks non-member student from viewing class exam detail (403 Forbidden)', async () => {
      mockExamsRepo.findById!.mockResolvedValue({
        id: 'exam-class-1',
        title: 'Class Exam',
        managerId: 'mgr-1',
        status: ExamStatus.PUBLISHED,
        classroomId: 'class-1',
        questions: [],
      } as any);
      mockExamsRepo.isClassroomMember!.mockResolvedValue(false);

      await expect(
        examsService.findOne('exam-class-1', 'non-member-student', Role.STUDENT),
      ).rejects.toThrow(
        new ForbiddenException('Đề thi này chỉ dành cho học sinh trong lớp'),
      );
    });

    it('allows member student to view class exam detail and strips correct options', async () => {
      mockExamsRepo.findById!.mockResolvedValue({
        id: 'exam-class-1',
        title: 'Class Exam',
        managerId: 'mgr-1',
        status: ExamStatus.PUBLISHED,
        classroomId: 'class-1',
        questions: [
          {
            id: 'q1',
            content: '1 + 1 = ?',
            position: 1,
            options: [
              { id: 'opt1', content: '2', position: 0, isCorrect: true },
              { id: 'opt2', content: '3', position: 1, isCorrect: false },
            ],
          },
        ],
      } as any);
      mockExamsRepo.isClassroomMember!.mockResolvedValue(true);

      const exam = await examsService.findOne('exam-class-1', 'member-student', Role.STUDENT);

      expect(exam.id).toBe('exam-class-1');
      expect((exam.questions[0].options[0] as any).isCorrect).toBeUndefined();
    });
  });

  describe('AttemptsService Class Exam Scope Isolation', () => {
    let attemptsService: AttemptsService;
    let mockAttemptsRepo: jest.Mocked<Partial<AttemptsRepository>>;

    beforeEach(() => {
      mockAttemptsRepo = {
        findExamForStart: jest.fn(),
        isClassroomMember: jest.fn(),
        isUserAdmin: jest.fn(),
        findInProgress: jest.fn(),
        countSubmitted: jest.fn(),
        createOrResume: jest.fn(),
        listQuestions: jest.fn().mockResolvedValue([]),
        listAnswers: jest.fn().mockResolvedValue([]),
      };
      attemptsService = new AttemptsService(mockAttemptsRepo as any);
    });

    it('blocks non-member student from attempting class exam (403 Forbidden)', async () => {
      mockAttemptsRepo.findExamForStart!.mockResolvedValue({
        id: 'exam-class-1',
        title: 'Class Exam',
        status: ExamStatus.PUBLISHED,
        durationMinutes: 60,
        opensAt: null,
        closesAt: null,
        maxAttempts: 1,
        managerId: 'mgr-1',
        classroomId: 'class-1',
        _count: { questions: 10 },
      } as any);
      mockAttemptsRepo.isClassroomMember!.mockResolvedValue(false);
      mockAttemptsRepo.isUserAdmin!.mockResolvedValue(false);

      await expect(
        attemptsService.start('non-member-student', 'exam-class-1'),
      ).rejects.toThrow(
        new ForbiddenException('Đề thi này chỉ dành cho học sinh trong lớp'),
      );
    });

    it('allows member student to attempt class exam', async () => {
      mockAttemptsRepo.findExamForStart!.mockResolvedValue({
        id: 'exam-class-1',
        title: 'Class Exam',
        instructions: null,
        status: ExamStatus.PUBLISHED,
        durationMinutes: 60,
        opensAt: null,
        closesAt: null,
        maxAttempts: 1,
        managerId: 'mgr-1',
        classroomId: 'class-1',
        _count: { questions: 10 },
      } as any);
      mockAttemptsRepo.isClassroomMember!.mockResolvedValue(true);
      mockAttemptsRepo.findInProgress!.mockResolvedValue(null);
      mockAttemptsRepo.countSubmitted!.mockResolvedValue(0);
      mockAttemptsRepo.createOrResume!.mockResolvedValue({
        attempt: {
          id: 'attempt-1',
          userId: 'member-student',
          examId: 'exam-class-1',
          totalQuestions: 10,
          deadlineAt: new Date(Date.now() + 3600_000),
          startedAt: new Date(),
        },
        resumed: false,
      } as any);

      const session = await attemptsService.start('member-student', 'exam-class-1');
      expect(session.resumed).toBe(false);
      expect(session.attempt.id).toBe('attempt-1');
    });
  });

  describe('ClassroomsController Security & Endpoints', () => {
    let controller: ClassroomsController;
    let mockClassroomsService: jest.Mocked<Partial<ClassroomsService>>;
    let mockExamsService: jest.Mocked<Partial<ExamsService>>;

    beforeEach(() => {
      mockClassroomsService = {
        create: jest.fn(),
        findManaged: jest.fn(),
        findJoined: jest.fn(),
        join: jest.fn(),
        findById: jest.fn(),
        assertAccess: jest.fn(),
        findMembers: jest.fn(),
        removeMember: jest.fn(),
        deleteClassroom: jest.fn(),
      };
      mockExamsService = {
        findByClassroom: jest.fn(),
      };
      controller = new ClassroomsController(
        mockClassroomsService as any,
        mockExamsService as any,
      );
    });

    it('strips password when student calls GET /classrooms/:id', async () => {
      mockClassroomsService.assertAccess!.mockResolvedValue({
        id: 'class-1',
        name: 'Lop 10A1',
        code: 'ABC234',
        password: 'secret_password_123',
        managerId: 'mgr-1',
      } as any);

      const req = {
        user: { id: 'student-1', role: Role.STUDENT },
      } as any;

      const result = await controller.findOne('class-1', req);

      expect(mockClassroomsService.assertAccess).toHaveBeenCalledWith(
        'class-1',
        'student-1',
        Role.STUDENT,
      );
      expect(result.password).toBeUndefined();
      expect(result.name).toBe('Lop 10A1');
    });

    it('retains password when manager calls GET /classrooms/:id', async () => {
      mockClassroomsService.assertAccess!.mockResolvedValue({
        id: 'class-1',
        name: 'Lop 10A1',
        code: 'ABC234',
        password: 'secret_password_123',
        managerId: 'mgr-1',
      } as any);

      const req = {
        user: { id: 'mgr-1', role: Role.EXAM_MANAGER },
      } as any;

      const result = await controller.findOne('class-1', req);

      expect(result.password).toBe('secret_password_123');
    });

    it('blocks non-member when accessing classroom detail', async () => {
      mockClassroomsService.assertAccess!.mockRejectedValue(
        new ForbiddenException('Bạn không có quyền truy cập lớp học này'),
      );

      const req = {
        user: { id: 'stranger-user', role: Role.STUDENT },
      } as any;

      await expect(controller.findOne('class-1', req)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('delegates findExams to examsService.findByClassroom after access assertion', async () => {
      mockClassroomsService.assertAccess!.mockResolvedValue({
        id: 'class-1',
        managerId: 'mgr-1',
      } as any);
      mockExamsService.findByClassroom!.mockResolvedValue([
        { id: 'exam-1', title: 'Math 1' },
      ] as any);

      const req = {
        user: { id: 'student-member', role: Role.STUDENT },
      } as any;

      const exams = await controller.findExams('class-1', req);

      expect(mockClassroomsService.assertAccess).toHaveBeenCalledWith(
        'class-1',
        'student-member',
        Role.STUDENT,
      );
      expect(mockExamsService.findByClassroom).toHaveBeenCalledWith(
        'class-1',
        Role.STUDENT,
      );
      expect(exams).toEqual([{ id: 'exam-1', title: 'Math 1' }]);
    });

    it('delegates removeMember to classroomsService.removeMember', async () => {
      mockClassroomsService.removeMember!.mockResolvedValue({ count: 1 } as any);

      const req = {
        user: { id: 'mgr-1', role: Role.EXAM_MANAGER },
      } as any;

      const result = await controller.removeMember('class-1', 'student-2', req);

      expect(mockClassroomsService.removeMember).toHaveBeenCalledWith(
        'class-1',
        'student-2',
        'mgr-1',
        Role.EXAM_MANAGER,
      );
      expect(result).toEqual({ count: 1 });
    });

    it('delegates deleteClassroom to classroomsService.deleteClassroom', async () => {
      mockClassroomsService.deleteClassroom!.mockResolvedValue({ id: 'class-1' } as any);

      const req = {
        user: { id: 'mgr-1', role: Role.EXAM_MANAGER },
      } as any;

      const result = await controller.deleteClassroom('class-1', req);

      expect(mockClassroomsService.deleteClassroom).toHaveBeenCalledWith(
        'class-1',
        'mgr-1',
        Role.EXAM_MANAGER,
      );
      expect(result).toEqual({ id: 'class-1' });
    });
  });
});
