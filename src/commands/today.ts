import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import { output } from "../output/index.js";
import { resolveDate } from "../utils/date.js";

/**
 * `oura today` — morning briefing: readiness, sleep, activity, stress,
 * SpO2, resilience + ring battery for one day. Missing documents (e.g.
 * sleep before app sync) become null instead of errors.
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

      const battery = batteryRows[batteryRows.length - 1] ?? null;

      output(ctx, {
        date: day,
        sleep,
        readiness,
        activity,
        stress,
        spo2,
        resilience,
        battery,
      });
    });
}
