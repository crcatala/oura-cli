import { describe, expect, it, vi } from "vitest";
import { OuraClient } from "../../src/api/client.js";
import type { OuraTokens } from "../../src/types.js";
import { AuthError, OuraApiError } from "../../src/utils/errors.js";

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function makeFetcher(handler: FetchHandler) {
  const calls: Array<{ url: string; headers?: HeadersInit }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, headers: init?.headers });
    return handler(u, init);
  };
  return { fetcher, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

function apiClient(fetcher: typeof fetch, accessToken = "tok", sandbox = false) {
  return new OuraClient({
    accessToken,
    refreshToken: "ref",
    clientId: "cid",
    clientSecret: "cs",
    fetcher,
    sandbox,
  });
}

describe("OuraClient.requestDay", () => {
  it("queries [date, date+1) and filters on day (exclusive-end workaround)", async () => {
    const { fetcher, calls } = makeFetcher((url) => {
      expect(url).toContain("start_date=2026-01-18");
      expect(url).toContain("end_date=2026-01-19");
      return jsonResponse(200, { data: [sleepDoc], next_token: null });
    });

    const client = apiClient(fetcher);
    const result = await client.dailySleep("2026-01-18");
    expect(result?.day).toBe("2026-01-18");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("filters out rows whose day does not match (padding immunity)", async () => {
    const { fetcher } = makeFetcher(() =>
      jsonResponse(200, {
        data: [sleepDoc, { ...sleepDoc, id: "x", day: "2026-01-19" }],
        next_token: null,
      }),
    );
    const result = await apiClient(fetcher).dailySleep("2026-01-18");
    expect(result?.id).toBe("daily_sleep-0-2026-1-18");
  });

  it("returns null when the collection is empty", async () => {
    const { fetcher } = makeFetcher(() => jsonResponse(200, { data: [], next_token: null }));
    expect(await apiClient(fetcher).dailySleep("2026-01-18")).toBeNull();
  });
});

describe("OuraClient sleep periods", () => {
  it("paginates the bounded request and filters records by assigned day", async () => {
    const page1 = {
      data: [
        { id: "sleep-1", day: "2026-01-18" },
        { id: "next-day", day: "2026-01-19" },
      ],
      next_token: "page-2",
    };
    const page2 = { data: [{ id: "sleep-2", day: "2026-01-18" }], next_token: null };
    const { fetcher, calls } = makeFetcher((url) =>
      jsonResponse(200, url.includes("next_token=page-2") ? page2 : page1),
    );

    const rows = await apiClient(fetcher).sleepPeriods("2026-01-18");
    expect(rows).toEqual([page1.data[0], page2.data[0]]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/sleep?");
    expect(calls[0].url).toContain("start_date=2026-01-17");
    expect(calls[0].url).toContain("end_date=2026-01-19");
    expect(calls[1].url).toContain("next_token=page-2");
  });

  it("sleepPeriods keeps only the requested day from the padded window", async () => {
    const wanted = { id: "sleep-d", day: "2026-07-03", type: "long_sleep" };
    const { fetcher, calls } = makeFetcher(() =>
      jsonResponse(200, {
        data: [
          { id: "prev", day: "2026-07-02", type: "long_sleep" },
          wanted,
          { id: "nap", day: "2026-07-03", type: "sleep" },
        ],
        next_token: null,
      }),
    );

    const rows = await apiClient(fetcher).sleepPeriods("2026-07-03");
    expect(rows).toEqual([wanted, { id: "nap", day: "2026-07-03", type: "sleep" }]);
    expect(calls[0].url).toContain("start_date=2026-07-02");
    expect(calls[0].url).toContain("end_date=2026-07-04");
  });

  it("sleepPeriodsRange passes start/end through without a day filter", async () => {
    const inWindow = { id: "sleep-2", day: "2026-07-02", type: "long_sleep" };
    const otherDay = { id: "sleep-3", day: "2026-07-03", type: "sleep" };
    const { fetcher, calls } = makeFetcher(() =>
      jsonResponse(200, { data: [inWindow, otherDay], next_token: null }),
    );

    const rows = await apiClient(fetcher).sleepPeriodsRange("2026-07-02", "2026-07-04");
    expect(rows).toEqual([inWindow, otherDay]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/sleep?");
    expect(calls[0].url).toContain("start_date=2026-07-02");
    expect(calls[0].url).toContain("end_date=2026-07-04");
    expect(calls[0].url).not.toContain("end_date=2026-07-05");
  });
});

describe("OuraClient.range pagination", () => {
  it("loops next_token until exhausted", async () => {
    const page1 = { data: [{ day: "2026-01-01", score: 10 }], next_token: "abc" };
    const page2 = { data: [{ day: "2026-01-02", score: 20 }], next_token: null };
    let n = 0;
    const { fetcher, calls } = makeFetcher((url) => {
      n += 1;
      if (url.includes("next_token=abc")) return jsonResponse(200, page2);
      return jsonResponse(200, page1);
    });

    const rows = await apiClient(fetcher).dailySleepRange("2026-01-01", "2026-01-02");
    expect(rows).toEqual([page1.data[0], page2.data[0]]);
    expect(n).toBe(2);
    expect(calls[1].url).toContain("next_token=abc");
  });
});

describe("OuraClient refresh-on-401", () => {
  const refreshedTokens: OuraTokens = {
    token_type: "bearer",
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 86400,
  };

  it("refreshes once, persists the NEW refresh token, and retries with the new access token", async () => {
    let apiHits = 0;
    let tokenHits = 0;
    const persisted: OuraTokens[] = [];

    const { fetcher, calls } = makeFetcher(async (url, init) => {
      if (url.endsWith("/oauth/v2/ext/oauth-token")) {
        tokenHits += 1;
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return jsonResponse(200, refreshedTokens);
      }
      apiHits += 1;
      return apiHits === 1
        ? jsonResponse(401, { detail: "expired" })
        : jsonResponse(200, { data: [sleepDoc], next_token: null });
    });

    const persistTokens = vi.fn(async (t: OuraTokens) => {
      persisted.push(t);
    });
    const client = new OuraClient({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      clientId: "cid",
      clientSecret: "cs",
      fetcher,
      persistTokens,
    });

    const result = await client.dailySleep("2026-01-18");
    expect(result?.score).toBe(80);
    expect(tokenHits).toBe(1);
    expect(apiHits).toBe(2);
    // Calls: [api (401), token POST, api retry]. Retry used the NEW access token.
    expect(calls[2].headers).toEqual({ Authorization: "Bearer new-access" });
    // Rotation persisted BEFORE the retry consumed it.
    expect(persisted).toEqual([refreshedTokens]);
    expect(persistTokens).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent refreshes (single flight)", async () => {
    let tokenHits = 0;
    let apiHits = 0;
    const { fetcher } = makeFetcher(async (url) => {
      if (url.endsWith("/oauth/v2/ext/oauth-token")) {
        tokenHits += 1;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse(200, refreshedTokens);
      }
      apiHits += 1;
      // First burst 401s; after refresh, succeed.
      return apiHits > 2
        ? jsonResponse(200, { data: [sleepDoc], next_token: null })
        : jsonResponse(401, { detail: "expired" });
    });

    const client = new OuraClient({
      accessToken: "a",
      refreshToken: "r",
      clientId: "cid",
      clientSecret: "cs",
      fetcher,
    });

    const [sleep, readiness] = await Promise.all([
      client.dailySleep("2026-01-18"),
      client.dailyReadiness("2026-01-18"),
    ]);
    expect(sleep).not.toBeNull();
    expect(readiness).not.toBeNull();
    expect(tokenHits).toBe(1);
  });

  it("does NOT refresh when no refresh token is configured", async () => {
    let tokenHits = 0;
    const { fetcher } = makeFetcher((url) => {
      if (url.endsWith("/oauth/v2/ext/oauth-token")) {
        tokenHits += 1;
        return jsonResponse(200, refreshedTokens);
      }
      return jsonResponse(401, { detail: "expired" });
    });

    const client = new OuraClient({ accessToken: "a", fetcher });
    await expect(client.dailySleep("2026-01-18")).rejects.toBeInstanceOf(OuraApiError);
    expect(tokenHits).toBe(0);
  });
});

describe("OuraClient misc", () => {
  it("routes sandbox requests to the sandbox collection", async () => {
    const { fetcher, calls } = makeFetcher(() =>
      jsonResponse(200, { data: [sleepDoc], next_token: null }),
    );
    const client = new OuraClient({ accessToken: "", sandbox: true, fetcher });
    await client.dailySleep("2026-01-18");
    expect(calls[0].url).toContain("/v2/sandbox/usercollection/daily_sleep");
  });

  it("throws AuthError when no credentials and not sandbox", async () => {
    const { fetcher } = makeFetcher(() => jsonResponse(200, { data: [], next_token: null }));
    const client = new OuraClient({ accessToken: "", fetcher });
    await expect(client.dailySleep("2026-01-18")).rejects.toBeInstanceOf(AuthError);
  });

  it("surfaces non-OK responses as OuraApiError with status", async () => {
    const { fetcher } = makeFetcher(() =>
      jsonResponse(422, { detail: [{ msg: "bad date param" }] }),
    );
    const client = apiClient(fetcher);
    await expect(client.dailySleep("bogus")).rejects.toMatchObject({ status: 422 });
    await expect(client.dailySleep("bogus")).rejects.toThrow(/bad date param/);
  });
});

describe("OuraClient time series & workouts", () => {
  const hrRow = {
    timestamp: "2026-01-18T00:10:00.000Z",
    timestamp_unix: 0,
    bpm: 60,
    source: "awake",
  };
  const workoutDoc = {
    id: "workout-0-2026-1-18",
    day: "2026-01-18",
    activity: "running",
    calories: 100,
    distance: 10,
    intensity: "hard",
    source: "workout_heart_rate",
    start_datetime: "2026-01-18T00:00:00.000+00:00",
    end_datetime: "2026-01-18T00:30:00.000+00:00",
  };

  it("heartRate sends start_datetime/end_datetime and paginates multi-page ranges", async () => {
    const page1 = { data: [hrRow], next_token: "tok1" };
    const page2 = {
      data: [{ ...hrRow, timestamp: "2026-01-18T01:00:00.000Z" }],
      next_token: null,
    };
    let n = 0;
    const { fetcher, calls } = makeFetcher((url) => {
      n += 1;
      if (url.includes("next_token=tok1")) return jsonResponse(200, page2);
      return jsonResponse(200, page1);
    });

    const rows = await apiClient(fetcher).heartRate("2026-01-18T00:00", "2026-01-19T00:00");
    expect(rows).toHaveLength(2);
    expect(n).toBe(2);
    expect(calls[0].url).toContain("start_datetime=2026-01-18T00%3A00");
    expect(calls[0].url).toContain("end_datetime=2026-01-19T00%3A00");
    expect(calls[1].url).toContain("next_token=tok1");
  });

  it("workouts sends start_date/end_date for a range", async () => {
    const { fetcher, calls } = makeFetcher(() =>
      jsonResponse(200, { data: [workoutDoc], next_token: null }),
    );
    const rows = await apiClient(fetcher).workouts("2026-01-01", "2026-02-01");
    expect(rows).toEqual([workoutDoc]);
    expect(calls[0].url).toContain("start_date=2026-01-01");
    expect(calls[0].url).toContain("end_date=2026-02-01");
  });

  it("workoutsDay uses the [date, +1) exclusive-end workaround and filters on day", async () => {
    const { fetcher, calls } = makeFetcher((url) => {
      expect(url).toContain("start_date=2026-01-18");
      expect(url).toContain("end_date=2026-01-19");
      return jsonResponse(200, {
        data: [workoutDoc, { ...workoutDoc, id: "x", day: "2026-01-19" }],
        next_token: null,
      });
    });
    const rows = await apiClient(fetcher).workoutsDay("2026-01-18");
    expect(rows).toEqual([workoutDoc]);
    expect(calls).toHaveLength(1);
  });
});
