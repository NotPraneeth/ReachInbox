import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function required(name: string): string {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return raw;
}

export const config = {
  port: int("PORT", 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET ?? "change-me",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://reachinbox:reachinbox@localhost:5432/reachinbox",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ??
      "http://localhost:4000/auth/google/callback",
  },

  scheduling: {
    workerConcurrency: int("WORKER_CONCURRENCY", 5),
    minDelayBetweenEmailsMs: int("MIN_DELAY_BETWEEN_EMAILS_MS", 2000),
    rateLimitMode: (process.env.RATE_LIMIT_MODE ?? "per_sender") as
      | "global"
      | "per_sender",
    maxEmailsPerHour: int("MAX_EMAILS_PER_HOUR", 200),
    maxEmailsPerHourPerSender: int("MAX_EMAILS_PER_HOUR_PER_SENDER", 150),
    maxReconcileAttempts: int("MAX_RECONCILE_ATTEMPTS", 3),
    // Compose-form bounds (Assumption #5): system defaults + hard ceilings.
    // delay is expressed in seconds; the floor is the min delay between sends.
    maxDelayBetweenEmailsSec: int("MAX_DELAY_BETWEEN_EMAILS_SEC", 3600),
  },

  ethereal: {
    autoCreate: (process.env.ETHEREAL_AUTO_CREATE ?? "true") !== "false",
    host: process.env.ETHEREAL_HOST ?? "smtp.ethereal.email",
    port: int("ETHEREAL_PORT", 587),
    // Optional override credentials (used when ETHEREAL_AUTO_CREATE=false)
    user: process.env.ETHEREAL_USER ?? "",
    pass: process.env.ETHEREAL_PASS ?? "",
  },
};

export function googleAuthEnabled(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}
