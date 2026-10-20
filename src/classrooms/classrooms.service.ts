import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassroomsRepository } from './classrooms.repository';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';

export const CLASSROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class ClassroomsService {
  constructor(private readonly classroomsRepository: ClassroomsRepository) {}

  generateCode(length = 6): string {
    let result = '';
    const charCount = CLASSROOM_CODE_CHARS.length;
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charCount);
      result += CLASSROOM_CODE_CHARS[randomIndex];
    }
    return result;
  }

  async create(managerId: string, dto: CreateClassroomDto) {
    let code = '';
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      code = this.generateCode();
      const existing = await this.classroomsRepository.findByCode(code);
      if (!existing) {
        break;
      }
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new ConflictException(
        'Không thể tạo mã lớp duy nhất, vui lòng thử lại',
      );
    }

    return this.classroomsRepository.create({
      name: dto.name.trim(),
      description: dto.description?.trim(),
      password: dto.password.trim(),
      code,
      managerId,
    });
  }

  async join(userId: string, dto: JoinClassroomDto) {
    const code = dto.code.trim().toUpperCase();
    const classroom = await this.classroomsRepository.findByCode(code);

    if (!classroom) {
      throw new NotFoundException('Mã lớp không tồn tại');
    }

    if (classroom.password !== dto.password.trim()) {
      throw new BadRequestException('Mật khẩu lớp không chính xác');
    }

    const existingMembership = await this.classroomsRepository.findMember(
      classroom.id,
      userId,
    );

    if (existingMembership) {
      throw new ConflictException('Bạn đã tham gia lớp học này rồi');
    }

    const membership = await this.classroomsRepository.addMember(
      classroom.id,
      userId,
    );

    return membership?.classroom ?? classroom;
  }

  async findManaged(managerId: string) {
    return this.classroomsRepository.findManaged(managerId);
  }

  async findJoined(userId: string) {
    return this.classroomsRepository.findJoined(userId);
  }

  async findById(classroomId: string) {
    const classroom = await this.classroomsRepository.findById(classroomId);
    if (!classroom) {
      throw new NotFoundException('Lớp học không tồn tại');
    }
    return classroom;
  }

  async findMembers(classroomId: string) {
    await this.findById(classroomId);
    return this.classroomsRepository.findMembers(classroomId);
  }

  async removeMember(
    classroomId: string,
    memberUserId: string,
    managerId: string,
  ) {
    const classroom = await this.findById(classroomId);

    if (classroom.managerId !== managerId) {
      throw new ForbiddenException('Bạn không có quyền quản lý lớp học này');
    }

    return this.classroomsRepository.removeMember(classroomId, memberUserId);
  }

  async deleteClassroom(classroomId: string, managerId: string) {
    const classroom = await this.findById(classroomId);

    if (classroom.managerId !== managerId) {
      throw new ForbiddenException('Bạn không có quyền quản lý lớp học này');
    }

    const examCount =
      classroom._count?.exams ??
      (await this.classroomsRepository.countExams(classroomId));

    if (examCount > 0) {
      throw new ConflictException(
        'Không thể xóa lớp học đã có đề thi hoặc bài làm',
      );
    }

    return this.classroomsRepository.deleteClassroom(classroomId);
  }
}
