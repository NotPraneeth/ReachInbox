import { Router, Response } from "express";
import passport from "passport";
import { config } from "../config";

const router = Router();

router.get("/google", passport.authenticate("google"));

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (_req, res: Response) => {
    res.redirect(`${config.frontendUrl}/dashboard`);
  },
);

router.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "Logout failed" });
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

export default router;