import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth";
import { parseLeads } from "../lib/parseLeads";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/leads/parse",
  requireAuth,
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Missing file (field name: file)" });
    }

    const content = req.file.buffer.toString("utf8");
    const result = parseLeads(req.file.originalname, content);
    res.json(result);
  },
);

export default router;
