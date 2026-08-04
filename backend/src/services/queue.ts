import { Queue, JobsOptions, Worker, Job } from "bullmq";
import { config } from "../config";
import redis from "../redis";

export const EMAIL_QUEUE_NAME = "email-queue";

export interface EmailJobData {
  messageId: string;
}

export function createQueue(): Queue<EmailJobData> {
  return new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: {
        age: 3600,
        count: 1000,
      },
      removeOnFail: {
        age: 24 * 3600,
        count: 5000,
      },
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
    },
  });
}

export const emailQueue = createQueue();

export function createWorker(
  processor: (
    job: Job<EmailJobData, unknown, string>,
    token?: string,
  ) => Promise<void>,
): Worker<EmailJobData, unknown, string> {
  const worker = new Worker<EmailJobData, unknown, string>(EMAIL_QUEUE_NAME, processor, {
    connection: redis,
    concurrency: config.scheduling.workerConcurrency,
    limiter: {
      // Global queue-level limiter: caps the whole queue at
      // (1000 / minDelay) per second, mimicking provider throttling (6.1).
      max: Math.max(1, Math.round(1000 / Math.max(config.scheduling.minDelayBetweenEmailsMs, 1))),
      duration: 1000,
    },
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[worker] job ${job?.id} failed after ${job?.attemptsMade} attempt(s): ${err.message}`,
    );
  });

  worker.on("completed", (job) => {
    console.log(`[worker] job ${job.id} completed`);
  });

  return worker;
}

export function queueOptionsForMessage(
  messageId: string,
  scheduledAt: Date,
): { jobId: string; opts: JobsOptions } {
  return {
    jobId: messageId,
    opts: {
      jobId: messageId,
      delay: Math.max(0, scheduledAt.getTime() - Date.now()),
    },
  };
}
