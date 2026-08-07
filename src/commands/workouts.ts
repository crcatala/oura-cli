import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, output } from "../output/index.js";
import type { Workout } from "../types.js";
import { resolveDateWindow } from "../utils/date.js";

const COLUMNS: ColumnConfig[] = [
  { key: "day", header: "Day" },
  { key: "activity", header: "Activity" },
  { key: "calories", header: "Cal" },
  { key: "distance_km", header: "Dist (km)" },
  { key: "intensity", header: "Intensity" },
  { key: "source", header: "Source" },
];

interface WorkoutRow {
  day: string;
  activity: string;
  calories: string;
  distance_km: string;
  intensity: string;
  source: string;
}

function roundWorkout(w: Workout): WorkoutRow {
  return {
    day: w.day,
    activity: w.activity,
    calories: w.calories != null ? String(Math.round(w.calories)) : "—",
    distance_km: w.distance != null ? (w.distance / 1000).toFixed(2) : "—",
    intensity: w.intensity,
    source: w.source ?? "—",
  };
}

/**
 * `oura workouts` — workout sessions with --date / --days / --start/--end
 * windowing (shared resolveDateWindow semantics with the daily commands).
 */
export function registerWorkouts(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("workouts")
    .description("Workout sessions: activity, calories, distance, intensity, source")
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

      // Single-day queries use the [date, +1) workaround — Oura returns
      // nothing when start_date == end_date (verified in sandbox).
      const raw =
        window.start === window.end
          ? await client.workoutsDay(window.start)
          : await client.workouts(window.start, window.end);
      const rows = raw.map(roundWorkout);

      output(ctx, rows, {
        columns: COLUMNS,
        formatter: (data) => formatPlain(data as WorkoutRow[]),
      });
    });
}

function formatPlain(rows: WorkoutRow[]): string {
  if (rows.length === 0) return "(no workouts in this range)";
  return rows
    .map((w) => {
      const parts = [
        w.day,
        w.activity,
        `intensity=${w.intensity}`,
        w.source !== "—" ? `source=${w.source}` : null,
        `${w.calories} cal`,
        `${w.distance_km} km`,
      ].filter((part): part is string => part !== null);
      return parts.join("  ");
    })
    .join("\n");
}
