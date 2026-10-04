import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { ExamsRepository } from '../exams/exams.repository';
import { AttemptsRepository } from './attempts.repository';
import { StartAttemptDto } from './dto/start-attempt.dto';
import { SaveAnswersDto } from './dto/save-answers.dto';

@Injectable()
export class AttemptsService {
  constructor(
    private readonly attemptsRepository: AttemptsRepository,
    private readonly examsRepository: ExamsRepository,
  ) {}

  async start(userId: string, dto: StartAttemptDto) {
    const exam = await this.examsRepository.findById(dto.examId);
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== ExamStatus.PUBLISHED)
      throw new BadRequestException('Exam is not published');

    const existing = await this.attemptsRepository.findActiveByUserAndExam(userId, dto.examId);
    if (existing) throw new BadRequestException('You already have an in-progress attempt for this exam');

    const deadlineAt = new Date(Date.now() + exam.durationMinutes * 60 * 1000);

    return this.attemptsRepository.create({
      user: { connect: { id: userId } },
      exam: { connect: { id: dto.examId } },
      deadlineAt,
      totalQuestions: exam.questions.length,
    });
  }

  async findAll(userId: string) {
    return this.attemptsRepository.findByUser(userId);
  }

  async findOne(id: string, userId: string) {
    const attempt = await this.attemptsRepository.findByIdWithDetails(id);
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('You do not own this attempt');
    return attempt;
  }

  async saveAnswers(id: string, userId: string, dto: SaveAnswersDto) {
    const attempt = await this.attemptsRepository.findByIdWithDetails(id);
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('You do not own this attempt');
    if (attempt.status !== 'IN_PROGRESS')
      throw new BadRequestException('Attempt is already submitted');
    if (new Date() > attempt.deadlineAt)
      throw new BadRequestException('Attempt deadline has passed, please submit');

    await Promise.all(
      dto.answers.map((a) =>
        this.attemptsRepository.upsertAnswer(id, a.questionId, a.selectedOptionIndex),
      ),
    );

    return { message: 'Answers saved', count: dto.answers.length };
  }

  async submit(id: string, userId: string) {
    const attempt = await this.attemptsRepository.findByIdWithDetails(id);
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (attempt.userId !== userId)
      throw new ForbiddenException('You do not own this attempt');
    if (attempt.status !== 'IN_PROGRESS')
      throw new BadRequestException('Attempt is already submitted');

    // Fetch questions to grade
    const exam = await this.examsRepository.findById(attempt.examId);
    if (!exam) throw new NotFoundException('Exam not found');

    const questionMap = new Map(exam.questions.map((q) => [q.id, q.correctOptionIndex]));

    let correct = 0;
    let incorrect = 0;
    for (const answer of attempt.answers) {
      const correctIndex = questionMap.get(answer.questionId);
      if (correctIndex === undefined) continue;
      if (answer.selectedOptionIndex === correctIndex) correct++;
      else incorrect++;
    }

    const total = exam.questions.length;
    const score = total > 0 ? (correct / total) * 100 : 0;

    return this.attemptsRepository.submit(id, Math.round(score * 100) / 100, correct, incorrect);
  }
}
