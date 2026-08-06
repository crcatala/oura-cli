import { TOKEN_URL } from "../oauth/flow.js";
import type {
  DailyActivity,
  DailyReadiness,
  DailyResilience,
  DailySleep,
  DailySpO2,
  DailyStress,
  HasDay,
  HeartRateRow,
  OuraApiResponse,
  OuraTokens,
  PersonalInfo,
  RingBatteryRow,
  RingConfiguration,
  SleepPeriod,
  VO2Max,
  Workout,
} from "../types.js";
import { nextDay } from "../utils/date.js";
import { AuthError, OuraApiError } from "../utils/errors.js";
import { collectionBase, ENDPOINTS } from "./endpoints.js";
import { collectPages } from "./pagination.js";
export type Fetcher = typeof fetch;

export interface OuraClientOptions {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Called with the NEW token pair after every refresh (rotation persistence). */
  persistTokens?: (tokens: OuraTokens) => void | Promise<void>;
  baseUrl?: string;
  sandbox?: boolean;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

/**
 * Typed client for the Oura v2 usercollection API.
 *
 * - Refresh-on-401 with single-flight serialization and refresh-token
 *   rotation: Oura refresh tokens are single-use and rotate, so the NEW
 *   refresh token is handed to `persistTokens` before the retry uses the
 *   new access token.
 * - requestDay works around Oura's inconsistent exclusive `end_date`
 *   semantics by querying [date, date+1) and filtering on `day`.
 */
export class OuraClient {
  private accessToken: string;
  private refreshToken: string | undefined;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;
  private readonly persistTokens?: (tokens: OuraTokens) => void | Promise<void>;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly sandbox: boolean;
  private refreshPromise: Promise<void> | null = null;

  constructor(opts: OuraClientOptions) {
    // Sandbox data needs no real credential, but Oura requires the
    // Authorization header to contain *some* string.
    this.accessToken = opts.accessToken || (opts.sandbox ? "sandbox" : "");
    this.refreshToken = opts.refreshToken;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.persistTokens = opts.persistTokens;
    this.sandbox = opts.sandbox ?? false;
    this.baseUrl = opts.baseUrl ?? `${API_BASE}/${collectionBase(this.sandbox)}`;
    this.fetcher = opts.fetcher ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  // ------------------------------------------------------------------------
  // Daily summaries
  // ------------------------------------------------------------------------

  async dailySleep(date: string): Promise<DailySleep | null> {
    return this.requestDay<DailySleep>(ENDPOINTS.dailySleep, date);
  }

  async dailyReadiness(date: string): Promise<DailyReadiness | null> {
    return this.requestDay<DailyReadiness>(ENDPOINTS.dailyReadiness, date);
  }

  async dailyActivity(date: string): Promise<DailyActivity | null> {
    return this.requestDay<DailyActivity>(ENDPOINTS.dailyActivity, date);
  }

  async dailyStress(date: string): Promise<DailyStress | null> {
    return this.requestDay<DailyStress>(ENDPOINTS.dailyStress, date);
  }

  async dailyResilience(date: string): Promise<DailyResilience | null> {
    return this.requestDay<DailyResilience>(ENDPOINTS.dailyResilience, date);
  }

  async dailySpO2(date: string): Promise<DailySpO2 | null> {
    return this.requestDay<DailySpO2>(ENDPOINTS.dailySpO2, date);
  }

  async vo2Max(date: string): Promise<VO2Max | null> {
    return this.requestDay<VO2Max>(ENDPOINTS.vo2Max, date);
  }

  async sleepPeriods(date: string): Promise<SleepPeriod[]> {
    return this.requestDayList<SleepPeriod>(ENDPOINTS.sleep, date);
  }

  // ------------------------------------------------------------------------
  // Ranges (paginated)
  // ------------------------------------------------------------------------

  async dailySleepRange(start: string, end: string): Promise<DailySleep[]> {
    return this.range<DailySleep>(ENDPOINTS.dailySleep, { start_date: start, end_date: end });
  }

  async dailyReadinessRange(start: string, end: string): Promise<DailyReadiness[]> {
    return this.range<DailyReadiness>(ENDPOINTS.dailyReadiness, {
      start_date: start,
      end_date: end,
    });
  }

  async dailyActivityRange(start: string, end: string): Promise<DailyActivity[]> {
    return this.range<DailyActivity>(ENDPOINTS.dailyActivity, { start_date: start, end_date: end });
  }

  async dailyStressRange(start: string, end: string): Promise<DailyStress[]> {
    return this.range<DailyStress>(ENDPOINTS.dailyStress, { start_date: start, end_date: end });
  }

  async dailyResilienceRange(start: string, end: string): Promise<DailyResilience[]> {
    return this.range<DailyResilience>(ENDPOINTS.dailyResilience, {
      start_date: start,
      end_date: end,
    });
  }

  async dailySpO2Range(start: string, end: string): Promise<DailySpO2[]> {
    return this.range<DailySpO2>(ENDPOINTS.dailySpO2, { start_date: start, end_date: end });
  }

  async vo2MaxRange(start: string, end: string): Promise<VO2Max[]> {
    return this.range<VO2Max>(ENDPOINTS.vo2Max, { start_date: start, end_date: end });
  }

  // ------------------------------------------------------------------------
  // Time series
  // ------------------------------------------------------------------------

  async heartRate(start: string, end: string): Promise<HeartRateRow[]> {
    return this.range<HeartRateRow>(ENDPOINTS.heartrate, {
      start_datetime: start,
      end_datetime: end,
    });
  }

  async ringBattery(start: string, end: string): Promise<RingBatteryRow[]> {
    return this.range<RingBatteryRow>(ENDPOINTS.ringBattery, {
      start_date: start,
      end_date: end,
    });
  }

  async ringConfiguration(): Promise<RingConfiguration | null> {
    const rows = await this.range<RingConfiguration>(ENDPOINTS.ringConfiguration, {
      latest: "true",
    });
    return rows[rows.length - 1] ?? null;
  }

  async workouts(start: string, end: string): Promise<Workout[]> {
    return this.range<Workout>(ENDPOINTS.workout, { start_date: start, end_date: end });
  }

  /** Single-day workouts with the [date, +1) exclusive-end workaround. */
  async workoutsDay(date: string): Promise<Workout[]> {
    return this.requestDayList<Workout>(ENDPOINTS.workout, date);
  }

  // ------------------------------------------------------------------------
  // Misc
  // ------------------------------------------------------------------------

  async personalInfo(): Promise<PersonalInfo | null> {
    const rows = await this.range<PersonalInfo>(ENDPOINTS.personalInfo, {});
    return rows[0] ?? null;
  }

  // ------------------------------------------------------------------------
  // Core request machinery
  // ------------------------------------------------------------------------

  /**
   * Fetch one calendar day from a date-indexed collection, working around
   * Oura's exclusive/inconsistent `end_date` semantics: request [date, +1)
   * and filter client-side on `day`. Verified behavior per endpoint in the
   * daveremy/oura-mcp review (sleep/workout/daily_activity return 0 rows
   * when start==end).
   */
  private async requestDay<T extends HasDay>(endpoint: string, date: string): Promise<T | null> {
    const list = await this.requestDayList<T>(endpoint, date);
    return list[0] ?? null;
  }

  private async requestDayList<T extends HasDay>(endpoint: string, date: string): Promise<T[]> {
    const res = await this.request<OuraApiResponse<T>>(endpoint, {
      start_date: date,
      end_date: nextDay(date),
    });
    return (res.data ?? []).filter((row) => row.day === date);
  }

  private async range<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
    return collectPages<T>((nextToken) =>
      this.request<OuraApiResponse<T>>(endpoint, {
        ...params,
        ...(nextToken ? { next_token: nextToken } : {}),
      }),
    );
  }

  private async request<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    if (!this.accessToken && !this.sandbox) {
      throw new AuthError("No credentials configured", "Run: oura auth login");
    }
    const url = new URL(`${this.baseUrl}/${endpoint}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    let res = await this.doFetch(url);

    if (res.status === 401 && this.refreshToken) {
      await this.serializedRefresh();
      res = await this.doFetch(url);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new OuraApiError(res.status, body);
    }

    return (await res.json()) as T;
  }

  private doFetch(url: URL): Promise<Response> {
    if (!this.accessToken && !this.sandbox) {
      throw new AuthError("No credentials configured", "Run: oura auth login");
    }
    return this.fetcher(url.toString(), {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** Single-flight refresh: concurrent 401s share one token exchange. */
  private serializedRefresh(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new AuthError(
        "Access token expired and no refresh credentials configured",
        "Run: oura auth login",
      );
    }

    const res = await this.fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new OuraApiError(res.status, body);
    }

    const tokens = (await res.json()) as OuraTokens;

    // Rotation: persist the NEW refresh token BEFORE the retry uses the new
    // access token, so a crash between now and next refresh can't lose it.
    this.accessToken = tokens.access_token;
    if (tokens.refresh_token) this.refreshToken = tokens.refresh_token;
    if (this.persistTokens) {
      await this.persistTokens(tokens);
    }
  }
}

const API_BASE = "https://api.ouraring.com";
