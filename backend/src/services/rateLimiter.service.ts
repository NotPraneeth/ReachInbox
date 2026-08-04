import { config } from "../config";
import redis from "../redis";
import { currentHourWindow } from "../lib/computeSchedule";

const RATE_KEY_PREFIX = "rl:hour:";
const SAFETY_TTL_SEC = 7200;

export interface ReserveResult {
  allowed: boolean;
  count: number;
  limit: number;
  key: string;
  windowStart: number;
}

function redisKeyFor(windowStart: number, senderId?: string): string {
  const base = `${RATE_KEY_PREFIX}${windowStart}`;
  if (config.scheduling.rateLimitMode === "per_sender") {
    return `${base}:${senderId}`;
  }
  return base;
}

export function hourlyLimitFor(_senderId?: string): number {
  if (config.scheduling.rateLimitMode === "per_sender") {
    return config.scheduling.maxEmailsPerHourPerSender;
  }
  return config.scheduling.maxEmailsPerHour;
}

/**
 * Atomically reserves a rate-limit slot for the current hour window.
 * `redis.incr` is atomic, so this is race-safe across worker processes
 * (Section 6.3). If the post-increment count exceeds the limit, the slot
 * is released (decr) and `allowed` is false — the caller then re-delays
 * the job into the next window.
 */
export async function reserveSlot(senderId?: string): Promise<ReserveResult> {
  const windowStart = currentHourWindow();
  const key = redisKeyFor(windowStart, senderId);
  const limit = hourlyLimitFor(senderId);

  const count = await redis.incr(key);
  if (count === 1) {
    // Safety TTL only — not relied on for correctness, since the hourly
    // window key itself naturally expires the following hour.
    await redis.expire(key, SAFETY_TTL_SEC);
  }

  if (count > limit) {
    await redis.decr(key);
    return { allowed: false, count: count - 1, limit, key, windowStart };
  }

  return { allowed: true, count, limit, key, windowStart };
}

/** Releases a previously taken slot (used on the over-limit path). */
export async function releaseSlot(senderId?: string): Promise<void> {
  const key = redisKeyFor(currentHourWindow(), senderId);
  const current = await redis.get(key);
  if (current && Number.parseInt(current, 10) > 0) {
    await redis.decr(key);
  }
}

/** Reads the current usage (for diagnostics/debugging). */
export async function currentUsage(senderId?: string): Promise<number> {
  const key = redisKeyFor(currentHourWindow(), senderId);
  const value = await redis.get(key);
  return value ? Number.parseInt(value, 10) : 0;
}
