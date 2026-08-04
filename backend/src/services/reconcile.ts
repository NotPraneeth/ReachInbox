import { prisma } from "../db";
import { emailQueue, EMAIL_QUEUE_NAME } from "./queue";
import { config } from "../config";

const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Boot-time reconciliation (Section 6.5). Runs exactly once on worker startup —
 * not on a timer. Two passes:
 *
 *  1. Any PENDING row whose job is missing from Redis is re-enqueued with its
 *     precomputed `scheduledAt` (covers a Redis flush / lost queue state).
 *  2. Any PROCESSING row older than 5 minutes (crashed mid-send) is either
 *     reset to PENDING and retried, or marked FAILED once attempts run out.
 *
 * `queue.add` with `jobId = message.id` is a safe no-op if the job already
 * exists (Section 6.4.1), so this is idempotent by construction.
 */
export async function reconcilePendingMessages(): Promise<{
  reenqueued: number;
  resetToPending: number;
  failedStuck: number;
}> {
  const results = { reenqueued: 0, resetToPending: 0, failedStuck: 0 };

  const stalePending = await prisma.emailMessage.findMany({
    where: { status: "PENDING" },
  });

  for (const message of stalePending) {
    const job = await emailQueue.getJob(message.id);
    if (job) continue; // still in the queue — nothing to do (null/undefined both mean missing)

    const delay = Math.max(0, message.scheduledAt.getTime() - Date.now());
    await emailQueue.add(
      "send",
      { messageId: message.id },
      {
        jobId: message.id,
        delay,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 5000 },
      },
    );
    results.reenqueued += 1;
  }

  const stuckProcessing = await prisma.emailMessage.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) },
    },
  });

  for (const message of stuckProcessing) {
    if (message.attemptCount < config.scheduling.maxReconcileAttempts) {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "PENDING", attemptCount: { increment: 1 } },
      });
      await emailQueue.add(
        "send",
        { messageId: message.id },
        {
          jobId: message.id,
          delay: 0,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 24 * 3600, count: 5000 },
        },
      );
      results.resetToPending += 1;
    } else {
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "FAILED", failReason: "stuck after restart" },
      });
      results.failedStuck += 1;
    }
  }

  if (results.reenqueued > 0 || results.resetToPending > 0 || results.failedStuck > 0) {
    console.log(
      `[worker] reconciliation: reenqueued=${results.reenqueued} ` +
        `resetToPending=${results.resetToPending} failedStuck=${results.failedStuck}`,
    );
  }

  return results;
}

export { EMAIL_QUEUE_NAME };
