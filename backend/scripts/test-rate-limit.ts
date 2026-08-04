import { config } from "../src/config";
import redis from "../src/redis";
import { prisma } from "../src/db";
import { emailQueue, createWorker } from "../src/services/queue";
import { processMessage } from "../src/services/processor";

/**
 * Stage 6 verification: enqueue 300 jobs against an hourly cap of 200 and
 * assert that exactly 200 reach SENT in the current window while 100 are
 * correctly rolled into the next hour (PENDING, scheduledAt = next boundary),
 * with no duplicates and WORKER_CONCURRENCY=10.
 *
 * Usage: npm run test-rate-limit
 */

// Deterministic overrides for this test. minDelay is zeroed so the worker's
// queue limiter (1/sec at the default 2000ms) does not throttle the burst —
// the hourly cap is the only constraint under test.
config.scheduling.rateLimitMode = "per_sender";
config.scheduling.maxEmailsPerHourPerSender = 200;
config.scheduling.workerConcurrency = 10;
config.scheduling.minDelayBetweenEmailsMs = 0;

const TOTAL = 300;
const LIMIT = 200;

async function main() {
  // Clean slate: no leftover rate-limit counters or queue state.
  const keys = await redis.keys("rl:hour:*");
  if (keys.length > 0) await redis.del(...keys);
  await emailQueue.drain();
  await emailQueue.clean(0, 0, "completed");
  await emailQueue.clean(0, 0, "failed");
  await emailQueue.clean(0, 0, "delayed");

  const user = await prisma.user.findFirst();
  const sender = await prisma.sender.findFirst();
  if (!user || !sender) {
    console.error("[test] No user/sender found — run `npm run seed` first.");
    process.exit(1);
  }

  const start = Date.now();
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: "Stage 6 rate-limit test",
      bodyHtml: "<p>test</p>",
      startTime: new Date(start),
      delayBetweenEmailsSec: 0,
      hourlyLimit: LIMIT,
      totalRecipients: TOTAL,
    },
  });

  const messages = await prisma.emailMessage.createManyAndReturn({
    data: Array.from({ length: TOTAL }, (_, i) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: `rl-test-${i}@example.com`,
      scheduledAt: new Date(start + i), // essentially now, sequential
    })),
  });

  await emailQueue.addBulk(
    messages.map((m) => ({
      name: "send",
      data: { messageId: m.id },
      opts: { jobId: m.id, delay: 0 },
    })),
  );

  // Spin up the worker in-process with concurrency 10.
  const worker = createWorker(processMessage);
  console.log(
    `[test] Enqueued ${TOTAL} jobs, cap=${LIMIT}, concurrency=${config.scheduling.workerConcurrency}. Waiting for drain...`,
  );

  const drainTimeout = Date.now() + 90_000;
  while (Date.now() < drainTimeout) {
    const active = await emailQueue.getActiveCount();
    const delayed = await emailQueue.getDelayedCount();
    const waiting = await emailQueue.getWaitingCount();
    if (active === 0 && delayed === 0 && waiting === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  await new Promise((r) => setTimeout(r, 1500));

  const sent = await prisma.emailMessage.count({
    where: { campaignId: campaign.id, status: "SENT" },
  });
  const pending = await prisma.emailMessage.count({
    where: { campaignId: campaign.id, status: "PENDING" },
  });
  const processing = await prisma.emailMessage.count({
    where: { campaignId: campaign.id, status: "PROCESSING" },
  });
  const failed = await prisma.emailMessage.count({
    where: { campaignId: campaign.id, status: "FAILED" },
  });
  const total = await prisma.emailMessage.count({
    where: { campaignId: campaign.id },
  });

  // The rolled-over 100 must be scheduled exactly at the next hour boundary.
  const nextBoundary = await prisma.emailMessage.findMany({
    where: { campaignId: campaign.id, status: "PENDING" },
  });
  const allRolledCorrectly = nextBoundary.every(
    (m) => m.scheduledAt.getTime() % 3600_000 === 0 &&
      m.scheduledAt.getTime() > start,
  );

  console.log(`[test] SENT=${sent} PENDING=${pending} PROCESSING=${processing} FAILED=${failed} TOTAL=${total}`);
  console.log(`[test] rolled-over scheduled at next hour boundary: ${allRolledCorrectly}`);

  const ok =
    sent === LIMIT &&
    pending === TOTAL - LIMIT &&
    processing === 0 &&
    failed === 0 &&
    total === TOTAL &&
    allRolledCorrectly;

  console.log(ok ? "[test] PASS: exactly 200 sent, 100 rolled to next hour, no duplicates." : "[test] FAIL");

  // Cleanup: remove the test campaign, its messages, and all jobs so nothing
  // fires at the next hour boundary after the process exits.
  await emailQueue.obliterate({ force: true });
  await prisma.emailMessage.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaign.delete({ where: { id: campaign.id } });

  await worker.close();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[test] Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
