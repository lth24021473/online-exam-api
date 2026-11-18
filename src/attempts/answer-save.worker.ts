import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConflictException, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_ANSWER_SAVE } from '../queue/queue.constants';
import { RedisService } from '../redis/redis.service';
import { AttemptsRepository } from './attempts.repository';

export interface AnswerSaveJobData {
  attemptId: string;
  userId: string;
  questionId?: string;
  selectedOptionId?: string;
  answers?: Array<{ questionId: string; selectedOptionId: string }>;
  savedAt?: number;
}

export interface AnswerSaveResult {
  attemptId: string;
  status:
    | 'SAVED'
    | 'SKIPPED_INACTIVE'
    | 'SKIPPED_INVALID_DATA'
    | 'NOT_FOUND';
  savedCount?: number;
  questionId?: string;
}

@Processor(QUEUE_ANSWER_SAVE)
export class AnswerSaveWorker extends WorkerHost {
  private readonly logger = new Logger(AnswerSaveWorker.name);

  constructor(
    private readonly repo: AttemptsRepository,
    @Optional()
    private readonly redisService?: RedisService,
  ) {
    super();
  }

  async process(job: Job<AnswerSaveJobData>): Promise<AnswerSaveResult> {
    const { attemptId, userId, questionId, selectedOptionId, answers } =
      job.data || {};

    if (!attemptId || !userId) {
      this.logger.warn(
        `Job ${job.id} is missing attemptId or userId. Skipping.`,
      );
      return {
        attemptId: attemptId || '',
        status: 'SKIPPED_INVALID_DATA',
      };
    }

    // 1. Explicit Batch Save if job payload contains an array of answers
    if (Array.isArray(answers) && answers.length > 0) {
      try {
        const saved = await this.repo.upsertAnswersBatch(
          attemptId,
          userId,
          answers,
        );
        this.logger.log(
          `Persisted explicit batch of ${saved.length} answers for attempt ${attemptId}`,
        );
        return {
          attemptId,
          status: 'SAVED',
          savedCount: saved.length,
        };
      } catch (error: any) {
        if (
          error instanceof ConflictException ||
          error.message?.includes('not active') ||
          error.message?.includes('no longer active')
        ) {
          this.logger.warn(
            `Attempt ${attemptId} is inactive during batch save: ${error.message}. Skipping.`,
          );
          return { attemptId, status: 'SKIPPED_INACTIVE' };
        }
        throw error;
      }
    }

    // 2. Load-Leveling Batching: If Redis Hash buffer holds multiple answers, batch-persist them
    if (this.redisService) {
      try {
        const hashKey = `attempt:${attemptId}:answers`;
        const buffered = await this.redisService.hgetall(hashKey);
        const bufferedEntries = Object.entries(buffered || {});

        if (bufferedEntries.length > 1) {
          const batchAnswers = bufferedEntries.map(([qId, optId]) => ({
            questionId: qId,
            selectedOptionId: optId,
          }));

          const saved = await this.repo.upsertAnswersBatch(
            attemptId,
            userId,
            batchAnswers,
          );
          this.logger.log(
            `Write-behind batched ${saved.length} answers from Redis Hash for attempt ${attemptId}`,
          );
          return {
            attemptId,
            status: 'SAVED',
            savedCount: saved.length,
            questionId,
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Redis hash lookup failed for attempt ${attemptId}: ${err.message}. Falling back to single answer save.`,
        );
      }
    }

    // 3. Single Answer Save
    if (!questionId || !selectedOptionId) {
      this.logger.warn(
        `Job ${job.id} does not contain valid questionId and selectedOptionId. Skipping.`,
      );
      return { attemptId, status: 'SKIPPED_INVALID_DATA' };
    }

    try {
      await this.repo.upsertAnswerFromBuffer(
        attemptId,
        userId,
        questionId,
        selectedOptionId,
      );
      this.logger.log(
        `Successfully saved answer for question ${questionId} in attempt ${attemptId}`,
      );
      return {
        attemptId,
        status: 'SAVED',
        savedCount: 1,
        questionId,
      };
    } catch (error: any) {
      if (
        error instanceof ConflictException ||
        error.message?.includes('not active') ||
        error.message?.includes('no longer active')
      ) {
        this.logger.warn(
          `Attempt ${attemptId} is inactive: ${error.message}. Skipping answer save.`,
        );
        return { attemptId, status: 'SKIPPED_INACTIVE', questionId };
      }
      throw error;
    }
  }
}
