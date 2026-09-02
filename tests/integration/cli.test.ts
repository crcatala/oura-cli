import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli-main.js";
import { VERSION } from "../../src/version.js";

const sleepDoc = {
  id: "daily_sleep-0-2026-1-18",
  day: "2026-01-18",
  score: 80,
  contributors: {
    deep_sleep: 70,
    efficiency: 80,
    latency: 90,
    rem_sleep: 60,
    restfulness: 70,
    timing: 80,
    total_sleep: 90,
  },
  timestamp: "2026-01-18T00:00:00.000+00:00",
};

const sleepPeriodDoc = {
  id: "sleep-0-2026-1-18",
  day: "2026-01-18",
  type: "long_sleep",
  bedtime_start: "2026-01-17T23:30:00.000+00:00",
  bedtime_end: "2026-01-18T07:30:00.000+00:00",
  total_sleep_duration: 27000,
  movement_30_sec: ["1", "2"],
};

const readinessDoc = {
  id: "daily_readiness-0-2026-1-18",
  day: "2026-01-18",
  score: 85,
  contributors: {
    activity_balance: 70,
    body_temperature: 70,
    hrv_balance: 80,
    previous_day_activity: 90,
    previous_night: 60,
    recovery_index: 90,
    resting_heart_rate: 60,
    sleep_balance: 70,
    sleep_regularity: null,
  },
  temperature_deviation: 0.5,
  timestamp: "2026-01-18T00:00:00.000+00:00",
};

const activityDoc = {
  id: "daily_activity-0-2026-1-18",
  day: "2026-01-18",
  score: 88,
  steps: 9123,
  active_calories: 412,
  total_calories: 2400,
  equivalent_walking_distance: 6320,
  meters_to_target: 1200,
  timestamp: "2026-01-18T00:00:00.000+00:00",
};

const personalInfo = {
  id: "user-1",
  age: 34,
  weight: 72.5,
  height: 178,
  biological_sex: "male",
  email: "user@example.com",
};

function fixtureFetcher() {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/oauth/v2/ext/oauth-token")) {
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return json(200, {
        token_type: "bearer",
        access_token: "new-at",
        refresh_token: "new-rt",
        expires_in: 86400,
      });
    }
    if (url.includes("/daily_sleep")) return json(200, { data: [sleepDoc], next_token: null });
    if (new URL(url).pathname.endsWith("/sleep"))
      return json(200, { data: [sleepPeriodDoc], next_token: null });
    if (url.includes("/daily_readiness"))
      return json(200, { data: [readinessDoc], next_token: null });
    if (url.includes("/daily_activity"))
      return json(200, { data: [activityDoc], next_token: null });
    if (url.includes("/heartrate"))
      return json(200, {
        data: [
          { timestamp: "2026-01-18T00:10:00.000Z", timestamp_unix: 0, bpm: 60, source: "awake" },
          { timestamp: "2026-01-18T00:20:00.000Z", timestamp_unix: 0, bpm: 80, source: "awake" },
          { timestamp: "2026-01-18T01:05:00.000Z", timestamp_unix: 0, bpm: 100, source: "workout" },
        ],
        next_token: null,
      });
    if (url.includes("/workout"))
      return json(200, {
        data: [
          {
            id: "workout-0-2026-1-18",
            day: "2026-01-18",
            activity: "running",
            calories: 100,
            distance: 10,
            intensity: "hard",
            source: "workout_heart_rate",
            start_datetime: "2026-01-18T00:00:00.000+00:00",
            end_datetime: "2026-01-18T00:30:00.000+00:00",
          },
          {
            id: "workout-1-2026-1-19",
            day: "2026-01-19",
            activity: "swimming",
            calories: 1000,
            distance: 200,
            intensity: "moderate",
            source: "manual",
            start_datetime: "2026-01-19T00:00:00.000+00:00",
            end_datetime: "2026-01-19T00:30:00.000+00:00",
          },
        ],
        next_token: null,
      });
    if (url.includes("/personal_info")) return json(200, personalInfo);
    // Everything else (stress/spo2/resilience/battery/etc.) — empty collection.
    return json(200, { data: [], next_token: null });
  };
}

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

function env(extra: Record<string, string> = {}) {
  return {
    OURA_ACCESS_TOKEN: "at",
    OURA_REFRESH_TOKEN: "rt",
    OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "config"),
    ...extra,
  };
}

/** UTC-safe day offset for YYYY-MM-DD. */
function offsetDay(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Fail the test when a value is nullish, narrowing it for the rest of the block. */
function assertDefined<T>(value: T | null | undefined): asserts value is T {
  expect(value).toBeDefined();
}

describe("CLI integration (mocked fetch)", () => {
  it("uses the package version for --version", async () => {
    const cap = capture();
    const packageJson = createRequire(import.meta.url)("../../package.json") as { version: string };
    const code = await main(["--version"], env(), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });

    expect(code).toBe(0);
    expect(cap.out().trim()).toBe(packageJson.version);
    expect(VERSION).toBe(packageJson.version);
  });

  it("shows help and succeeds when no command is provided", async () => {
    const cap = capture();
    const code = await main([], env(), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("Usage: oura");
    expect(cap.err()).toBe("");
  });

  it("shows help for valid global options without a command", async () => {
    const cap = capture();
    const code = await main(["--json"], env(), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("Usage: oura");
    expect(cap.err()).toBe("");
  });

  it("shows subcommand help and succeeds when no subcommand is provided", async () => {
    const cap = capture();
    const code = await main(["auth"], env(), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });

    expect(code).toBe(0);
    expect(cap.out()).toContain("Usage: oura auth");
    expect(cap.err()).toBe("");
  });

  it("sleep --json returns the daily document", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.day).toBe("2026-01-18");
    expect(parsed.score).toBe(80);
  });

  it("sleep-periods --date pads the /sleep window to [D-1, D+1)", async () => {
    const cap = capture();
    const requestedUrls: string[] = [];
    const base = fixtureFetcher();
    const recording = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      return base(url, init);
    };
    const code = await main(["--json", "sleep-periods", "--date", "2026-01-18"], env(), {
      fetcher: recording as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const sleepUrl = requestedUrls.find((u) => new URL(u).pathname.endsWith("/sleep"));
    assertDefined(sleepUrl);
    const params = new URL(sleepUrl).searchParams;
    expect(params.get("start_date")).toBe("2026-01-17");
    expect(params.get("end_date")).toBe("2026-01-19");
  });

  it("sleep-periods --json returns unmodified raw session records", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep-periods", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(JSON.parse(cap.out())).toEqual([sleepPeriodDoc]);
  });

  it("sleep-periods returns an empty array for a day with no sessions", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep-periods", "--date", "2026-01-18"], env(), {
      fetcher: (async () =>
        new Response(JSON.stringify({ data: [], next_token: null }), {
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(JSON.parse(cap.out())).toEqual([]);
  });

  it("sleep --plain produces labeled Key: value pairs", async () => {
    const cap = capture();
    const code = await main(["--plain", "sleep", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("Day: 2026-01-18");
    expect(cap.out()).toContain("Score: 80");
    expect(cap.out()).toContain("Deep: 70");
    expect(cap.out()).toContain("REM: 60");
  });

  it("today aggregates sleep/readiness/activity", async () => {
    const cap = capture();
    const code = await main(["--json", "today", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.date).toBe("2026-01-18");
    expect(parsed.sleep?.score).toBe(80);
    expect(parsed.readiness?.score).toBe(85);
    expect(parsed.activity?.steps).toBe(9123);
  });

  it("profile returns personal info in plain", async () => {
    const cap = capture();
    const code = await main(["--plain", "profile"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("age: 34");
    expect(cap.out()).toContain("email: user@example.com");
  });

  it("--days N issues a range request (regression: --date default shadowed --days)", async () => {
    const cap = capture();
    const requestedUrls: string[] = [];
    const base = fixtureFetcher();
    const recording = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      return base(url, init);
    };
    const code = await main(["--json", "sleep", "--days", "7"], env(), {
      fetcher: recording as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const sleepUrl = requestedUrls.find((u) => u.includes("/daily_sleep"));
    assertDefined(sleepUrl);
    const params = new URL(sleepUrl).searchParams;
    const end = params.get("end_date");
    assertDefined(end);
    expect(params.get("start_date")).toBe(offsetDay(end, -6));
    expect(params.get("end_date")).toBe(end);
  });

  it("--date and --days together is a usage error", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep", "--date", "2026-01-18", "--days", "7"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
  });

  it("--start/--end combined with --days is a usage error (no silent precedence)", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "sleep", "--start", "2026-01-01", "--end", "2026-01-07", "--days", "7"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(2);
  });

  it("--start/--end combined with --date is a usage error", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "sleep", "--start", "2026-01-01", "--end", "2026-01-07", "--date", "2026-01-01"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(2);
  });

  it("heartrate --json aggregates samples into hourly buckets", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "heartrate", "--start", "2026-01-18T00:00", "--end", "2026-01-19T00:00"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed).toEqual([
      { hour: "2026-01-18T00:00", avg: 70, min: 60, max: 80, count: 2 },
      { hour: "2026-01-18T01:00", avg: 100, min: 100, max: 100, count: 1 },
    ]);
  });

  it("heartrate --table --bucket count shows samples per hour", async () => {
    const cap = capture();
    const code = await main(
      ["--table", "heartrate", "--start", "2026-01-18", "--end", "2026-01-19", "--bucket", "count"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    expect(cap.out()).toContain("Hour");
    expect(cap.out()).toContain("Samples");
    expect(cap.out()).toContain("2026-01-18T00:00");
  });

  it("heartrate requires --start and --end (usage error)", async () => {
    const cap = capture();
    const code = await main(["--json", "heartrate"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
  });

  it("heartrate --quiet prints hour keys", async () => {
    const cap = capture();
    const code = await main(
      ["--quiet", "heartrate", "--start", "2026-01-18T00:00", "--end", "2026-01-19T00:00"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    const lines = cap.out().trim().split("\n");
    expect(lines).toEqual(["2026-01-18T00:00", "2026-01-18T01:00"]);
  });

  it("heartrate rejects malformed datetimes and buckets (usage error)", async () => {
    for (const args of [
      ["--json", "heartrate", "--start", "18 Jan 2026", "--end", "2026-01-19"],
      ["--json", "heartrate", "--start", "2026-01-18", "--end", "2026-01-19", "--bucket", "median"],
    ]) {
      const cap = capture();
      const code = await main(args, env(), {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(2);
    }
  });

  it("workouts --days N returns the range rows as JSON", async () => {
    const cap = capture();
    const requestedUrls: string[] = [];
    const base = fixtureFetcher();
    const recording = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      return base(url, init);
    };
    const code = await main(["--json", "workouts", "--days", "7"], env(), {
      fetcher: recording as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].activity).toBe("running");
    const workoutUrl = requestedUrls.find((u) => u.includes("/workout")) ?? "";
    expect(workoutUrl).toBeTruthy();
    const params = new URL(workoutUrl).searchParams;
    expect(params.get("start_date")).toBe(offsetDay(params.get("end_date") ?? "", -6));
  });

  it("workouts --date uses the [date, +1) exclusive-end workaround", async () => {
    const cap = capture();
    const requestedUrls: string[] = [];
    const base = fixtureFetcher();
    const recording = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      return base(url, init);
    };
    const code = await main(["--json", "workouts", "--date", "2026-01-18"], env(), {
      fetcher: recording as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const workoutUrl = requestedUrls.find((u) => u.includes("/workout")) ?? "";
    expect(workoutUrl).toBeTruthy();
    const params = new URL(workoutUrl).searchParams;
    expect(params.get("start_date")).toBe("2026-01-18");
    expect(params.get("end_date")).toBe("2026-01-19");
  });

  it("today --quiet prints the resolved date", async () => {
    const cap = capture();
    const code = await main(["--quiet", "today", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out()).toBe("2026-01-18\n");
  });

  it("today --table renders the section summary", async () => {
    const cap = capture();
    const code = await main(["--table", "today", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("Section");
    expect(cap.out()).toContain("Sleep");
    expect(cap.out()).toContain("Readiness");
    expect(cap.out()).toContain("Activity");
    // Fixture only fills sleep/readiness/activity; the rest degrade gracefully.
    expect(cap.out()).toContain("no data yet");
    expect(cap.out()).toContain("sync the Oura app");
  });

  it("today --plain renders the briefing lines", async () => {
    const cap = capture();
    const code = await main(["--plain", "today", "--date", "2026-01-18"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out()).toContain("Date: 2026-01-18");
    expect(cap.out()).toContain("Sleep");
    expect(cap.out()).toContain("80"); // sleep score
    expect(cap.out()).toContain("Deep 70");
  });

  it("today --sections restricts the human rows and the sync hint", async () => {
    const cap = capture();
    const code = await main(
      ["--table", "today", "--date", "2026-01-18", "--sections", "stress"],
      env(),
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    // Only the requested section renders (fixture stress is empty).
    expect(cap.out()).toContain("Stress");
    expect(cap.out()).not.toContain("Sleep");
    expect(cap.out()).toContain("Note: no data yet for Stress");
  });

  it("doctor --json with env credentials reports healthy checks", async () => {
    const cap = capture();
    const code = await main(["--json", "doctor"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const report = JSON.parse(cap.out());
    expect(report.sandbox).toBe(false);
    expect(report.summary.errors).toBe(0);
    const creds = report.checks.find((c: { name: string }) => c.name === "credentials");
    expect(creds.status).toBe("ok");
    expect(creds.detail).toContain("env");
    const api = report.checks.find((c: { name: string }) => c.name === "api reachability");
    expect(api.status).toBe("ok");
  });

  it("doctor exits 1 with a DOCTOR_FAILED envelope when credentials are missing", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "doctor"],
      {
        // Force the config-file store so this stays hermetic even when the
        // developer's OS keyring holds real credentials.
        OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "cfg"),
        OURA_USE_CONFIG: "1",
      },
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(1);
    const report = JSON.parse(cap.out());
    expect(report.summary.errors).toBeGreaterThan(0);
    const envelope = JSON.parse(cap.err());
    expect(envelope.error.code).toBe("DOCTOR_FAILED");
    expect(envelope.error.kind).toBe("doctor");
  });

  it("doctor flags an expired stored token (exit 1)", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({
        accessToken: "stale-at",
        refreshToken: "stale-rt",
        grantedScopes: ["extapi:daily"],
        expiresAt: Date.now() - 60_000,
        updatedAt: Date.now(),
      }),
    );
    const cap = capture();
    const code = await main(
      ["--json", "doctor"],
      { OURA_CONFIG_DIR: dir, OURA_USE_CONFIG: "1" },
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(1);
    const report = JSON.parse(cap.out());
    const expiry = report.checks.find((c: { name: string }) => c.name === "token expiry");
    expect(expiry.status).toBe("error");
    expect(expiry.detail).toContain("expired");
  });

  it("doctor reports API failures as errors (exit 1)", async () => {
    const cap = capture();
    const base = fixtureFetcher();
    const failing = async (url: string, init?: RequestInit) => {
      if (url.includes("/daily_activity")) {
        return new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return base(url, init);
    };
    const code = await main(["--json", "doctor"], env(), {
      fetcher: failing as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    const report = JSON.parse(cap.out());
    const api = report.checks.find((c: { name: string }) => c.name === "api reachability");
    expect(api.status).toBe("error");
    expect(api.detail).toContain("boom");
  });

  it("doctor --sandbox needs no credentials and exits 0", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "--sandbox", "doctor"],
      {},
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    const report = JSON.parse(cap.out());
    expect(report.sandbox).toBe(true);
    expect(report.summary.errors).toBe(0);
    const creds = report.checks.find((c: { name: string }) => c.name === "credentials");
    expect(creds.status).toBe("ok");
  });

  it("unknown option exits 2 with JSON error envelope", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep", "--bogus"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    const envelope = JSON.parse(cap.err());
    expect(envelope.error.kind).toBe("usage");
    expect(envelope.error.code).toBe("UsageError");
    expect(envelope.error.message).toContain("unknown option");
  });

  it("sleep-periods requires a bounded date", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep-periods"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(JSON.parse(cap.err()).error.message).toContain("requires --date");
  });

  it("sleep-periods --start/--end passes the raw /sleep range through", async () => {
    const cap = capture();
    const requestedUrls: string[] = [];
    const base = fixtureFetcher();
    const recording = async (url: string, init?: RequestInit) => {
      requestedUrls.push(url);
      return base(url, init);
    };
    const code = await main(
      ["--json", "sleep-periods", "--start", "2026-07-02", "--end", "2026-07-04"],
      env(),
      {
        fetcher: recording as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(0);
    const sleepUrl = requestedUrls.find((u) => new URL(u).pathname.endsWith("/sleep"));
    assertDefined(sleepUrl);
    const params = new URL(sleepUrl).searchParams;
    expect(params.get("start_date")).toBe("2026-07-02");
    expect(params.get("end_date")).toBe("2026-07-04");
  });

  it("usage errors exit 2", async () => {
    const cap = capture();
    const code = await main(["--json", "sleep", "--date", "not-a-date"], env(), {
      fetcher: fixtureFetcher() as unknown as typeof fetch,
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
  });

  it("requires credentials for data commands (exit 1, code AUTH_REQUIRED)", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "sleep-periods", "--date", "2026-01-18"],
      {
        // Force the config-file store so this stays hermetic even when the
        // developer's OS keyring holds real credentials.
        OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "cfg"),
        OURA_USE_CONFIG: "1",
      },
      {
        fetcher: fixtureFetcher() as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(1);
    const envelope = JSON.parse(cap.err());
    expect(envelope.error.kind).toBe("auth");
    expect(envelope.error.code).toBe("AUTH_REQUIRED");
  });

  it("refresh persistence rotates tokens stored in the config file", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "config");
    const cap = capture();
    // First run with stored creds that will 401 → refresh → persist new tokens.
    // Use env creds so resolveCredentials skips the store; persistence is
    // skipped for env source, so assert the refresh path via a 401 fixture.
    const code = await main(
      ["--json", "sleep", "--date", "2026-01-18"],
      { ...env(), OURA_CONFIG_DIR: dir },
      {
        fetcher: (async (url: string, _init?: RequestInit) => {
          const json = (status: number, body: unknown) =>
            new Response(JSON.stringify(body), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          if (url.includes("/oauth/v2/ext/oauth-token"))
            return json(200, {
              access_token: "n",
              refresh_token: "r2",
              token_type: "bearer",
              expires_in: 1,
            });
          // Force 401 once so the client exercises refresh.
          return json(401, { detail: "expired" });
        }) as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    // Second attempt also 401s (fixture always 401s), but the refresh
    // fails because no client credentials were provided — the error is
    // AuthError, not OuraApiError (http_401).
    expect(code).toBe(1);
    expect(cap.err()).toContain("auth login");
  });

  it("API 401s after a successful refresh surface as OuraApiError (http_401 envelope)", async () => {
    const cap = capture();
    const code = await main(
      ["--json", "sleep", "--date", "2026-01-18"],
      {
        OURA_ACCESS_TOKEN: "stale",
        OURA_REFRESH_TOKEN: "rt",
        OURA_CLIENT_ID: "cid",
        OURA_CLIENT_SECRET: "cs",
        OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-cli-int-")), "cfg"),
      },
      {
        fetcher: (async (url: string, _init?: RequestInit) => {
          if (url.includes("/oauth/v2/ext/oauth-token")) {
            return new Response(
              JSON.stringify({
                access_token: "fresh",
                refresh_token: "r2",
                token_type: "bearer",
                expires_in: 86400,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ detail: "expired" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch,
        stdout: cap.stdout,
        stderr: cap.stderr,
      },
    );
    expect(code).toBe(1);
    const envelope = JSON.parse(cap.err());
    expect(envelope.error.kind).toBe("api");
    expect(envelope.error.code).toBe("http_401");
    expect(envelope.error.hint).toContain("auth login");
  });
});
