import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import type { ColumnConfig } from "../output/index.js";
import { output } from "../output/index.js";
import type { HasDay } from "../types.js";
import { resolveDateWindow } from "../utils/date.js";

export interface DailyCommandSpec<T extends HasDay> {
  name: string;
  description: string;
  /** Async loader: range → rows. */
  load: (client: OuraClient, start: string, end: string) => Promise<T[]>;
  /**
   * Single-day loader (uses the exclusive-end workaround). Skipping this
   * falls back to load() with start == end, which returns empty for some
   * endpoints due to Oura's exclusive end_date semantics.
   */
  loadDay?: (client: OuraClient, date: string) => Promise<T[]>;
  columns?: ColumnConfig[];
  /** Plain-text formatter. */
  format?: (rows: T[]) => string;
  /** For single-doc endpoints, pick the doc from rows (default: last row). */
  pick?: (rows: T[]) => T | null;
}

// ── shared plain-text formatter for daily commands ────────────────────────

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function fmtPlain(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Plain-text formatter for daily-summary rows built from the same column
 * definitions used for `--table`.  Single-day mode prints `Header: value`
 * pairs; ranges print one compact line per row.
 */
export function formatDailyPlain<T extends HasDay>(data: T | T[], columns: ColumnConfig[]): string {
  const items = Array.isArray(data) ? data : data ? [data] : [];
  if (items.length === 0) return "(no data)";

  if (items.length === 1 && !Array.isArray(data)) {
    return columns
      .map((col) => `${col.header}: ${fmtPlain(getNestedValue(items[0], col.key))}`)
      .join("\n");
  }

  return items
    .map((item) => columns.map((col) => fmtPlain(getNestedValue(item, col.key))).join("  "))
    .join("\n");
}

/**
 * Build a commander subcommand for a daily-summary endpoint with
 * --date / --days / --start / --end windowing.
 */
export function makeDailyCommand(
  program: Command,
  ctx: CliContext,
  client: OuraClient,
  spec: DailyCommandSpec<HasDay>,
): void {
  const cmd = program
    .command(spec.name)
    .description(spec.description)
    .option("--date <date>", "YYYY-MM-DD, or today/yesterday")
    .option("--days <n>", "Look back N days (from today)")
    .option("--start <date>", "Range start (YYYY-MM-DD)")
    .option("--end <date>", "Range end (YYYY-MM-DD)");

  // Note: NO default for --date — a default would make opts.date always
  // truthy and shadow --days (single-day window wins). resolveDateWindow
  // defaults to today when nothing is provided.
  cmd.action(async (opts: { date?: string; days?: string; start?: string; end?: string }) => {
    const window = resolveDateWindow({
      date: opts.date,
      days: opts.days !== undefined ? Number(opts.days) : undefined,
      start: opts.start,
      end: opts.end,
    });

    const singleDay = window.start === window.end;
    const rows =
      singleDay && spec.loadDay
        ? await spec.loadDay(client, window.start)
        : await spec.load(client, window.start, window.end);
    const data = singleDay && spec.pick ? spec.pick(rows) : rows;
    const fmt = spec.format;

    // Wire the default plain formatter when columns are defined but no
    // custom format is provided (covers all 7 daily-summary commands).
    const cols = spec.columns;
    const defaultFmt =
      !fmt && cols
        ? (d: unknown) =>
            formatDailyPlain(Array.isArray(d) ? (d as HasDay[]) : d ? [d as HasDay] : [], cols)
        : undefined;

    output(ctx, data, {
      columns: spec.columns,
      formatter: fmt ? (d) => fmt(Array.isArray(d) ? (d as HasDay[]) : d ? [d] : []) : defaultFmt,
    });
  });
}
