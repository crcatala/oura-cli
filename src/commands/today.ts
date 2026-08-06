import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { type ColumnConfig, formatTable, output } from "../output/index.js";
import type {
  DailyActivity,
  DailyReadiness,
  DailyResilience,
  DailySleep,
  DailySpO2,
  DailyStress,
  RingBatteryRow,
} from "../types.js";
import { resolveDate } from "../utils/date.js";

export interface TodayBriefing {
  date: string;
  sleep: DailySleep | null;
  readiness: DailyReadiness | null;
  activity: DailyActivity | null;
  stress: DailyStress | null;
  spo2: DailySpO2 | null;
  resilience: DailyResilience | null;
  battery: RingBatteryRow | null;
}

const SECTIONS = [
  "sleep",
  "readiness",
  "activity",
  "stress",
  "spo2",
  "resilience",
  "battery",
] as const;

/**
 * `oura today` — morning briefing: readiness, sleep, activity, stress,
 * SpO2, resilience + ring battery for one day. Missing documents (e.g.
 * sleep before app sync) become null instead of errors.
 *
 * TODO: extract sectionRows, the formatters, and filterBriefing into a
 * separate formatters/today.ts module alongside the next today feature.
 */
export function registerToday(program: Command, ctx: CliContext, client: OuraClient): void {
  program
    .command("today")
    .description("Morning briefing: sleep, readiness, activity, stress, SpO2, resilience, battery")
    .option("--date <date>", "YYYY-MM-DD, or today/yesterday", "today")
    .option(
      "--sections <csv>",
      "Comma-separated subset (sleep,readiness,activity,stress,spo2,resilience,battery)",
    )
    .action(async (opts: { date?: string; sections?: string }) => {
      const day = resolveDate(opts.date ?? "today");
      const requested = opts.sections
        ? opts.sections
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

      const want = (key: string) => requested === null || requested.includes(key);

      const [sleep, readiness, activity, stress, spo2, resilience, batteryRows] = await Promise.all(
        [
          want("sleep") ? client.dailySleep(day) : Promise.resolve(null),
          want("readiness") ? client.dailyReadiness(day) : Promise.resolve(null),
          want("activity") ? client.dailyActivity(day) : Promise.resolve(null),
          want("stress") ? client.dailyStress(day) : Promise.resolve(null),
          want("spo2") ? client.dailySpO2(day) : Promise.resolve(null),
          want("resilience") ? client.dailyResilience(day) : Promise.resolve(null),
          want("battery") ? client.ringBattery(day, day) : Promise.resolve([]),
        ],
      );

      const briefing: TodayBriefing = {
        date: day,
        sleep,
        readiness,
        activity,
        stress,
        spo2,
        resilience,
        battery: batteryRows[batteryRows.length - 1] ?? null,
      };

      // --sections filters both human and JSON output (null keys kept for
      // the sync hint in human modes but dropped entirely in JSON).
      const filtered = requested ? filterBriefing(briefing, requested) : briefing;

      output(ctx, filtered, {
        formatter: (data, format) => formatBriefing(data as TodayBriefing, format, requested),
      });
    });
}

// ---------------------------------------------------------------------------
// Human-readable briefing (plain + table)
// ---------------------------------------------------------------------------

const MISSING = "—";

interface SectionRow {
  label: string;
  score: string;
  detail: string;
}

/** Drop keys not in `requested` from the briefing object (JSON output). */
function filterBriefing(b: TodayBriefing, requested: string[]): TodayBriefing {
  const out: TodayBriefing = { date: b.date } as TodayBriefing;
  for (const key of SECTIONS) {
    if (requested.includes(key)) {
      (out as unknown as Record<string, unknown>)[key] = b[key];
    }
  }
  return out;
}

/** Compact `Label 12` pair; null values are dropped from the detail line. */
function pair(label: string, value: number | null | undefined, unit = ""): string | null {
  if (value === null || value === undefined) return null;
  return `${label} ${value}${unit}`;
}

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? MISSING : `${v}%`;
}

function fmtTemp(v: number | null | undefined): string {
  if (v === null || v === undefined) return MISSING;
  return `${v >= 0 ? "+" : ""}${v}°C`;
}

function joinPairs(...pairs: (string | null)[]): string {
  const parts = pairs.filter((p) => p !== null);
  return parts.length > 0 ? parts.join(" · ") : MISSING;
}

/** One row per section — shared by the plain and table formatters. */
function sectionRows(b: TodayBriefing, requested: string[] | null): SectionRow[] {
  const all: SectionRow[] = [];
  const missing = "no data yet";

  all.push({
    label: "Sleep",
    score: b.sleep ? String(b.sleep.score ?? MISSING) : MISSING,
    detail: b.sleep
      ? joinPairs(
          pair("Deep", b.sleep.contributors?.deep_sleep),
          pair("REM", b.sleep.contributors?.rem_sleep),
          pair("Eff", b.sleep.contributors?.efficiency),
        )
      : missing,
  });

  all.push({
    label: "Readiness",
    score: b.readiness ? String(b.readiness.score ?? MISSING) : MISSING,
    detail: b.readiness
      ? joinPairs(
          b.readiness.temperature_deviation !== null &&
            b.readiness.temperature_deviation !== undefined
            ? `TempΔ ${fmtTemp(b.readiness.temperature_deviation)}`
            : null,
          pair("RHR", b.readiness.contributors?.resting_heart_rate),
          pair("HRV", b.readiness.contributors?.hrv_balance),
        )
      : missing,
  });

  all.push({
    label: "Activity",
    score: b.activity ? String(b.activity.score ?? MISSING) : MISSING,
    detail: b.activity
      ? joinPairs(
          pair("Steps", b.activity.steps),
          pair("ActiveCal", b.activity.active_calories),
          pair("ToTarget", b.activity.meters_to_target, "m"),
        )
      : missing,
  });

  all.push({
    label: "Stress",
    score: b.stress?.day_summary ?? MISSING,
    detail: b.stress
      ? joinPairs(
          pair("High", b.stress.stress_high, "m"),
          pair("Recovery", b.stress.recovery_high, "m"),
        )
      : missing,
  });

  all.push({
    label: "SpO2",
    score: b.spo2 ? fmtPct(b.spo2.spo2_percentage?.average) : MISSING,
    detail: b.spo2 ? joinPairs(pair("BDI", b.spo2.breathing_disturbance_index)) : missing,
  });

  all.push({
    label: "Resilience",
    score: b.resilience?.level ?? MISSING,
    detail: b.resilience
      ? joinPairs(
          pair("Sleep", b.resilience.contributors?.sleep_recovery),
          pair("Daytime", b.resilience.contributors?.daytime_recovery),
          pair("Stress", b.resilience.contributors?.stress),
        )
      : missing,
  });

  all.push({
    label: "Battery",
    score: b.battery ? fmtPct(b.battery.level) : MISSING,
    detail: b.battery ? (b.battery.charging ? "charging" : "not charging") : missing,
  });

  // With --sections, show only the requested sections (JSON keeps all keys).
  return requested === null
    ? all
    : all.filter((row) => requested.includes(row.label.toLowerCase()));
}

function missingSections(b: TodayBriefing, requested: string[] | null): string[] {
  return SECTIONS.filter(
    (s) => (requested === null || requested.includes(s)) && (b[s] === null || b[s] === undefined),
  ).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

function syncHint(b: TodayBriefing, requested: string[] | null): string {
  const missing = missingSections(b, requested);
  if (missing.length === 0) return "";
  return `\nNote: no data yet for ${missing.join(", ")} — sync the Oura app and try again.`;
}

function formatBriefing(
  b: TodayBriefing,
  format: "plain" | "table",
  requested: string[] | null,
): string {
  const rows = sectionRows(b, requested);
  const hint = syncHint(b, requested);
  return format === "table"
    ? formatBriefingTable(b, rows, hint)
    : formatBriefingPlain(b, rows, hint);
}

function formatBriefingPlain(b: TodayBriefing, rows: SectionRow[], hint: string): string {
  const width = Math.max(...rows.map((r) => r.label.length));
  const lines = [`Date: ${b.date}`, ""];
  for (const row of rows) {
    lines.push(`  ${row.label.padEnd(width)}  ${row.score.padEnd(9)} (${row.detail})`);
  }
  return lines.join("\n") + hint;
}

function formatBriefingTable(b: TodayBriefing, rows: SectionRow[], hint: string): string {
  const columns: ColumnConfig[] = [
    { key: "day", header: "Day" },
    { key: "section", header: "Section" },
    { key: "score", header: "Score" },
    { key: "detail", header: "Details" },
  ];
  const data = rows.map((row) => ({
    day: b.date,
    section: row.label,
    score: row.score,
    detail: row.detail,
  }));
  return formatTable(data, columns) + hint;
}
