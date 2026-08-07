import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, logInfo, output } from "../output/index.js";
import { validateISODateTime } from "../utils/date.js";
import { UsageError } from "../utils/errors.js";
import {
  aggregateHeartRate,
  HEART_RATE_BUCKETS,
  type HeartRateBucket,
  type HourlyHeartRate,
} from "../utils/heartrate.js";

const BUCKET_LABEL: Record<HeartRateBucket, string> = {
  avg: "Avg bpm",
  min: "Min bpm",
  max: "Max bpm",
  count: "Samples",
};

/**
 * `oura heartrate` — heart rate samples aggregated into hourly buckets.
 * Requires an explicit --start/--end datetime range; --bucket selects the
 * headline aggregate for table/plain output (JSON always carries all four).
 */
export function registerHeartrate(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("heartrate")
    .description("Heart rate samples aggregated per hour (requires --start/--end)")
    .option("--start <datetime>", "Range start — ISO 8601, e.g. 2026-01-18 or 2026-01-18T09:30")
    .option("--end <datetime>", "Range end — ISO 8601")
    .option("--bucket <mode>", "Hourly aggregate to display: avg, min, max, count", "avg")
    .action(async (opts: { start?: string; end?: string; bucket?: string }) => {
      if (!opts.start || !opts.end) {
        throw new UsageError("heartrate requires both --start and --end");
      }
      const start = validateISODateTime(opts.start);
      const end = validateISODateTime(opts.end);
      if (start > end) {
        throw new UsageError(`--start (${start}) is after --end (${end})`);
      }
      const bucket = opts.bucket as HeartRateBucket;
      if (!HEART_RATE_BUCKETS.includes(bucket)) {
        throw new UsageError(`--bucket must be one of: ${HEART_RATE_BUCKETS.join(", ")}`);
      }

      const rows = await client.heartRate(start, end);
      const hours = aggregateHeartRate(rows);

      if (hours.length === 0) {
        logInfo(ctx, "No heart rate samples in range — heartrate needs a Gen3+ ring and app sync");
      }

      output(ctx, hours, {
        columns: bucketColumns(bucket),
        formatter: (data) => formatPlain(data as HourlyHeartRate[], bucket),
        quietKey: "hour",
      });
    });
}

function bucketColumns(bucket: HeartRateBucket): ColumnConfig[] {
  const columns: ColumnConfig[] = [{ key: "hour", header: "Hour" }];
  columns.push({ key: bucket, header: BUCKET_LABEL[bucket] });
  if (bucket !== "count") columns.push({ key: "count", header: "Samples" });
  return columns;
}

function formatPlain(hours: HourlyHeartRate[], bucket: HeartRateBucket): string {
  if (hours.length === 0) return "(no data)";
  return hours
    .map((h) => {
      const value = bucket === "count" ? String(h.count) : String(h[bucket] ?? "—");
      const samples = bucket === "count" ? "" : `  (${h.count} sample${h.count === 1 ? "" : "s"})`;
      return `${h.hour}  ${BUCKET_LABEL[bucket]} ${value}${samples}`;
    })
    .join("\n");
}
