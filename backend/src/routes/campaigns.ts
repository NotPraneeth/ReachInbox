import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import { createScheduledCampaign } from "../services/scheduler.service";
import { getConfigDefaults } from "../lib/configDefaults";

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const campaignSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().min(1).max(500),
  bodyHtml: z.string().min(1),
  recipients: z
    .array(z.string().min(1))
    .min(1)
    .max(5000)
    .refine((list) => list.every((r) => EMAIL_RE.test(r.trim())), {
      message: "One or more recipients are not valid email addresses",
    }),
  startTime: z.string().datetime(),
  delayBetweenEmailsSec: z.number().int().positive(),
  hourlyLimit: z.number().int().positive(),
});

router.post("/campaigns", requireAuth, async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.flatten().fieldErrors,
    });
  }

  const input = parsed.data;

  // Verify the sender belongs to the logged-in user.
  const sender = await prisma.sender.findFirst({
    where: { id: input.senderId, userId: req.user!.id },
  });
  if (!sender) {
    return res.status(404).json({ error: "Sender not found" });
  }

  // Enforce system bounds (Assumption #5): a batch may not bypass system
  // throttling by setting a smaller delay or larger hourly limit.
  const bounds = getConfigDefaults();
  if (input.delayBetweenEmailsSec < bounds.delayBetweenEmailsSec.min ||
      input.delayBetweenEmailsSec > bounds.delayBetweenEmailsSec.max) {
    return res.status(422).json({
      error: "delayBetweenEmailsSec out of bounds",
      bounds: bounds.delayBetweenEmailsSec,
    });
  }
  if (input.hourlyLimit < bounds.hourlyLimit.min ||
      input.hourlyLimit > bounds.hourlyLimit.max) {
    return res.status(422).json({
      error: "hourlyLimit out of bounds",
      bounds: bounds.hourlyLimit,
    });
  }

  const startTime = new Date(input.startTime);
  if (Number.isNaN(startTime.getTime())) {
    return res.status(400).json({ error: "Invalid startTime" });
  }

  try {
    const result = await createScheduledCampaign({
      userId: req.user!.id,
      senderId: input.senderId,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      recipients: input.recipients.map((r) => r.trim()),
      startTime,
      delayBetweenEmailsSec: input.delayBetweenEmailsSec,
      hourlyLimit: input.hourlyLimit,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error("[api] createScheduledCampaign failed:", err);
    res.status(500).json({ error: "Failed to schedule campaign" });
  }
});

export default router;
