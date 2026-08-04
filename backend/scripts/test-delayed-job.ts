import { emailQueue } from "../src/services/queue";
import { prisma } from "../src/db";

/**
 * Stage 4 verification script: inserts a PENDING EmailMessage row, then
 * enqueues a delayed job for it. Run the worker (npm run worker) in another
 * terminal and confirm it logs the job when the delay elapses.
 *
 * Usage: npm run test-delayed-job -- --delay=5000
 */
async function main() {
  const delayArg = process.argv.find((a) => a.startsWith("--delay="));
  const delayMs = delayArg ? Number.parseInt(delayArg.split("=")[1], 10) : 3000;

  const user = await prisma.user.findFirst();
  const sender = await prisma.sender.findFirst();
  if (!user || !sender) {
    console.error("[test] No user/sender found — run `npm run seed` first.");
    process.exit(1);
  }

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: "Stage 4 delayed-job test",
      bodyHtml: "<p>hello</p>",
      startTime: new Date(Date.now() + delayMs),
      delayBetweenEmailsSec: 2,
      hourlyLimit: 200,
      totalRecipients: 1,
    },
  });

  const message = await prisma.emailMessage.create({
    data: {
      campaignId: campaign.id,
      senderId: sender.id,
      recipientEmail: "test@example.com",
      scheduledAt: new Date(Date.now() + delayMs),
    },
  });

  await emailQueue.add(
    "send",
    { messageId: message.id },
    {
      jobId: message.id,
      delay: delayMs,
    },
  );

  console.log(
    `[test] Enqueued delayed job ${message.id} (fires in ${delayMs}ms). ` +
      `Watch the worker logs.`,
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
