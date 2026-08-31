import { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import type { AuthDeps } from "../commands/auth.js";
import { cmdAuthLogin, cmdAuthLogout, cmdAuthStatus } from "../commands/auth.js";
import { makeDailyCommand } from "../commands/daily.js";
import { registerDoctor } from "../commands/doctor.js";
import { registerHeartrate } from "../commands/heartrate.js";
import { registerProfile } from "../commands/profile.js";
import { registerSleepPeriods } from "../commands/sleep-periods.js";
import { registerToday } from "../commands/today.js";
import { registerWorkouts } from "../commands/workouts.js";
import { VERSION } from "../version.js";

export interface ProgramDeps {
  ctx: CliContext;
  client: OuraClient;
  auth: AuthDeps;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export function buildProgram(deps: ProgramDeps): Command {
  const { ctx, client, auth } = deps;
  const program = new Command();
  program.configureOutput({
    writeOut: (message) => (deps.stdout ?? process.stdout).write(message),
    // Errors are rendered by cli-main into the CLI's structured error format.
    writeErr: () => {},
  });
  program.exitOverride();

  program
    .name("oura")
    .description(
      "Query Oura Ring health data (sleep, readiness, activity, stress, resilience, SpO2, VO2max, heart rate, workouts)",
    )
    .version(VERSION)
    .option("--json", "Machine-readable JSON output")
    .option("--plain", "Human-readable plain text")
    .option("--table", "Tabular output")
    .option("-q, --quiet", "IDs only (for scripting)")
    .option("--no-color", "Disable colors")
    .option("--verbose, --debug", "Verbose progress on stderr")
    .option("--sandbox", "Use Oura sandbox data (no credentials needed)")
    .option("--port <port>", "OAuth callback port", String(9876));

  // ---- auth ----
  const authCmd = program.command("auth").description("Manage OAuth2 credentials");
  authCmd
    .command("login")
    .description("Authorize via OAuth2 loopback flow")
    .option("--use-config", "Store credentials in the config file instead of the keyring")
    .option("--no-browser", "Print the authorize URL and wait (headless/SSH)")
    .option("--manual", "Headless flow: print URL, paste back the redirect URL or code")
    .action(async (opts: { useConfig?: boolean; noBrowser?: boolean; manual?: boolean }) => {
      await cmdAuthLogin(
        { ...auth, argv: process.argv },
        {
          port: program.opts().port,
          useConfig: opts.useConfig,
          noBrowser: opts.noBrowser,
          manual: opts.manual,
        },
      );
    });
  authCmd
    .command("status")
    .description("Show credential status (masked)")
    .action(async () => {
      await cmdAuthStatus(auth);
    });
  authCmd
    .command("logout")
    .description("Revoke and clear stored credentials")
    .action(async () => {
      await cmdAuthLogout(auth);
    });

  // ---- composite + misc ----
  registerToday(program, ctx, client);
  registerProfile(program, ctx, client);
  registerSleepPeriods(program, ctx, client);
  registerDoctor(program, ctx, client, auth);

  // ---- daily summaries ----
  makeDailyCommand(program, ctx, client, {
    name: "sleep",
    description: "Daily sleep score + contributors",
    load: (c, s, e) => c.dailySleepRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailySleep(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "score", header: "Score" },
      { key: "contributors.deep_sleep", header: "Deep" },
      { key: "contributors.rem_sleep", header: "REM" },
      { key: "contributors.efficiency", header: "Eff" },
      { key: "contributors.latency", header: "Lat" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "readiness",
    description: "Daily readiness score + contributors",
    load: (c, s, e) => c.dailyReadinessRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailyReadiness(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "score", header: "Score" },
      { key: "temperature_deviation", header: "TempΔ" },
      { key: "contributors.resting_heart_rate", header: "RHR" },
      { key: "contributors.hrv_balance", header: "HRV" },
      { key: "contributors.sleep_balance", header: "Sleep" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "activity",
    description: "Daily activity: steps, calories, targets",
    load: (c, s, e) => c.dailyActivityRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailyActivity(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "score", header: "Score" },
      { key: "steps", header: "Steps" },
      { key: "active_calories", header: "ActiveCal" },
      { key: "total_calories", header: "TotalCal" },
      { key: "meters_to_target", header: "ToTarget" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "stress",
    description: "Daily stress summary + high-stress/recovery minutes",
    load: (c, s, e) => c.dailyStressRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailyStress(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "day_summary", header: "Summary" },
      { key: "stress_high", header: "StressMin" },
      { key: "recovery_high", header: "RecoveryMin" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "resilience",
    description: "Long-term stress resilience level + contributors",
    load: (c, s, e) => c.dailyResilienceRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailyResilience(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "level", header: "Level" },
      { key: "contributors.sleep_recovery", header: "SleepRec" },
      { key: "contributors.daytime_recovery", header: "DayRec" },
      { key: "contributors.stress", header: "Stress" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "spo2",
    description: "Daily blood oxygen average + breathing disturbance index",
    load: (c, s, e) => c.dailySpO2Range(s, e),
    loadDay: async (c, d) => {
      const doc = await c.dailySpO2(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "spo2_percentage.average", header: "SpO2%" },
      { key: "breathing_disturbance_index", header: "BDI" },
    ],
  });

  makeDailyCommand(program, ctx, client, {
    name: "vo2max",
    description: "Daily VO2 max estimate",
    load: (c, s, e) => c.vo2MaxRange(s, e),
    loadDay: async (c, d) => {
      const doc = await c.vo2Max(d);
      return doc ? [doc] : [];
    },
    pick: (rows) => rows[rows.length - 1] ?? null,
    columns: [
      { key: "day", header: "Day" },
      { key: "vo2_max", header: "VO2max" },
    ],
  });

  // ---- time series & events ----
  registerHeartrate(program, ctx, client);
  registerWorkouts(program, ctx, client);

  return program;
}
