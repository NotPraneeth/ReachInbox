import { describe, it, expect } from "vitest";
import { computeSchedule, floorToHour } from "../src/lib/computeSchedule";

const HOUR_MS = 3600 * 1000;

describe("computeSchedule", () => {
  it("matches the Section 6.2 worked example (1000 recipients, delaySec=2, hourlyLimit=200)", () => {
    // Start exactly on an hour boundary so hour buckets are deterministic.
    const startTime = new Date("2026-08-04T14:00:00.000Z");
    const recipients = Array.from({ length: 1000 }, (_, i) => `r${i}`);

    const schedule = computeSchedule(recipients, {
      startTime,
      delaySec: 2,
      hourlyLimit: 200,
    });

    expect(schedule).toHaveLength(1000);

    // Per-hour distribution: 5 windows x 200 each.
    const perHour = new Map<number, number>();
    for (const item of schedule) {
      const bucket = floorToHour(item.scheduledAt.getTime());
      perHour.set(bucket, (perHour.get(bucket) ?? 0) + 1);
    }
    expect([...perHour.values()]).toEqual([200, 200, 200, 200, 200]);

    // First recipient lands exactly at startTime.
    expect(schedule[0].scheduledAt.getTime()).toBe(startTime.getTime());

    // Consecutive sends within a window are spaced by delaySec (2000ms).
    expect(schedule[1].scheduledAt.getTime() - schedule[0].scheduledAt.getTime()).toBe(2000);
    expect(schedule[199].scheduledAt.getTime() - schedule[0].scheduledAt.getTime()).toBe(199 * 2000);

    // Recipient #201 (index 200) rolls to the start of hour-window 2.
    expect(schedule[200].scheduledAt.getTime()).toBe(startTime.getTime() + HOUR_MS);

    // The last recipient of the batch is in hour-window 5.
    expect(schedule[999].scheduledAt.getTime()).toBe(startTime.getTime() + 4 * HOUR_MS + 199 * 2000);
  });

  it("preserves recipient FIFO order", () => {
    const startTime = new Date("2026-08-04T14:00:00.000Z");
    const recipients = ["a@x.com", "b@x.com", "c@x.com"];

    const schedule = computeSchedule(recipients, {
      startTime,
      delaySec: 1,
      hourlyLimit: 200,
    });

    expect(schedule.map((s) => s.recipient)).toEqual(recipients);
  });

  it("handles a single recipient", () => {
    const startTime = new Date("2026-08-04T14:00:00.000Z");
    const schedule = computeSchedule(["only@x.com"], {
      startTime,
      delaySec: 5,
      hourlyLimit: 10,
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].scheduledAt.getTime()).toBe(startTime.getTime());
  });

  it("handles an empty recipient list", () => {
    const schedule = computeSchedule([], {
      startTime: new Date(),
      delaySec: 2,
      hourlyLimit: 10,
    });
    expect(schedule).toHaveLength(0);
  });

  it("rejects an invalid hourlyLimit", () => {
    expect(() =>
      computeSchedule(["a@x.com"], {
        startTime: new Date(),
        delaySec: 2,
        hourlyLimit: 0,
      }),
    ).toThrow();
  });

  it("aligns exactly on an hour boundary when start is mid-hour", () => {
    const startTime = new Date("2026-08-04T14:17:30.000Z");
    const recipients = ["a@x.com", "b@x.com"];

    const schedule = computeSchedule(recipients, {
      startTime,
      delaySec: 2,
      hourlyLimit: 200,
    });

    // First recipient lands at startTime, not rounded.
    expect(schedule[0].scheduledAt.getTime()).toBe(startTime.getTime());
    // Second is delaySec later.
    expect(schedule[1].scheduledAt.getTime()).toBe(startTime.getTime() + 2000);
  });

  it("handles delaySec=0 (burst within the same hour)", () => {
    const startTime = new Date("2026-08-04T14:00:00.000Z");
    const recipients = ["a@x.com", "b@x.com", "c@x.com"];

    const schedule = computeSchedule(recipients, {
      startTime,
      delaySec: 0,
      hourlyLimit: 200,
    });

    // All scheduled at startTime (no spacing).
    for (const item of schedule) {
      expect(item.scheduledAt.getTime()).toBe(startTime.getTime());
    }
  });

  it("rolls to next hour when hourlyLimit=1", () => {
    const startTime = new Date("2026-08-04T14:00:00.000Z");
    const recipients = ["a@x.com", "b@x.com", "c@x.com"];

    const schedule = computeSchedule(recipients, {
      startTime,
      delaySec: 2,
      hourlyLimit: 1,
    });

    expect(schedule).toHaveLength(3);

    const perHour = new Map<number, number>();
    for (const item of schedule) {
      const bucket = floorToHour(item.scheduledAt.getTime());
      perHour.set(bucket, (perHour.get(bucket) ?? 0) + 1);
    }
    expect([...perHour.values()]).toEqual([1, 1, 1]);

    // First in hour 1, second rolls to hour 2, third to hour 3.
    expect(schedule[0].scheduledAt.getTime()).toBe(startTime.getTime());
    expect(schedule[1].scheduledAt.getTime()).toBe(startTime.getTime() + HOUR_MS);
    expect(schedule[2].scheduledAt.getTime()).toBe(startTime.getTime() + 2 * HOUR_MS);
  });
});
