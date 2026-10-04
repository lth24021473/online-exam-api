import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
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
    if (exam.managerId !== managerId)
      throw new ForbiddenException('You do not own this exam');
    if (exam.status === ExamStatus.CLOSED)
      throw new BadRequestException('Cannot modify questions of a closed exam');
    return exam;
  }

  async findAll(examId: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);
    return this.questionsRepository.findByExam(examId);
  }

  async findOne(examId: string, id: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);
    const question = await this.questionsRepository.findById(id);
    if (!question || question.examId !== examId)
      throw new NotFoundException('Question not found');
    return question;
  }

  async create(examId: string, managerId: string, dto: CreateQuestionDto) {
    await this.assertEditableExam(examId, managerId);

    if (dto.correctOptionIndex >= dto.options.length)
      throw new BadRequestException('correctOptionIndex is out of range');

    const existing = await this.questionsRepository.existsByPosition(examId, dto.position);
    if (existing)
      throw new BadRequestException('A question with this position already exists');

    return this.questionsRepository.create({
      exam: { connect: { id: examId } },
      content: dto.content,
      options: dto.options,
      correctOptionIndex: dto.correctOptionIndex,
      position: dto.position,
    });
  }

  async update(examId: string, id: string, managerId: string, dto: UpdateQuestionDto) {
    await this.assertEditableExam(examId, managerId);
    const question = await this.questionsRepository.findById(id);
    if (!question || question.examId !== examId)
      throw new NotFoundException('Question not found');

    const finalOptions = dto.options ?? question.options;
    const finalIndex =
      dto.correctOptionIndex !== undefined ? dto.correctOptionIndex : question.correctOptionIndex;
    if (finalIndex >= finalOptions.length)
      throw new BadRequestException('correctOptionIndex is out of range');

    if (dto.position !== undefined && dto.position !== question.position) {
      const conflict = await this.questionsRepository.existsByPosition(examId, dto.position);
      if (conflict) throw new BadRequestException('Position already taken');
    }

    return this.questionsRepository.update(id, dto);
  }

  async remove(examId: string, id: string, managerId: string) {
    await this.assertEditableExam(examId, managerId);
    const question = await this.questionsRepository.findById(id);
    if (!question || question.examId !== examId)
      throw new NotFoundException('Question not found');
    await this.questionsRepository.delete(id);
  }
}
