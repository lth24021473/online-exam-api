import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClassroomsService, CLASSROOM_CODE_CHARS } from './classrooms.service';
import { ClassroomsRepository } from './classrooms.repository';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';

describe('ClassroomsService', () => {
  let service: ClassroomsService;
  let repository: jest.Mocked<ClassroomsRepository>;

  const mockRepository = {
    create: jest.fn(),
    findByCode: jest.fn(),
    findById: jest.fn(),
    findManaged: jest.fn(),
    findJoined: jest.fn(),
    findMember: jest.fn(),
    addMember: jest.fn(),
    findMembers: jest.fn(),
    removeMember: jest.fn(),
    countExams: jest.fn(),
    deleteClassroom: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassroomsService,
        {
          provide: ClassroomsRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ClassroomsService>(ClassroomsService);
    repository = module.get(ClassroomsRepository);
  });

  describe('generateCode', () => {
    it('should generate a 6-character code using allowed characters', () => {
      for (let i = 0; i < 20; i++) {
        const code = service.generateCode();
        expect(code).toHaveLength(6);
        for (const char of code) {
          expect(CLASSROOM_CODE_CHARS).toContain(char);
          expect(['0', 'O', '1', 'I']).not.toContain(char);
        }
      }
    });
  });

  describe('create', () => {
    const managerId = 'manager-123';
    const dto: CreateClassroomDto = {
      name: '  Lop Toan 10A1  ',
      description: '  On thi dai hoc  ',
      password: '  pass123  ',
    };

    it('should generate code and create classroom with trimmed values', async () => {
      jest.spyOn(service, 'generateCode').mockReturnValue('ABC234');
      repository.findByCode.mockResolvedValue(null);
      repository.create.mockResolvedValue({
        id: 'class-1',
        name: 'Lop Toan 10A1',
        description: 'On thi dai hoc',
        password: 'pass123',
        code: 'ABC234',
        managerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.create(managerId, dto);

      expect(repository.findByCode).toHaveBeenCalledWith('ABC234');
      expect(repository.create).toHaveBeenCalledWith({
        name: 'Lop Toan 10A1',
        description: 'On thi dai hoc',
        password: 'pass123',
        code: 'ABC234',
        managerId,
      });
      expect(result.id).toBe('class-1');
    });

    it('should retry code generation when collision occurs and succeed', async () => {
      jest
        .spyOn(service, 'generateCode')
        .mockReturnValueOnce('CODE01')
        .mockReturnValueOnce('CODE02');

      repository.findByCode
        .mockResolvedValueOnce({ id: 'existing-class' } as any)
        .mockResolvedValueOnce(null);

      repository.create.mockResolvedValue({
        id: 'class-2',
        code: 'CODE02',
      } as any);

      const result = await service.create(managerId, {
        name: 'Lop Ly',
        password: 'secret',
      });

      expect(repository.findByCode).toHaveBeenCalledTimes(2);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CODE02' }),
      );
      expect(result.id).toBe('class-2');
    });

    it('should throw ConflictException if code generation collides 5 times', async () => {
      jest.spyOn(service, 'generateCode').mockReturnValue('COLLIDE');
      repository.findByCode.mockResolvedValue({ id: 'existing' } as any);

      await expect(
        service.create(managerId, {
          name: 'Lop Hoa',
          password: 'pass',
        }),
      ).rejects.toThrow(ConflictException);

      expect(repository.findByCode).toHaveBeenCalledTimes(5);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('join', () => {
    const userId = 'student-123';
    const dto: JoinClassroomDto = {
      code: '  abc234  ',
      password: '  pass123  ',
    };

    it('should throw NotFoundException if classroom code does not exist', async () => {
      repository.findByCode.mockResolvedValue(null);

      await expect(service.join(userId, dto)).rejects.toThrow(
        new NotFoundException('Mã lớp không tồn tại'),
      );
      expect(repository.findByCode).toHaveBeenCalledWith('ABC234');
    });

    it('should throw BadRequestException if password is incorrect', async () => {
      repository.findByCode.mockResolvedValue({
        id: 'class-1',
        code: 'ABC234',
        password: 'correct_password',
      } as any);

      await expect(service.join(userId, dto)).rejects.toThrow(
        new BadRequestException('Mật khẩu lớp không chính xác'),
      );
    });

    it('should throw ConflictException if user is already a member', async () => {
      repository.findByCode.mockResolvedValue({
        id: 'class-1',
        code: 'ABC234',
        password: 'pass123',
      } as any);
      repository.findMember.mockResolvedValue({
        id: 'member-1',
        classroomId: 'class-1',
        userId,
      } as any);

      await expect(service.join(userId, dto)).rejects.toThrow(
        new ConflictException('Bạn đã tham gia lớp học này rồi'),
      );
      expect(repository.findMember).toHaveBeenCalledWith('class-1', userId);
    });

    it('should add member and return joined classroom details on success', async () => {
      const classroom = {
        id: 'class-1',
        name: 'Lop Toan 10A1',
        code: 'ABC234',
        password: 'pass123',
        managerId: 'manager-1',
      };
      repository.findByCode.mockResolvedValue(classroom as any);
      repository.findMember.mockResolvedValue(null);
      repository.addMember.mockResolvedValue({
        id: 'member-new',
        classroomId: 'class-1',
        userId,
        classroom,
      } as any);

      const result = await service.join(userId, dto);

      expect(repository.addMember).toHaveBeenCalledWith('class-1', userId);
      const { password, ...expectedClassroom } = classroom;
      expect(result).toEqual(expectedClassroom);
    });
  });

  describe('findManaged', () => {
    it('should return classrooms owned by manager', async () => {
      const managedList = [
        {
          id: 'class-1',
          name: 'Lop 10A',
          _count: { members: 25, exams: 3 },
        },
      ];
      repository.findManaged.mockResolvedValue(managedList as any);

      const result = await service.findManaged('manager-1');

      expect(repository.findManaged).toHaveBeenCalledWith('manager-1');
      expect(result).toEqual(managedList);
    });
  });

  describe('findJoined', () => {
    it('should return classrooms joined by student with manager info and counts', async () => {
      const joinedList = [
        {
          id: 'class-1',
          name: 'Lop 10A',
          manager: {
            id: 'm-1',
            fullName: 'Thay Nam',
            email: 'nam@gmail.com',
            avatar: null,
          },
          _count: { members: 25, exams: 2 },
          joinedAt: new Date(),
        },
      ];
      repository.findJoined.mockResolvedValue(joinedList as any);

      const result = await service.findJoined('student-1');

      expect(repository.findJoined).toHaveBeenCalledWith('student-1');
      expect(result).toEqual(joinedList);
    });
  });

  describe('findById', () => {
    it('should return classroom if found', async () => {
      const classroom = {
        id: 'class-1',
        name: 'Lop 10A',
        _count: { members: 10, exams: 1 },
      };
      repository.findById.mockResolvedValue(classroom as any);

      const result = await service.findById('class-1');

      expect(repository.findById).toHaveBeenCalledWith('class-1');
      expect(result).toEqual(classroom);
    });

    it('should throw NotFoundException if classroom not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        new NotFoundException('Lớp học không tồn tại'),
      );
    });
  });

  describe('findMembers', () => {
    it('should throw NotFoundException if classroom does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findMembers('class-404')).rejects.toThrow(
        new NotFoundException('Lớp học không tồn tại'),
      );
      expect(repository.findMembers).not.toHaveBeenCalled();
    });

    it('should return member list when classroom exists', async () => {
      repository.findById.mockResolvedValue({ id: 'class-1' } as any);
      const members = [
        {
          id: 'u-1',
          fullName: 'Nguyen Van A',
          email: 'a@gmail.com',
          avatar: null,
          role: 'STUDENT',
          joinedAt: new Date(),
        },
      ];
      repository.findMembers.mockResolvedValue(members as any);

      const result = await service.findMembers('class-1');

      expect(repository.findMembers).toHaveBeenCalledWith('class-1');
      expect(result).toEqual(members);
    });
  });

  describe('removeMember', () => {
    it('should throw NotFoundException if classroom not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.removeMember('class-404', 'u-1', 'manager-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not manager of the classroom', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
      } as any);

      await expect(
        service.removeMember('class-1', 'u-1', 'other-mgr'),
      ).rejects.toThrow(
        new ForbiddenException('Bạn không có quyền quản lý lớp học này'),
      );
      expect(repository.removeMember).not.toHaveBeenCalled();
    });

    it('should remove member when caller is the manager', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
      } as any);
      repository.removeMember.mockResolvedValue({ count: 1 } as any);

      const result = await service.removeMember(
        'class-1',
        'student-1',
        'owner-mgr',
      );

      expect(repository.removeMember).toHaveBeenCalledWith(
        'class-1',
        'student-1',
      );
      expect(result).toEqual({ count: 1 });
    });
  });

  describe('deleteClassroom', () => {
    it('should throw NotFoundException if classroom not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.deleteClassroom('class-404', 'manager-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if caller is not the owner manager', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
        _count: { exams: 0 },
      } as any);

      await expect(
        service.deleteClassroom('class-1', 'other-mgr'),
      ).rejects.toThrow(
        new ForbiddenException('Bạn không có quyền quản lý lớp học này'),
      );
      expect(repository.deleteClassroom).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if classroom has exams (_count.exams > 0)', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
        _count: { exams: 2 },
      } as any);

      await expect(
        service.deleteClassroom('class-1', 'owner-mgr'),
      ).rejects.toThrow(
        new ConflictException(
          'Không thể xóa lớp học đã có đề thi hoặc bài làm',
        ),
      );
      expect(repository.deleteClassroom).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if countExams returns > 0 when _count not present', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
      } as any);
      repository.countExams.mockResolvedValue(1);

      await expect(
        service.deleteClassroom('class-1', 'owner-mgr'),
      ).rejects.toThrow(
        new ConflictException(
          'Không thể xóa lớp học đã có đề thi hoặc bài làm',
        ),
      );
      expect(repository.deleteClassroom).not.toHaveBeenCalled();
    });

    it('should delete classroom when 0 exams and caller is manager', async () => {
      repository.findById.mockResolvedValue({
        id: 'class-1',
        managerId: 'owner-mgr',
        _count: { exams: 0 },
      } as any);
      repository.deleteClassroom.mockResolvedValue({ id: 'class-1' } as any);

      const result = await service.deleteClassroom('class-1', 'owner-mgr');

      expect(repository.deleteClassroom).toHaveBeenCalledWith('class-1');
      expect(result).toEqual({ id: 'class-1' });
    });
  });
});
