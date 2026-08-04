import { computeSchedule } from "../lib/computeSchedule";
import { prisma } from "../db";
import { emailQueue } from "./queue";

export interface CreateCampaignInput {
  userId: string;
  senderId: string;
  subject: string;
  bodyHtml: string;
  recipients: string[];
  startTime: Date;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}

export interface CreateCampaignResult {
  campaignId: string;
  totalRecipients: number;
  firstScheduledAt: Date;
  lastScheduledAt: Date;
}

/**
 * Turns a compose submission into a Campaign + N EmailMessage rows with
 * precomputed `scheduledAt` values, then bulk-enqueues the delayed jobs.
 * One round trip per bulk operation — no per-recipient loops (Section 6.2).
 *
 * The BullMQ jobId is always the EmailMessage.id (Section 6.4): that equality
 * is what the idempotency guarantee rests on.
 */
export async function createScheduledCampaign(
  input: CreateCampaignInput,
): Promise<CreateCampaignResult> {
  const schedule = computeSchedule(input.recipients, {
    startTime: input.startTime,
    delaySec: input.delayBetweenEmailsSec,
    hourlyLimit: input.hourlyLimit,
  });

  const campaign = await prisma.campaign.create({
    data: {
      userId: input.userId,
      senderId: input.senderId,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      startTime: input.startTime,
      delayBetweenEmailsSec: input.delayBetweenEmailsSec,
      hourlyLimit: input.hourlyLimit,
      totalRecipients: schedule.length,
    },
  });

  const messages = await prisma.emailMessage.createManyAndReturn({
    data: schedule.map((item) => ({
      campaignId: campaign.id,
      senderId: input.senderId,
      recipientEmail: item.recipient,
      scheduledAt: item.scheduledAt,
    })),
  });

  const now = Date.now();
  await emailQueue.addBulk(
    messages.map((message) => ({
      name: "send",
      data: { messageId: message.id },
      opts: {
        jobId: message.id,
        delay: Math.max(0, message.scheduledAt.getTime() - now),
      },
    })),
  );

  const firstScheduledAt = schedule[0]?.scheduledAt ?? input.startTime;
  const lastScheduledAt =
    schedule[schedule.length - 1]?.scheduledAt ?? input.startTime;

  return {
    campaignId: campaign.id,
    totalRecipients: schedule.length,
    firstScheduledAt,
    lastScheduledAt,
  };
}
