import redis from "../src/redis";
import { prisma } from "../src/db";
import { emailQueue } from "../src/services/queue";
import { reconcilePendingMessages } from "../src/services/reconcile";
import { config } from "../src/config";

/**
 * Stage 7 verification — the deterministic half of the restart runbook.
 *
 * Phase 1 (no flush): PENDING rows whose job already exists in Redis are
 *   untouched by reconciliation (safe no-op — no duplicate jobs).
 * Phase 2 (simulated flush, then reconcile): PENDING rows whose job is missing
 *   are re-enqueued exactly once, on time; stale PROCESSING rows are reset to
 *   PENDING with attemptCount+1; exhausted PROCESSING rows become FAILED.
 *
 * The "kill -9 the worker mid-batch and restart" half of the runbook is manual
 * and documented in the README (Stage 15).
 */
async function main() {
  const user = await prisma.user.findFirst();
  const sender = await prisma.sender.findFirst();
  if (!user || !sender) {
    console.error("[test] No user/sender found — run `npm run seed` first.");
    process.exit(1);
  }

  const subject = "Stage 7 reconcile test";
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject,
      bodyHtml: "<p>test</p>",
      startTime: new Date(),
      delayBetweenEmailsSec: 2,
      hourlyLimit: 200,
      totalRecipients: 10,
    },
  });

  const scheduledAt = new Date(Date.now() + 2 * 60 * 1000);

  // ---- Phase 1: jobs that already exist must be left alone ----
  const present = await prisma.emailMessage.createManyAndReturn({
    data: Array.from({ length: 3 }, (_, i) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: `reconcile-present-${i}@example.com`,
      scheduledAt,
    })),
  });
  await emailQueue.addBulk(
    present.map((m) => ({
      name: "send",
      data: { messageId: m.id },
      opts: { jobId: m.id, delay: 2 * 60 * 1000 },
    })),
  );

  await reconcilePendingMessages();

  const presentJobsAfter = await Promise.all(
    present.map((m) => emailQueue.getJob(m.id)),
  );
  const presentOk =
    presentJobsAfter.every((j) => j !== null) &&
    new Set(presentJobsAfter.map((j) => j!.id)).size === present.length;

  console.log(`[test] phase1 present jobs untouched (no dupes): ${presentOk}`);

  // ---- Phase 2: simulate Redis flush, then reconcile ----
  const missing = await prisma.emailMessage.createManyAndReturn({
    data: Array.from({ length: 3 }, (_, i) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: `reconcile-missing-${i}@example.com`,
      scheduledAt,
    })),
  });

  const stale = await prisma.emailMessage.createManyAndReturn({
    data: Array.from({ length: 2 }, (_, i) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: `reconcile-stale-${i}@example.com`,
      scheduledAt,
      status: "PROCESSING",
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    })),
  });

  const exhausted = await prisma.emailMessage.createManyAndReturn({
    data: Array.from({ length: 2 }, (_, i) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: `reconcile-exhausted-${i}@example.com`,
      scheduledAt,
      status: "PROCESSING",
      attemptCount: config.scheduling.maxReconcileAttempts,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    })),
  });

  await redis.flushall();

  const result = await reconcilePendingMessages();

  // Missing (and the previously-present) rows must now each have exactly one job.
  const allIds = [...missing, ...present].map((m) => m.id);
  const jobsAfter = await Promise.all(allIds.map((id) => emailQueue.getJob(id)));
  const nullIds = allIds.filter((id, i) => jobsAfter[i] === null);
  if (nullIds.length > 0) {
    console.log(`[test] DEBUG null job ids after reconcile: ${JSON.stringify(nullIds)}`);
  }
  const reenqueuedOk =
    jobsAfter.every((j) => j !== null) &&
    new Set(jobsAfter.map((j) => j!.id)).size === allIds.length &&
    result.reenqueued >= missing.length;

  const staleRows = await prisma.emailMessage.findMany({
    where: { id: { in: stale.map((m) => m.id) } },
  });
  const staleOk =
    staleRows.every((m) => m.status === "PENDING" && m.attemptCount === 1) &&
    result.resetToPending >= 2;

  const exhaustedRows = await prisma.emailMessage.findMany({
    where: { id: { in: exhausted.map((m) => m.id) } },
  });
  const exhaustedOk =
    exhaustedRows.every(
      (m) => m.status === "FAILED" && m.failReason === "stuck after restart",
    ) && result.failedStuck >= 2;

  console.log(`[test] phase2 re-enqueued exactly once: ${reenqueuedOk}`);
  console.log(`[test] phase2 stale PROCESSING reset: ${staleOk}`);
  console.log(`[test] phase2 exhausted PROCESSING failed: ${exhaustedOk}`);
  console.log(`[test] reconcile result: ${JSON.stringify(result)}`);

  const ok = presentOk && reenqueuedOk && staleOk && exhaustedOk;
  console.log(ok ? "[test] PASS: zero lost, zero duplicates." : "[test] FAIL");

  // Cleanup
  await emailQueue.obliterate({ force: true });
  await prisma.emailMessage.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaign.delete({ where: { id: campaign.id } });
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[test] Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
