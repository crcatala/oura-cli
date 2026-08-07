import { describe, expect, it } from "vitest";
import { main } from "../../src/cli-main.js";
import { today } from "../../src/utils/date.js";
import { liveEnabled, liveEnv, offsetDay, rateLimitedFetch } from "./live-utils.js";

// ────────────────────────────────────────────────────────────────────────────
// Live tests hit the REAL Oura API using env-provided OAuth tokens. They are
// deliberately READ-ONLY: only GET commands run here, nothing mutates or
// destroys account data (no auth login/logout, no revoke, no writes).
// Opt-in via OURA_LIVE_TESTS=1 and gated by scripts/require-live-test-env.mjs.
// Requests are serialized and rate-limited (see live-utils.ts).
// ────────────────────────────────────────────────────────────────────────────

type Capture = {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  out(): string;
  err(): string;
};

function capture(): Capture {
  let out = "";
  let err = "";
  return {
    stdout: {
      write: (s: string) => {
        out += s;
      },
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (s: string) => {
        err += s;
      },
    } as unknown as NodeJS.WritableStream,
    out: () => out,
    err: () => err,
  };
}

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const cap = capture();
  const code = await main(argv, liveEnv(), {
    fetcher: rateLimitedFetch,
    stdout: cap.stdout,
    stderr: cap.stderr,
  });
  return { code, out: cap.out(), err: cap.err() };
}

/** Days ago as a local YYYY-MM-DD (matches the CLI's day semantics). */
function daysAgo(n: number): string {
  return offsetDay(today(), -n);
}

describe.skipIf(!liveEnabled)("live API (read-only)", () => {
  it("auth status reports env-configured credentials", async () => {
    const { code, out } = await run(["--json", "auth", "status"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.configured).toBe(true);
    expect(parsed.source).toBe("env");
  }, 30_000);

  it("profile returns personal info", async () => {
    const { code, out } = await run(["--json", "profile"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(typeof parsed.age).toBe("number");
    expect(typeof parsed.email).toBe("string");
  }, 30_000);

  it("today aggregates the daily briefing for a recent day", async () => {
    const date = daysAgo(1);
    const { code, out } = await run(["--json", "today", "--date", date]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.date).toBe(date);
    // Sections can be absent when the ring hasn't synced — assert shape only when present.
    for (const section of ["sleep", "readiness", "activity"]) {
      if (parsed[section] != null) {
        expect(parsed[section]).toHaveProperty("score");
      }
    }
  }, 60_000);

  const dailyEndpoints = [
    "sleep",
    "readiness",
    "activity",
    "stress",
    "spo2",
    "resilience",
    "vo2max",
  ];

  for (const endpoint of dailyEndpoints) {
    it(`${endpoint} --days 7 returns daily documents`, async () => {
      const { code, out } = await run(["--json", endpoint, "--days", "7"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      expect(Array.isArray(parsed)).toBe(true);
      for (const doc of parsed) {
        expect(typeof doc.day).toBe("string");
      }
    }, 60_000);
  }

  it("heartrate aggregates a recent 48h window", async () => {
    const { code, out } = await run([
      "--json",
      "heartrate",
      "--start",
      daysAgo(1),
      "--end",
      today(),
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    for (const hour of parsed) {
      expect(typeof hour.hour).toBe("string");
      for (const key of ["avg", "min", "max", "count"]) {
        expect(hour).toHaveProperty(key);
      }
    }
  }, 60_000);

  it("workouts --days 30 returns workout sessions", async () => {
    const { code, out } = await run(["--json", "workouts", "--days", "30"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    for (const workout of parsed) {
      expect(typeof workout.activity).toBe("string");
    }
  }, 60_000);

  it("doctor reports no errors against the live API", async () => {
    const { code, out } = await run(["--json", "doctor"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.summary.errors).toBe(0);
    const reachability = parsed.checks.find((c: { name: string }) => c.name === "api reachability");
    expect(reachability?.status).toBe("ok");
  }, 60_000);
});
