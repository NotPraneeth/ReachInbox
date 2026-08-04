/**
 * Stage 14 — concurrent rate-limiter integration test.
 *
 * Verifies that `reserveSlot` correctly grants no more than `hourlyLimit`
 * slots even when many calls arrive concurrently, and that over-limit calls
 * release the slot they briefly held (DECR), leaving the Redis counter at
 * exactly the cap value.
 *
 * Requires a running Redis instance (default: redis://localhost:6379, i.e.
 * `docker compose up -d redis`). Each test self-skips when Redis is
 * unreachable so `npm test` still passes in environments without Docker.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config";
import redis from "../src/redis";
import { reserveSlot } from "../src/services/rateLimiter.service";
import { currentHourWindow } from "../src/lib/computeSchedule";

// ── Test-local config overrides ────────────────────────────────────────────
// config is a plain mutable object; patching it here (same technique as the
// test-rate-limit.ts script) avoids needing vi.mock for the whole module tree.
const TEST_LIMIT = 10;
const TEST_SENDER = "__rl_integration_test__";

config.scheduling.rateLimitMode = "per_sender";
config.scheduling.maxEmailsPerHourPerSender = TEST_LIMIT;

// ── Helpers ────────────────────────────────────────────────────────────────
function rlKey(senderId: string): string {
  return `rl:hour:${currentHourWindow()}:${senderId}`;
}

async function clearTestKey(): Promise<void> {
  await redis.del(rlKey(TEST_SENDER));
}

// ── Suite ──────────────────────────────────────────────────────────────────
describe("rateLimiter — concurrent slot reservation (integration, requires Redis)", () => {
  let redisReady = false;

  beforeAll(async () => {
    try {
      await redis.ping();
      redisReady = true;
    } catch {
      console.warn(
        "[integration] Redis unreachable — rate-limiter tests will be skipped.\n" +
          "             Run `docker compose up -d redis` to enable them.",
      );
    }
  });

  beforeEach(async () => {
    if (redisReady) await clearTestKey();
  });

  afterAll(async () => {
    if (redisReady) await clearTestKey();
    // Do NOT call redis.quit() — the ioredis client is a module singleton shared
    // with other modules; closing it here would break any follow-up test files.
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────
  it(
    "grants exactly TEST_LIMIT slots and rejects the rest under concurrency",
    async ({ skip }) => {
      if (!redisReady) { skip(); return; }

      const EXTRA = 5;
      const TOTAL = TEST_LIMIT + EXTRA; // 15 concurrent attempts

      const results = await Promise.all(
        Array.from({ length: TOTAL }, () => reserveSlot(TEST_SENDER)),
      );

      const allowed = results.filter((r) => r.allowed).length;
      const denied  = results.filter((r) => !r.allowed).length;

      expect(allowed).toBe(TEST_LIMIT); // exactly 10 go through
      expect(denied).toBe(EXTRA);        // exactly 5 are rejected
    },
  );

  // ── Test 2 ─────────────────────────────────────────────────────────────
  it(
    "Redis counter settles at exactly TEST_LIMIT after over-limit calls release their slots",
    async ({ skip }) => {
      if (!redisReady) { skip(); return; }

      await Promise.all(
        Array.from({ length: TEST_LIMIT + 3 }, () => reserveSlot(TEST_SENDER)),
      );

      const finalCount = Number(await redis.get(rlKey(TEST_SENDER)));
      // The 3 over-limit calls each INCR'd then DECR'd, so the counter must be
      // exactly TEST_LIMIT, not TEST_LIMIT+3.
      expect(finalCount).toBe(TEST_LIMIT);
    },
  );

  // ── Test 3 ─────────────────────────────────────────────────────────────
  it(
    "every allowed result has a count value ≤ TEST_LIMIT",
    async ({ skip }) => {
      if (!redisReady) { skip(); return; }

      const results = await Promise.all(
        Array.from({ length: TEST_LIMIT + 4 }, () => reserveSlot(TEST_SENDER)),
      );

      for (const r of results.filter((r) => r.allowed)) {
        expect(r.count).toBeGreaterThanOrEqual(1);
        expect(r.count).toBeLessThanOrEqual(TEST_LIMIT);
      }
    },
  );

  // ── Test 4 ─────────────────────────────────────────────────────────────
  it(
    "a second independent batch sees only the remaining capacity",
    async ({ skip }) => {
      if (!redisReady) { skip(); return; }

      // First batch: consume 7 of the 10 available slots.
      const first = await Promise.all(
        Array.from({ length: 7 }, () => reserveSlot(TEST_SENDER)),
      );
      expect(first.every((r) => r.allowed)).toBe(true);

      // Second batch of 5 — only 3 slots remain.
      const second = await Promise.all(
        Array.from({ length: 5 }, () => reserveSlot(TEST_SENDER)),
      );
      const secondAllowed = second.filter((r) => r.allowed).length;
      expect(secondAllowed).toBe(3);
    },
  );

  // ── Test 5 ─────────────────────────────────────────────────────────────
  it(
    "different senders are isolated — over-limit on sender A does not block sender B",
    async ({ skip }) => {
      if (!redisReady) { skip(); return; }

      const SENDER_B = "__rl_integration_test_B__";
      await redis.del(rlKey(SENDER_B));

      // Saturate sender A.
      await Promise.all(
        Array.from({ length: TEST_LIMIT + 2 }, () => reserveSlot(TEST_SENDER)),
      );

      // Sender B should still have a clean slate.
      const b = await reserveSlot(SENDER_B);
      expect(b.allowed).toBe(true);
      expect(b.count).toBe(1);

      await redis.del(rlKey(SENDER_B));
    },
  );
});
