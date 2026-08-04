import express from "express";
import cors from "cors";
import passport from "passport";
import { config } from "./config";
import { configurePassport, sessionMiddleware } from "./auth";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import senderRoutes from "./routes/senders";
import configRoutes from "./routes/config";
import leadRoutes from "./routes/leads";
import campaignRoutes from "./routes/campaigns";
import emailRoutes from "./routes/emails";

configurePassport();

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRoutes);
app.use("/api", meRoutes);
app.use("/api", senderRoutes);
app.use("/api", configRoutes);
app.use("/api", leadRoutes);
app.use("/api", campaignRoutes);
app.use("/api", emailRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

app.listen(config.port, () => {
  console.log(`[server] API listening on http://localhost:${config.port}`);
});

export default app;
