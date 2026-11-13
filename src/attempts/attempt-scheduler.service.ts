import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttemptStatus } from '@prisma/client';
import { AttemptsRepository } from './attempts.repository';
import { AttemptsService } from './attempts.service';

const BATCH_SIZE = 50;

@Injectable()
export class AttemptSchedulerService {
  private readonly logger = new Logger(AttemptSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly attemptsRepository: AttemptsRepository,
    private readonly attemptsService: AttemptsService,
  ) {}

  /** Scan and auto-finalize all IN_PROGRESS attempts whose deadline has passed. */
  @Cron('*/10 * * * * *')
  async handleExpiredAttempts(): Promise<number> {
    if (this.isRunning) {
      return 0;
    }

    this.isRunning = true;
    let finalizedCount = 0;
    const failedIds: string[] = [];

    try {
      for (;;) {
        const expired = await this.attemptsRepository.findExpired(
          BATCH_SIZE,
          [...failedIds],
        );
        if (expired.length === 0) {
          break;
        }

        for (const attempt of expired) {
          try {
            await this.attemptsService.finalizeExpiredAttempt(attempt);
            finalizedCount += 1;
          } catch (error) {
            if (error instanceof ConflictException) {
              try {
                const current = await this.attemptsRepository.findById(
                  attempt.id,
                );
                if (!current || current.status !== AttemptStatus.IN_PROGRESS) {
                  continue;
                }
              } catch {
                // Fall through and skip this attempt for the current tick.
              }
            }

            failedIds.push(attempt.id);
            this.logger.error(
              `Failed to auto-finalize expired attempt ${attempt.id}`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }
      }

      if (finalizedCount > 0) {
        this.logger.log(`Auto-finalized ${finalizedCount} expired attempt(s)`);
      }

      return finalizedCount;
    } catch (error) {
      this.logger.error(
        'Failed to scan expired attempts',
        error instanceof Error ? error.stack : String(error),
      );
      return finalizedCount;
    } finally {
      this.isRunning = false;
    }
  }
}
