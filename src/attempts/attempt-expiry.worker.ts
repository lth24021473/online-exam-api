import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Attempt, AttemptStatus } from '@prisma/client';
import { QUEUE_ATTEMPT_EXPIRY } from '../queue/queue.constants';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

export interface AttemptExpiryJobData {
  attemptId: string;
  examId?: string;
}

export interface AttemptExpiryResult {
  attemptId: string;
  status: string;
  score?: number | null;
  terminatedReason?: string | null;
}

@Processor(QUEUE_ATTEMPT_EXPIRY)
export class AttemptExpiryWorker extends WorkerHost {
  private readonly logger = new Logger(AttemptExpiryWorker.name);

  constructor(
    private readonly attemptsRepository: AttemptsRepository,
    private readonly attemptsService: AttemptsService,
  ) {
    super();
  }

  async process(job: Job<AttemptExpiryJobData>): Promise<AttemptExpiryResult> {
    const { attemptId, examId } = job.data || {};
    this.logger.log(
      `Processing delayed expiry job ${job.id} for attempt ${attemptId} (exam: ${examId})`,
    );

    if (!attemptId) {
      this.logger.warn(`Job ${job.id} is missing attemptId. Skipping.`);
      return { attemptId: '', status: 'IGNORED_INVALID_DATA' };
    }

    const attempt = await this.attemptsRepository.findById(attemptId);
    if (!attempt) {
      this.logger.warn(
        `Attempt ${attemptId} not found in database. Expiry job skipped.`,
      );
      return { attemptId, status: 'NOT_FOUND' };
    }

    if (attempt.status === AttemptStatus.SUBMITTED) {
      this.logger.log(
        `Attempt ${attemptId} was already SUBMITTED. No auto-expiry required.`,
      );
      return {
        attemptId,
        status: attempt.status,
        score: attempt.score,
        terminatedReason: attempt.terminatedReason,
      };
    }

    if (attempt.status === AttemptStatus.CANCELLED) {
      this.logger.log(
        `Attempt ${attemptId} was CANCELLED. No auto-expiry required.`,
      );
      return {
        attemptId,
        status: attempt.status,
        score: attempt.score,
        terminatedReason: attempt.terminatedReason,
      };
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      this.logger.log(
        `Attempt ${attemptId} has status ${attempt.status}. No auto-expiry required.`,
      );
      return {
        attemptId,
        status: attempt.status,
      };
    }

    try {
      const finalized = (await this.attemptsService.finalizeExpiredAttempt(
        attempt,
      )) as Attempt;

      this.logger.log(
        `Successfully auto-finalized attempt ${attemptId} (score: ${finalized.score}, reason: ${finalized.terminatedReason})`,
      );

      return {
        attemptId,
        status: finalized.status,
        score: finalized.score,
        terminatedReason: finalized.terminatedReason,
      };
    } catch (error) {
      // Check for concurrent submission or cancellation
      try {
        const current = await this.attemptsRepository.findById(attemptId);
        if (current && current.status !== AttemptStatus.IN_PROGRESS) {
          this.logger.log(
            `Attempt ${attemptId} was concurrently resolved to ${current.status}.`,
          );
          return {
            attemptId,
            status: current.status,
            score: current.score,
            terminatedReason: current.terminatedReason,
          };
        }
      } catch (checkErr) {
        this.logger.warn(
          `Failed to re-check attempt ${attemptId} status after error: ${checkErr}`,
        );
      }

      this.logger.error(
        `Error auto-finalizing expired attempt ${attemptId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}
