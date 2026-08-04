import { config } from "../src/config";
import redis from "../src/redis";
import { prisma } from "../src/db";
import { emailQueue } from "../src/services/queue";

/**
 * Stage 14 verification: enqueue 1,000 synthetic jobs against a no-op sender
 * and print the resulting per-hour distribution for a manual sanity-check
 * against the Section 6.2 worked example (1000 recipients, delaySec=2,
 * hourlyLimit=200 → 5 hourly windows × 200 each).
 *
 * Unlike the integration test, this script does NOT spin up a real worker.
 * It only verifies that computeSchedule produces the correct distribution.
 *
 * Usage: npm run simulate-burst
 */

const TOTAL = 1000;
const DELAY_SEC = 2;
const HOURLY_LIMIT = 200;

function floorToHour(ts: number): number {
  return Math.floor(ts / 3600_000) * 3600_000;
}

async function main() {
  console.log(`[burst] Simulating ${TOTAL} recipients, delaySec=${DELAY_SEC}, hourlyLimit=${HOURLY_LIMIT}`);

  const user = await prisma.user.findFirst();
  const sender = await prisma.sender.findFirst();
  if (!user || !sender) {
    console.error("[burst] No user/sender found — run `npm run seed` first.");
    process.exit(1);
  }

  // Use an hour boundary as start so buckets are deterministic.
  const now = Date.now();
  const hourBoundary = floorToHour(now) + 3600_000; // next hour
  const startTime = new Date(hourBoundary);

  console.log(`[burst] startTime = ${startTime.toISOString()} (next hour boundary)`);

  // Create campaign + messages to exercise the real computeSchedule path.
  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: "Stage 14 burst simulation",
      bodyHtml: "<p>burst simulation test</p>",
      startTime,
      delayBetweenEmailsSec: DELAY_SEC,
      hourlyLimit: HOURLY_LIMIT,
      totalRecipients: TOTAL,
    },
  });

  // Import computeSchedule to get the expected distribution.
  const { computeSchedule } = await import("../src/lib/computeSchedule");
  const schedule = computeSchedule(
    Array.from({ length: TOTAL }, (_, i) => `burst-${i}@example.com`),
    { startTime, delaySec: DELAY_SEC, hourlyLimit: HOURLY_LIMIT },
  );

  console.log(`[burst] computeSchedule produced ${schedule.length} items`);

  // Create messages + enqueue them (so the DB mirrors what the API would create).
  const messages = await prisma.emailMessage.createManyAndReturn({
    data: schedule.map((s) => ({
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: s.recipient,
      scheduledAt: s.scheduledAt,
    })),
  });

  await emailQueue.addBulk(
    messages.map((m) => ({
      name: "send",
      data: { messageId: m.id },
      opts: { jobId: m.id, delay: 0 },
    })),
  );

  console.log(`[burst] Enqueued ${messages.length} jobs`);

  // Print per-hour distribution from the computed schedule.
  const perHour = new Map<number, number>();
  for (const item of schedule) {
    const bucket = floorToHour(item.scheduledAt.getTime());
    perHour.set(bucket, (perHour.get(bucket) ?? 0) + 1);
  }

  console.log("");
  console.log("[burst] Per-hour distribution:");
  console.log("  Window | Count | Time range");
  let windowIdx = 0;
  for (const [ts, count] of [...perHour.entries()].sort((a, b) => a[0] - b[0])) {
    const start = new Date(ts).toISOString();
    const end = new Date(ts + 3600_000).toISOString();
    console.log(`  ${String(windowIdx + 1).padStart(6)} | ${String(count).padStart(5)} | ${start} → ${end}`);
    windowIdx++;
  }
  console.log("");

  const windowCounts = [...perHour.values()];
  const allExactlyLimit = windowCounts.every((c) => c === HOURLY_LIMIT);
  const lastWindow = windowCounts[windowCounts.length - 1];
  const totalWindows = windowCounts.length;
  const expectedWindows = Math.ceil(TOTAL / HOURLY_LIMIT); // 1000/200 = 5

  console.log(`[burst] Windows: ${totalWindows}, expected: ${expectedWindows}`);
  console.log(`[burst] All windows at exactly ${HOURLY_LIMIT}: ${allExactlyLimit}`);
  console.log(`[burst] Last window count: ${lastWindow}`);

  // Cleanup: remove test data.
  await emailQueue.obliterate({ force: true });
  await prisma.emailMessage.deleteMany({ where: { campaignId: campaign.id } });
  await prisma.campaign.delete({ where: { id: campaign.id } });

  const ok =
    totalWindows === expectedWindows &&
    allExactlyLimit &&
    schedule.length === TOTAL;

  console.log(ok ? "\n[burst] PASS: distribution matches the Section 6.2 worked example." : "\n[burst] FAIL");

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[burst] Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
