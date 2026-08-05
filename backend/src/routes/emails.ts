import { Router, Request, Response } from "express";
import { MessageStatus } from "@prisma/client";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import { emailQueue } from "../services/queue";

const router = Router();

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

function pageParams(query: Record<string, unknown>) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(
      1,
      Number.parseInt(String(query.pageSize ?? String(PAGE_SIZE_DEFAULT)), 10) ||
        PAGE_SIZE_DEFAULT,
    ),
  );
  return { page, pageSize, skip: (page - 1) * pageSize };
}

async function listEmails(
  req: Request,
  res: Response,
  defaultStatuses: MessageStatus[],
  sort: "asc" | "desc" = "desc",
) {
  const { page, pageSize, skip } = pageParams(req.query);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const statusFilter =
    typeof req.query.status === "string" &&
    (Object.values(MessageStatus) as string[]).includes(req.query.status)
      ? (req.query.status as MessageStatus)
      : undefined;

  const statuses = statusFilter ? [statusFilter] : defaultStatuses;

  const where: Record<string, unknown> = {
    status: { in: statuses },
    campaign: { userId: req.user!.id },
  };

  if (search) {
    where.OR = [
      { recipientEmail: { contains: search, mode: "insensitive" } },
      { campaign: { subject: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      include: {
        campaign: { select: { subject: true } },
        sender: { select: { displayName: true, email: true } },
      },
      orderBy: { scheduledAt: sort },
      skip,
      take: pageSize,
    }),
    prisma.emailMessage.count({ where }),
  ]);

  res.json({
    items: items.map((m) => ({
      id: m.id,
      recipientEmail: m.recipientEmail,
      status: m.status,
      scheduledAt: m.scheduledAt,
      sentAt: m.sentAt,
      failReason: m.failReason,
      attemptCount: m.attemptCount,
      subject: m.campaign.subject,
      senderName: m.sender.displayName,
      senderEmail: m.sender.email,
      testMessageUrl: m.testMessageUrl,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

router.get("/emails/scheduled", requireAuth, (req, res) => {
  return listEmails(req, res, [MessageStatus.PENDING, MessageStatus.PROCESSING], "asc");
});

router.get("/emails/sent", requireAuth, (req, res) => {
  return listEmails(req, res, [MessageStatus.SENT, MessageStatus.FAILED], "desc");
});

router.get("/emails/counts", requireAuth, async (req, res) => {
  const [scheduledCount, sentCount] = await Promise.all([
    prisma.emailMessage.count({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        campaign: { userId: req.user!.id },
      },
    }),
    prisma.emailMessage.count({
      where: {
        status: { in: ["SENT", "FAILED"] },
        campaign: { userId: req.user!.id },
      },
    }),
  ]);
  res.json({ scheduledCount, sentCount });
});

// Cancel a pending email (stretch feature, Assumption #15).
router.delete("/emails/:id", requireAuth, async (req, res) => {
  const message = await prisma.emailMessage.findFirst({
    where: {
      id: req.params.id,
      campaign: { userId: req.user!.id },
      status: "PENDING",
    },
  });
  if (!message) {
    return res.status(404).json({ error: "Pending email not found" });
  }

  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { status: "CANCELLED" },
  });
  const job = await emailQueue.getJob(message.id);
  if (job) await job.remove();

  res.json({ ok: true, id: message.id });
});

export default router;
