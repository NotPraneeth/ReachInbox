import { Router } from "express";
import { requireAuth } from "../auth";

const router = Router();

router.get("/me", requireAuth, (req, res) => {
  const { id, googleId, email, name, avatarUrl, createdAt } = req.user!;
  res.json({ id, googleId, email, name, avatarUrl, createdAt });
});

export default router;