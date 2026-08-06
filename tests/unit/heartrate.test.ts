import { describe, expect, it } from "vitest";
import type { HeartRateRow } from "../../src/types.js";
import { aggregateHeartRate } from "../../src/utils/heartrate.js";

function row(timestamp: string, bpm: number): HeartRateRow {
  return { timestamp, timestamp_unix: 0, bpm, source: "awake" };
}

describe("aggregateHeartRate", () => {
  it("groups samples into hourly buckets with all four aggregates", () => {
    const rows = [
      row("2026-01-18T00:10:00.000Z", 60),
      row("2026-01-18T00:20:00.000Z", 80),
      row("2026-01-18T00:30:00.000Z", 100),
      row("2026-01-18T01:05:00.000Z", 90),
    ];
    expect(aggregateHeartRate(rows)).toEqual([
      { hour: "2026-01-18T00:00", avg: 80, min: 60, max: 100, count: 3 },
      { hour: "2026-01-18T01:00", avg: 90, min: 90, max: 90, count: 1 },
    ]);
  });

  it("rounds averages to one decimal", () => {
    const rows = [row("2026-01-18T00:00:00.000Z", 61), row("2026-01-18T00:59:00.000Z", 62)];
    const [bucket] = aggregateHeartRate(rows);
    expect(bucket.avg).toBe(61.5);
  });

  it("sorts buckets by hour even when input is unordered", () => {
    const rows = [
      row("2026-01-18T05:00:00.000Z", 70),
      row("2026-01-18T00:00:00.000Z", 60),
      row("2026-01-18T03:00:00.000Z", 65),
    ];
    expect(aggregateHeartRate(rows).map((b) => b.hour)).toEqual([
      "2026-01-18T00:00",
      "2026-01-18T03:00",
      "2026-01-18T05:00",
    ]);
  });

  it("keys on the hour as expressed in the timestamp offset (UTC)", () => {
    const rows = [row("2026-01-18T09:30:00.000+00:00", 72)];
    expect(aggregateHeartRate(rows)[0].hour).toBe("2026-01-18T09:00");
  });

  it("returns an empty array for no samples", () => {
    expect(aggregateHeartRate([])).toEqual([]);
  });
});
