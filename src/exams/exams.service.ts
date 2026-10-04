import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Role } from '@prisma/client';
import { ExamsRepository } from './exams.repository';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

@Injectable()
export class ExamsService {
  constructor(private readonly examsRepository: ExamsRepository) {}

  async findOneOrFail(id: string) {
    const exam = await this.examsRepository.findById(id);
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private assertOwner(exam: { managerId: string }, userId: string, role: Role) {
    if (role === Role.ADMIN) return; // ADMIN bypasses ownership
    if (exam.managerId !== userId)
      throw new ForbiddenException('You do not own this exam');
  }

  async create(managerId: string, dto: CreateExamDto) {
    return this.examsRepository.create({
      title: dto.title,
      description: dto.description,
      instructions: dto.instructions,
      durationMinutes: dto.durationMinutes,
      manager: { connect: { id: managerId } },
    });
  }

  async findAll(userId: string, role: Role) {
    if (role === Role.ADMIN) return this.examsRepository.findAll();
    if (role === Role.EXAM_MANAGER) return this.examsRepository.findManyByManager(userId);
    return this.examsRepository.findManyPublished();
  }

  async findOne(id: string, userId: string, role: Role) {
    const exam = await this.findOneOrFail(id);
    if (role === Role.ADMIN) return exam;
    if (role === Role.EXAM_MANAGER) {
      this.assertOwner(exam, userId, role);
    } else if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ForbiddenException('Exam is not published');
    }
    return exam;
  }

  async update(id: string, managerId: string, dto: UpdateExamDto, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status === ExamStatus.CLOSED)
      throw new BadRequestException('Cannot edit a closed exam');
    return this.examsRepository.update(id, dto);
  }

  async remove(id: string, managerId: string, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status !== ExamStatus.DRAFT)
      throw new BadRequestException('Only DRAFT exams can be deleted');
    await this.examsRepository.delete(id);
  }

  async publish(id: string, managerId: string, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status !== ExamStatus.DRAFT)
      throw new BadRequestException('Only DRAFT exams can be published');
    if (exam.questions.length === 0)
      throw new BadRequestException(
        'Exam must have at least one question before publishing',
      );
    return this.examsRepository.publish(id);
  }

  async close(id: string, managerId: string, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status !== ExamStatus.PUBLISHED)
      throw new BadRequestException('Only PUBLISHED exams can be closed');
    return this.examsRepository.close(id);
  }
}
