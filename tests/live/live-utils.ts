import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Opt-in gate: live tests only run with OURA_LIVE_TESTS=1. */
export const liveEnabled = process.env.OURA_LIVE_TESTS === "1";

/** UTC-safe day offset for YYYY-MM-DD. */
export function offsetDay(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Serialize live requests with a minimum delay between them. Oura allows
 * 5000 requests per 5 minutes; the default 250 ms keeps runs fast while
 * staying far below the limit. Tune with OURA_LIVE_DELAY_MS.
 */
export function createRateLimitedFetch(
  fetchImpl: typeof fetch,
  minimumDelayMs: number,
): typeof fetch {
  let nextRequestAt = 0;
  let queue = Promise.resolve();

  return async (...args) => {
    const request = queue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      nextRequestAt = Date.now() + minimumDelayMs;
      return fetchImpl(...args);
    });
    queue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  };
}

const delayMs = Number.parseInt(process.env.OURA_LIVE_DELAY_MS ?? "250", 10);
export const rateLimitedFetch = createRateLimitedFetch(
  globalThis.fetch.bind(globalThis),
  Number.isFinite(delayMs) ? Math.max(100, delayMs) : 250,
);

/**
 * Environment for live runs: env-provided OAuth tokens plus an isolated
 * config dir with the config-file backend forced, so the suite never touches
 * the maintainer's OS keyring or real ~/.config/oura-cli credentials.
 */
export function liveEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    OURA_ACCESS_TOKEN: process.env.OURA_ACCESS_TOKEN,
    OURA_REFRESH_TOKEN: process.env.OURA_REFRESH_TOKEN,
    OURA_CLIENT_ID: process.env.OURA_CLIENT_ID,
    OURA_CLIENT_SECRET: process.env.OURA_CLIENT_SECRET,
    OURA_USE_CONFIG: "1",
    OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-live-")), "config"),
  };
}
