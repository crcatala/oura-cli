import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, output } from "../output/index.js";
import type { SleepPeriod } from "../types.js";
import { resolveDate } from "../utils/date.js";

const COLUMNS: ColumnConfig[] = [
  { key: "day", header: "Day" },
  { key: "id", header: "ID" },
  { key: "type", header: "Type" },
  { key: "bedtime_start", header: "Bedtime start" },
  { key: "bedtime_end", header: "Bedtime end" },
  { key: "total_sleep_duration", header: "Sleep (s)" },
];

function formatPlain(rows: SleepPeriod[]): string {
  if (rows.length === 0) return "(no sleep periods for this day)";
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
    .description("Raw sleep sessions for one day")
    .requiredOption("--date <date>", 'YYYY-MM-DD, "today", or "yesterday"')
    .action(async (opts: { date: string }) => {
      const rows = await client.sleepPeriods(resolveDate(opts.date));
      // Pass through the API records unchanged so --json retains all fields,
      // including fields not yet modeled by the CLI's TypeScript interface.
      output(ctx, rows, {
        columns: COLUMNS,
        formatter: (data) => formatPlain(data as SleepPeriod[]),
      });
    });
}
