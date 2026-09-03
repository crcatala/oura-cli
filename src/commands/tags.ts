import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, output } from "../output/index.js";
import type { EnhancedTag } from "../types.js";
import { resolveDateWindow } from "../utils/date.js";

const COLUMNS: ColumnConfig[] = [
  { key: "start_day", header: "Day" },
  { key: "tag_type_code", header: "Type" },
  { key: "start_time", header: "Start" },
  { key: "end_time", header: "End" },
  { key: "comment", header: "Comment" },
];

export interface TagRow {
  start_day: string;
  tag_type_code: string;
  start_time: string;
  end_time: string;
  comment: string;
}

/**
 * Table/plain type label: standardized codes as-is, custom tags by name,
 * text-only tags (null code and name) as "(text)".
 */
export function tagLabel(tag: EnhancedTag): string {
  if (tag.tag_type_code === "custom") return tag.custom_name ?? "(text)";
  if (tag.tag_type_code) return tag.tag_type_code;
  return tag.custom_name ?? "(text)";
}

export function toTagRow(tag: EnhancedTag): TagRow {
  return {
    start_day: tag.start_day,
    tag_type_code: tagLabel(tag),
    start_time: tag.start_time,
    end_time: tag.end_time ?? "—",
    comment: tag.comment ?? "—",
  };
}

export function formatTagPlain(rows: TagRow[]): string {
  if (rows.length === 0) return "(no data)";
  return rows
    .map((row) => {
      const span = row.end_time !== "—" ? `${row.start_time} → ${row.end_time}` : row.start_time;
      const comment = row.comment !== "—" ? `  ${row.comment}` : "";
      return `${row.start_day}  ${row.tag_type_code}  ${span}${comment}`;
    })
    .join("\n");
}

/**
 * `oura tags` — enhanced_tag lifestyle events (standardized, custom, and
 * text-only). Windowed on start_day with the workouts/sessions pattern.
 * The legacy `/tag` collection is out of scope.
 */
export function registerTags(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("tags")
    .description("Lifestyle tags: alcohol, caffeine, travel, illness, custom, and text-only")
    .option("--date <date>", "YYYY-MM-DD, or today/yesterday")
    .option("--days <n>", "Look back N days (from today)")
    .option("--start <date>", "Range start (YYYY-MM-DD)")
    .option("--end <date>", "Range end (YYYY-MM-DD)")
    .action(async (opts: { date?: string; days?: string; start?: string; end?: string }) => {
      const window = resolveDateWindow({
        date: opts.date,
        days: opts.days !== undefined ? Number(opts.days) : undefined,
        start: opts.start,
        end: opts.end,
      });

      const rows =
        window.start === window.end
          ? await client.enhancedTagDay(window.start)
          : await client.enhancedTagRange(window.start, window.end);

      if (ctx.output.quiet || ctx.output.format === "json") {
        output(ctx, rows);
        return;
      }

      const display = rows.map(toTagRow);
      output(ctx, display, {
        columns: COLUMNS,
        formatter: (data) => formatTagPlain(data as TagRow[]),
      });
    });
}
