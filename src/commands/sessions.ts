import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, output } from "../output/index.js";
import { SESSION_TYPES, type Session } from "../types.js";
import { resolveDateWindow } from "../utils/date.js";
import { UsageError } from "../utils/errors.js";

const COLUMNS: ColumnConfig[] = [
  { key: "day", header: "Day" },
  { key: "type", header: "Type" },
  { key: "start_datetime", header: "Start" },
  { key: "end_datetime", header: "End" },
  { key: "mood", header: "Mood" },
];

export function parseSessionType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!(SESSION_TYPES as readonly string[]).includes(value)) {
    throw new UsageError(
      `Unknown session type "${value}" — valid types: ${SESSION_TYPES.join(", ")}`,
    );
  }
  return value;
}

export function filterSessions(rows: Session[], type: string | undefined): Session[] {
  if (!type) return rows;
  return rows.filter((row) => row.type === type);
}

export function formatSessionPlain(rows: Session[]): string {
  if (rows.length === 0) return "(no data)";
  return rows
    .map((row) => {
      const mood = row.mood == null || row.mood === "" ? "—" : row.mood;
      return `${row.day}  ${row.type}  ${row.start_datetime} → ${row.end_datetime}  mood=${mood}`;
    })
    .join("\n");
}

/**
 * `oura sessions` — Oura Moments (breathing, meditation, nap, relaxation,
 * rest, body_status) with --date / --days / --start/--end windowing.
 */
export function registerSessions(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("sessions")
    .description("Moments: breathing, meditation, nap, relaxation, rest, body_status")
    .option("--date <date>", "YYYY-MM-DD, or today/yesterday")
    .option("--days <n>", "Look back N days (from today)")
    .option("--start <date>", "Range start (YYYY-MM-DD)")
    .option("--end <date>", "Range end (YYYY-MM-DD)")
    .option("--type <type>", `Filter by type (${SESSION_TYPES.join(", ")})`)
    .action(
      async (opts: {
        date?: string;
        days?: string;
        start?: string;
        end?: string;
        type?: string;
      }) => {
        const type = parseSessionType(opts.type);
        const window = resolveDateWindow({
          date: opts.date,
          days: opts.days !== undefined ? Number(opts.days) : undefined,
          start: opts.start,
          end: opts.end,
        });

        const raw =
          window.start === window.end
            ? await client.sessionDay(window.start)
            : await client.sessionRange(window.start, window.end);
        const rows = filterSessions(raw, type);

        output(ctx, rows, {
          columns: COLUMNS,
          formatter: (data) => formatSessionPlain(data as Session[]),
        });
      },
    );
}
