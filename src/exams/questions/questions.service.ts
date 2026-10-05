import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Prisma, Role } from '@prisma/client';

import { ExamsService } from '../exams.service';
import { QuestionsRepository } from './questions.repository';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';

@Injectable()
export class QuestionsService {
  constructor(
    private readonly questionsRepository: QuestionsRepository,
    private readonly examsService: ExamsService,
  ) {}

  private async assertAccessibleExam(
    examId: string,
    managerId: string,
    role: Role,
    editable = false,
  ) {
    const exam = await this.examsService.findOneOrFail(examId);

    if (role !== Role.ADMIN && exam.managerId !== managerId) {
      throw new ForbiddenException('You do not own this exam');
    }

    if (editable && exam.status !== ExamStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT exams can be modified');
    }

    return exam;
  }

  async findAll(
    examId: string,
    managerId: string,
    role: Role = Role.EXAM_MANAGER,
  ) {
    await this.assertAccessibleExam(examId, managerId, role);

    return this.questionsRepository.findByExam(examId);
  }

  async findOne(
    examId: string,
    id: string,
    managerId: string,
    role: Role = Role.EXAM_MANAGER,
  ) {
    await this.assertAccessibleExam(examId, managerId, role);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  async create(
    examId: string,
    managerId: string,
    dto: CreateQuestionDto,
    role: Role = Role.EXAM_MANAGER,
  ) {
    await this.assertAccessibleExam(examId, managerId, role, true);

    if (dto.correctOptionIndex >= dto.options.length) {
      throw new BadRequestException('correctOptionIndex is out of range');
    }

    const existing = await this.questionsRepository.existsByPosition(
      examId,
      dto.position,
    );

    if (existing) {
      throw new BadRequestException(
        'A question with this position already exists',
      );
    }

    return this.questionsRepository.create(examId, {
      exam: {
        connect: {
          id: examId,
        },
      },

      content: dto.content,
      position: dto.position,

      options: {
        create: dto.options.map((content, position) => ({
          content,
          position,
          isCorrect: position === dto.correctOptionIndex,
        })),
      },
    });
  }

  async update(
    examId: string,
    id: string,
    managerId: string,
    dto: UpdateQuestionDto,
    role: Role = Role.EXAM_MANAGER,
  ) {
    await this.assertAccessibleExam(examId, managerId, role, true);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    const currentCorrectIndex = question.options.find(
      (option) => option.isCorrect,
    )?.position;

    if (
      currentCorrectIndex === undefined &&
      dto.correctOptionIndex === undefined
    ) {
      throw new BadRequestException('Question has no correct option');
    }

    const finalOptions =
      dto.options ?? question.options.map((option) => option.content);

    const finalIndex = dto.correctOptionIndex ?? currentCorrectIndex!;

    if (finalIndex < 0 || finalIndex >= finalOptions.length) {
      throw new BadRequestException('correctOptionIndex is out of range');
    }

    if (dto.position !== undefined && dto.position !== question.position) {
      const conflict = await this.questionsRepository.existsByPosition(
        examId,
        dto.position,
      );

      if (conflict) {
        throw new BadRequestException('Position already taken');
      }
    }

    const data: Prisma.QuestionUpdateInput = {};

    if (dto.content !== undefined) {
      data.content = dto.content;
    }

    if (dto.position !== undefined) {
      data.position = dto.position;
    }

    if (dto.options !== undefined || dto.correctOptionIndex !== undefined) {
      data.options = {
        deleteMany: {},

        create: finalOptions.map((content, position) => ({
          content,
          position,
          isCorrect: position === finalIndex,
        })),
      };
    }

    return this.questionsRepository.update(examId, id, data);
  }

  async remove(
    examId: string,
    id: string,
    managerId: string,
    role: Role = Role.EXAM_MANAGER,
  ) {
    await this.assertAccessibleExam(examId, managerId, role, true);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    await this.questionsRepository.delete(examId, id);
  }
}
