export interface ScheduledItem<T> {
  recipient: T;
  scheduledAt: Date;
}

export interface ComputeScheduleOptions {
  startTime: Date;
  delaySec: number;
  hourlyLimit: number;
}

/**
 * Precomputes a `scheduledAt` for every recipient such that:
 *  - consecutive sends are spaced by at least `delaySec` (FIFO order preserved),
 *  - no more than `hourlyLimit` recipients land inside any single clock-hour bucket,
 *  - overflow rolls to the start of the next hour window.
 *
 * This runs exactly once, at campaign creation time (see Section 6.2 of the
 * implementation plan). It is a pure function: no I/O, no time-of-day reads
 * other than the passed-in `startTime`, fully unit-testable.
 */
export function computeSchedule<T>(
  recipients: readonly T[],
  options: ComputeScheduleOptions,
): ScheduledItem<T>[] {
  const { startTime, delaySec, hourlyLimit } = options;

  if (hourlyLimit < 1) {
    throw new Error("hourlyLimit must be >= 1");
  }

  const delayMs = Math.max(0, delaySec) * 1000;
  const bucketCounts = new Map<number, number>();
  const results: ScheduledItem<T>[] = [];
  let cursor = startTime.getTime();

  for (const recipient of recipients) {
    let candidate = Math.max(cursor, startTime.getTime());
    let bucketStart = floorToHour(candidate);

    while ((bucketCounts.get(bucketStart) ?? 0) >= hourlyLimit) {
      bucketStart = bucketStart + 3600 * 1000;
      candidate = bucketStart;
    }

    bucketCounts.set(bucketStart, (bucketCounts.get(bucketStart) ?? 0) + 1);
    results.push({ recipient, scheduledAt: new Date(candidate) });
    cursor = candidate + delayMs;
  }

  return results;
}

export function floorToHour(ms: number): number {
  return Math.floor(ms / 3600_000) * 3600_000;
}

export function currentHourWindow(now: Date = new Date()): number {
  return floorToHour(now.getTime());
}

export function nextHourBoundary(now: Date = new Date()): Date {
  return new Date(currentHourWindow(now) + 3600_000);
}
