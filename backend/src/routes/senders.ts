import { Router } from "express";
import { requireAuth } from "../auth";
import { prisma } from "../db";

const router = Router();

router.get("/senders", requireAuth, async (req, res) => {
  const senders = await prisma.sender.findMany({
    where: { userId: req.user!.id },
    select: {
      id: true,
      displayName: true,
      email: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(senders);
});

export default router;
