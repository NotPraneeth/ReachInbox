import { Router } from "express";
import { requireAuth } from "../auth";
import { getConfigDefaults } from "../lib/configDefaults";

const router = Router();

router.get("/config/defaults", requireAuth, (_req, res) => {
  res.json(getConfigDefaults());
});

export default router;
