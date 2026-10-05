import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Role } from '@prisma/client';
import { ExamsRepository } from './exams.repository';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamResultsQueryDto } from './dto/exam-results-query.dto';
import { AttemptsService } from '../attempts/attempts.service';

@Injectable()
export class ExamsService {
  constructor(
    private readonly examsRepository: ExamsRepository,
    private readonly attemptsService: AttemptsService,
  ) {}

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
    if (role === Role.EXAM_MANAGER)
      return this.examsRepository.findManyByManager(userId);
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
    if (role === Role.STUDENT) {
      return {
        ...exam,
        questions: exam.questions.map((question) => ({
          ...question,
          options: question.options.map((option) => ({
            id: option.id,
            content: option.content,
            position: option.position,
          })),
        })),
      };
    }
    return exam;
  }

  async update(id: string, managerId: string, dto: UpdateExamDto, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status !== ExamStatus.DRAFT)
      throw new BadRequestException('Only DRAFT exams can be modified');
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
    if (
      exam.questions.some(
        (question) =>
          !question.content.trim() ||
          question.options.length < 2 ||
          question.options.some((option) => !option.content.trim()) ||
          question.options.filter((option) => option.isCorrect).length !== 1,
      )
    ) {
      throw new BadRequestException(
        'Each question must have at least two non-empty options and exactly one correct option',
      );
    }
    return this.examsRepository.publish(id);
  }

  async close(id: string, managerId: string, role: Role) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, managerId, role);
    if (exam.status !== ExamStatus.PUBLISHED)
      throw new BadRequestException('Only PUBLISHED exams can be closed');
    return this.examsRepository.close(id);
  }

  async results(
    id: string,
    userId: string,
    role: Role,
    query: ExamResultsQueryDto,
  ) {
    const exam = await this.findOneOrFail(id);
    this.assertOwner(exam, userId, role);
    await this.attemptsService.finalizeExpiredForExam(id);
    return {
      exam: {
        id: exam.id,
        title: exam.title,
        status: exam.status,
        durationMinutes: exam.durationMinutes,
      },
      ...(await this.examsRepository.listResults(id, query)),
    };
  }
}
