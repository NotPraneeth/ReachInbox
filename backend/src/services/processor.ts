import { Job, DelayedError } from "bullmq";
import { EmailJobData } from "./queue";
import { reserveSlot } from "./rateLimiter.service";
import { nextHourBoundary } from "../lib/computeSchedule";
import { sendEmail } from "./email.service";
import { prisma } from "../db";

/**
 * Real rate-limited, idempotent processor (Section 6.3).
 * Sends via Nodemailer + Ethereal (Stage 8).
 */
export async function processMessage(
  job: Job<EmailJobData, unknown, string>,
  token?: string,
): Promise<void> {
  const message = await prisma.emailMessage.findUnique({
    where: { id: job.data.messageId },
    include: {
      campaign: true,
      sender: true,
    },
  });

  // Idempotency guard #1: already handled (sent/failed/processing/cancelled).
  if (!message || message.status !== "PENDING") return;

  // Authoritative rate check at send time. `reserveSlot` atomically INCRs the
  // hour-window counter; if over the cap it releases the slot and returns
  // allowed=false. Race-safe across workers/instances (Section 6.3).
  const reserve = await reserveSlot(message.senderId);
  if (!reserve.allowed) {
    const nextWindow = nextHourBoundary();
    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { scheduledAt: nextWindow },
    });
    // Idempotency guard #2: re-delay the SAME job (jobId = message.id), then
    // throw DelayedError so BullMQ neither completes nor fails it.
    await job.moveToDelayed(nextWindow.getTime(), token);
    throw new DelayedError();
  }

  // Idempotency guard #3: the DB status guard. Only one worker can flip a
  // PENDING row to PROCESSING, even if BullMQ hands a stalled job to a second
  // worker. This is what prevents a duplicate send.
  const claimed = await prisma.emailMessage.updateMany({
    where: { id: message.id, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return;

  try {
    const result = await sendEmail({
      sender: message.sender,
      recipientEmail: message.recipientEmail,
      subject: message.campaign.subject,
      bodyHtml: message.campaign.bodyHtml,
    });

    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "SENT", sentAt: new Date(), testMessageUrl: result.testMessageUrl },
    });

    console.log(
      `[worker] sent ${message.recipientEmail} (${message.id})` +
        (result.testMessageUrl ? ` preview: ${result.testMessageUrl}` : ""),
    );
  } catch (err) {
    await prisma.emailMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", failReason: (err as Error).message },
    });
    // BullMQ's own attempts/backoff handles transient SMTP failures.
    throw err;
  }
}
