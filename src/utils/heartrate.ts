import type { HeartRateRow } from "../types.js";

export const HEART_RATE_BUCKETS = ["avg", "min", "max", "count"] as const;
export type HeartRateBucket = (typeof HEART_RATE_BUCKETS)[number];

/** One hourly bucket of heart rate samples. */
export interface HourlyHeartRate {
  /** Hour start in the timestamp's own timezone (Oura returns UTC), YYYY-MM-DDTHH:00. */
  hour: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

/**
 * Extract the hour-start key from an Oura timestamp. Timestamps come back
 * as ISO 8601 with a UTC offset ("...T09:30:00.000Z" or "+00:00"), so the
 * hour is read as expressed in the timestamp itself — deterministic and
 * independent of the host timezone.
 */
function hourKey(timestamp: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(timestamp);
  return match ? `${match[1]}T${match[2]}:00` : timestamp;
}

/**
 * Group heart rate samples into hourly buckets. JSON consumers get all four
 * aggregates per hour; `--bucket` only selects which one the table/plain
 * views headline with.
 */
export function aggregateHeartRate(rows: HeartRateRow[]): HourlyHeartRate[] {
  const buckets = new Map<string, { sum: number; min: number; max: number; count: number }>();

  for (const row of rows) {
    const key = hourKey(row.timestamp);
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, { sum: row.bpm, min: row.bpm, max: row.bpm, count: 1 });
    } else {
      current.sum += row.bpm;
      current.min = Math.min(current.min, row.bpm);
      current.max = Math.max(current.max, row.bpm);
      current.count += 1;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([hour, b]) => ({
      hour,
      avg: Math.round((b.sum / b.count) * 10) / 10,
      min: b.min,
      max: b.max,
      count: b.count,
    }));
}
