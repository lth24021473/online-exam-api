export const QUEUE_ATTEMPT_EXPIRY = 'attempt-expiry-queue';
export const QUEUE_ANSWER_SAVE = 'answer-save-queue';

export const JOB_EXPIRE_ATTEMPT = 'expire-attempt';
export const JOB_SAVE_ANSWER = 'save-answer';

/**
 * Exponential backoff configuration:
 * - attempts: maximum number of retries before sending to DLQ (Dead-Letter Queue).
 * - backoff: exponential delay starting at specified base milliseconds.
 * - removeOnFail: false preserves failed jobs in the Dead-Letter Queue (failed set) for inspection and replay.
 */
export const ATTEMPT_EXPIRY_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: {
    age: 86400, // keep completed jobs for 24 hours (audit trail)
    count: 5000,
  },
  removeOnFail: false, // DLQ: keep failed jobs for investigation
};

export const ANSWER_SAVE_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 500,
  },
  removeOnComplete: {
    age: 3600, // keep completed jobs for 1 hour
    count: 10000,
  },
  removeOnFail: false, // DLQ: keep failed jobs for investigation
};
