import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';

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

  private async assertEditableExam(examId: string, managerId: string) {
    const exam = await this.examsService.findOneOrFail(examId);

    if (exam.managerId !== managerId) {
      throw new ForbiddenException('You do not own this exam');
    }

    if (exam.status !== ExamStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT exams can be modified');
    }

    return exam;
  }

  async findAll(examId: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);

    return this.questionsRepository.findByExam(examId);
  }

  async findOne(examId: string, id: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    return question;
  }

  async create(examId: string, managerId: string, dto: CreateQuestionDto) {
    await this.assertEditableExam(examId, managerId);

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

    return this.questionsRepository.create({
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
  ) {
    await this.assertEditableExam(examId, managerId);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    const currentCorrectIndex = question.options.find(
      (option) => option.isCorrect,
    )?.position;

    if (currentCorrectIndex === undefined) {
      throw new BadRequestException('Question has no correct option');
    }

    const finalOptions =
      dto.options ?? question.options.map((option) => option.content);

    const finalIndex = dto.correctOptionIndex ?? currentCorrectIndex;

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

    return this.questionsRepository.update(id, data);
  }

  async remove(examId: string, id: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);

    const question = await this.questionsRepository.findById(id);

    if (!question || question.examId !== examId) {
      throw new NotFoundException('Question not found');
    }

    await this.questionsRepository.delete(id);
  }
}
