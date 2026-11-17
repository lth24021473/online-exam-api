import {
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Attempt, AttemptStatus } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_ATTEMPT_EXPIRY } from '../queue/queue.constants';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

export const SUPERVISOR_CRON_SCHEDULE = '*/1 * * * *';
export const SUPERVISOR_BATCH_SIZE = 50;

export interface SupervisorRescueReport {
  scannedCount: number;
  rescuedCount: number;
  failedCount: number;
  failedIds: string[];
}

@Injectable()
export class AttemptExpirySupervisor {
  private readonly logger = new Logger(AttemptExpirySupervisor.name);
  private isRunning = false;

  constructor(
    private readonly attemptsRepository: AttemptsRepository,
    private readonly attemptsService: AttemptsService,
    @Optional()
    @InjectQueue(QUEUE_ATTEMPT_EXPIRY)
    private readonly attemptExpiryQueue?: Queue,
  ) {}

  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Fail-safe Supervisor Cron (TV2-03)
   * Runs every minute to rescue and auto-finalize expired attempts that were
   * missed due to worker crashes, Redis downtime, or dropped delayed jobs.
   * Scans at most 50 IN_PROGRESS attempts with deadlineAt <= now().
   */
  @Cron(SUPERVISOR_CRON_SCHEDULE)
  async rescueExpiredAttempts(
    batchSize: number = SUPERVISOR_BATCH_SIZE,
  ): Promise<number> {
    const report = await this.rescueExpiredAttemptsWithReport(batchSize);
    return report.rescuedCount;
  }

  /**
   * Detailed execution returning a full rescue report for monitoring and metrics.
   */
  async rescueExpiredAttemptsWithReport(
    batchSize: number = SUPERVISOR_BATCH_SIZE,
  ): Promise<SupervisorRescueReport> {
    if (this.isRunning) {
      this.logger.debug(
        'Previous fail-safe supervisor run is still active. Skipping current tick.',
      );
      return {
        scannedCount: 0,
        rescuedCount: 0,
        failedCount: 0,
        failedIds: [],
      };
    }

    this.isRunning = true;
    let rescuedCount = 0;
    const failedIds: string[] = [];

    try {
      const expired = await this.attemptsRepository.findExpired(batchSize, [
        ...failedIds,
      ]);

      if (!expired || expired.length === 0) {
        return {
          scannedCount: 0,
          rescuedCount: 0,
          failedCount: 0,
          failedIds: [],
        };
      }

      this.logger.warn(
        `[Supervisor] Detected ${expired.length} expired attempt(s) requiring fail-safe rescue (worker crash / delayed job miss safeguard).`,
      );

      for (const attempt of expired) {
        try {
          this.logger.log(
            `[Supervisor] Rescuing expired attempt ${attempt.id} (exam: ${attempt.examId}, user: ${attempt.userId}, deadline: ${attempt.deadlineAt.toISOString()})`,
          );

          const finalized = (await this.attemptsService.finalizeExpiredAttempt(
            attempt,
          )) as Attempt;

          rescuedCount += 1;
          this.logger.log(
            `[Supervisor] Successfully rescued attempt ${attempt.id} (score: ${finalized.score}, reason: ${finalized.terminatedReason})`,
          );

          // Clean up pending delayed job in queue if present to avoid redundant processing
          if (this.attemptExpiryQueue) {
            try {
              const job = await this.attemptExpiryQueue.getJob(
                `expire-${attempt.id}`,
              );
              if (job) {
                await job.remove();
                this.logger.debug(
                  `[Supervisor] Removed pending delayed job expire-${attempt.id}`,
                );
              }
            } catch (jobErr) {
              this.logger.debug(
                `[Supervisor] Failed to remove delayed job expire-${attempt.id}: ${jobErr}`,
              );
            }
          }
        } catch (error) {
          if (error instanceof ConflictException) {
            try {
              const current = await this.attemptsRepository.findById(attempt.id);
              if (!current || current.status !== AttemptStatus.IN_PROGRESS) {
                this.logger.log(
                  `[Supervisor] Attempt ${attempt.id} was already resolved concurrently to ${current?.status}. Skipping rescue.`,
                );
                continue;
              }
            } catch (checkErr) {
              this.logger.warn(
                `[Supervisor] Failed to re-check attempt ${attempt.id} status after conflict: ${checkErr}`,
              );
            }
          }

          failedIds.push(attempt.id);
          this.logger.error(
            `[Supervisor] Failed to rescue expired attempt ${attempt.id}: ${error instanceof Error ? error.message : String(error)}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      if (rescuedCount > 0) {
        this.logger.warn(
          `[Supervisor] Fail-safe rescue completed: ${rescuedCount} attempt(s) rescued, ${failedIds.length} failed.`,
        );
      }

      return {
        scannedCount: expired.length,
        rescuedCount,
        failedCount: failedIds.length,
        failedIds,
      };
    } catch (error) {
      this.logger.error(
        `[Supervisor] Failed to scan expired attempts: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        scannedCount: 0,
        rescuedCount,
        failedCount: failedIds.length,
        failedIds,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Compatibility alias matching earlier scheduler signature
   */
  async handleExpiredAttempts(
    batchSize: number = SUPERVISOR_BATCH_SIZE,
  ): Promise<number> {
    return this.rescueExpiredAttempts(batchSize);
  }
}
