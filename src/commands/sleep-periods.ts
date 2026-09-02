import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, output } from "../output/index.js";
import type { SleepPeriod } from "../types.js";
import { resolveDateWindow } from "../utils/date.js";
import { UsageError } from "../utils/errors.js";

const COLUMNS: ColumnConfig[] = [
  { key: "day", header: "Day" },
  { key: "id", header: "ID" },
  { key: "type", header: "Type" },
  { key: "bedtime_start", header: "Bedtime start" },
  { key: "bedtime_end", header: "Bedtime end" },
  { key: "total_sleep_duration", header: "Sleep (s)" },
];

function formatPlain(rows: SleepPeriod[]): string {
  if (rows.length === 0) return "(no sleep periods)";
  return rows
    .map(
      (row) =>
        `${row.day}  ${row.type}  ${row.bedtime_start} → ${row.bedtime_end}  ${row.total_sleep_duration ?? "—"} s`,
    )
    .join("\n");
}

/** Register `oura sleep-periods`, a bounded raw sleep-session query. */
export function registerSleepPeriods(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("sleep-periods")
    .description("Raw sleep sessions for one day or a date range")
    .option("--date <date>", 'YYYY-MM-DD, "today", or "yesterday"')
    .option("--days <n>", "Look back N days (from today)")
    .option("--start <date>", "Range start (YYYY-MM-DD)")
    .option("--end <date>", "Range end (YYYY-MM-DD)")
    .action(async (opts: { date?: string; days?: string; start?: string; end?: string }) => {
      if (!opts.date && opts.days === undefined && !opts.start && !opts.end) {
        throw new UsageError(
          "sleep-periods requires --date, --days, or --start/--end",
          "Single-day queries stay bounded; use --start/--end to inspect a raw API range",
        );
      }
      const window = resolveDateWindow({
        date: opts.date,
        days: opts.days !== undefined ? Number(opts.days) : undefined,
        start: opts.start,
        end: opts.end,
      });
      // --date (and a 1-day window) keeps the exclusive-end + day filter.
      // Ranges pass start_date/end_date through so callers can see what the
      // /sleep collection returns without the single-day workaround.
      const rows =
        window.start === window.end
          ? await client.sleepPeriods(window.start)
          : await client.sleepPeriodsRange(window.start, window.end);
      output(ctx, rows, {
        columns: COLUMNS,
        formatter: (data) => formatPlain(data as SleepPeriod[]),
      });
    });
}
