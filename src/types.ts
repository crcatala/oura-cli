/**
 * Oura API v2 response types, curated from the pinned OpenAPI spec
 * (https://cloud.ouraring.com/v2/static/json/openapi-1.37.json).
 * See docs/research/oura-api-cli-spike.md for the field audit.
 */

export type ISODate = string; // YYYY-MM-DD
export type DateTime = string; // ISO 8601 with timezone offset

/** Wrapper returned by collection endpoints. */
export interface OuraApiResponse<T> {
  data: T[];
  next_token?: string;
}

/** Generic row marker for day-filtered requests. */
export interface HasDay {
  day?: string;
}

export interface SleepContributors {
  deep_sleep: number | null;
  efficiency: number | null;
  latency: number | null;
  rem_sleep: number | null;
  restfulness: number | null;
  timing: number | null;
  total_sleep: number | null;
}

export interface DailySleep extends HasDay {
  id: string;
  day: ISODate;
  score: number | null;
  contributors: SleepContributors;
  timestamp: DateTime;
}

export interface ReadinessContributors {
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
  sleep_regularity: number | null;
}

export interface DailyReadiness extends HasDay {
  id: string;
  day: ISODate;
  score: number | null;
  contributors: ReadinessContributors;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  timestamp: DateTime;
}

export interface ActivityContributors {
  meet_daily_targets: number | null;
  move_every_hour: number | null;
  recovery_time: number | null;
  stay_active: number | null;
  training_frequency: number | null;
  training_volume: number | null;
}

export interface DailyActivity extends HasDay {
  id: string;
  day: ISODate;
  score: number | null;
  steps: number;
  active_calories: number;
  total_calories: number;
  equivalent_walking_distance: number;
  meters_to_target: number | null;
  target_calories: number | null;
  high_activity_time: number;
  medium_activity_time: number;
  low_activity_time: number;
  sedentary_time: number;
  resting_time: number;
  contributors: ActivityContributors;
  timestamp: DateTime;
}

export type DailyStressSummary = "restored" | "normal" | "stressful" | string | null;

export interface DailyStress extends HasDay {
  id: string;
  day: ISODate;
  day_summary: DailyStressSummary;
  stress_high: number | null;
  recovery_high: number | null;
}

export type LongTermResilienceLevel =
  | "limited"
  | "adequate"
  | "solid"
  | "strong"
  | "excellent"
  | string;

export interface DailyResilience extends HasDay {
  id: string;
  day: ISODate;
  level: LongTermResilienceLevel;
  contributors: {
    sleep_recovery: number | null;
    daytime_recovery: number | null;
    stress: number | null;
  };
}

export interface DailySpO2 extends HasDay {
  id: string;
  day: ISODate;
  spo2_percentage: { average: number | null };
  breathing_disturbance_index: number | null;
}

export interface VO2Max extends HasDay {
  id: string;
  day: ISODate;
  vo2_max: number | null;
  timestamp: DateTime;
}

export interface SleepPeriod extends HasDay {
  /** Additional upstream fields are retained in raw sleep-session output. */
  [key: string]: unknown;
  id: string;
  day: ISODate;
  type: string;
  bedtime_start: DateTime;
  bedtime_end: DateTime;
  deep_sleep_duration: number;
  light_sleep_duration: number;
  rem_sleep_duration: number;
  average_heart_rate: number | null;
  average_hrv: number | null;
  lowest_heart_rate: number | null;
  efficiency: number | null;
  latency: number | null;
  awake_time: number | null;
  total_sleep_duration: number | null;
}

export interface HeartRateRow {
  timestamp: DateTime;
  timestamp_unix: number;
  bpm: number;
  source: string;
}

export interface RingBatteryRow {
  timestamp: DateTime;
  timestamp_unix: number;
  charging: boolean;
  in_charger: boolean;
  level: number;
}

export interface RingConfiguration {
  id: string;
  color: string | null;
  design: string | null;
  firmware_version: string | null;
  hardware_type: string | null;
  size: number | null;
  set_up_at: DateTime;
}

export interface Workout extends HasDay {
  id: string;
  day: ISODate;
  activity: string;
  calories: number | null;
  distance: number | null;
  intensity: string;
  label: string | null;
  source: string | null;
  start_datetime: DateTime;
  end_datetime: DateTime;
}

export interface PersonalInfo {
  id: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  biological_sex: string | null;
  email: string | null;
}

/** OAuth token payload from POST /oauth/token. */
export interface OuraTokens {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Persisted OAuth credential bundle. */
export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  /** Scopes actually granted by the user (may be a subset of requested). */
  grantedScopes?: string[];
  /** Epoch ms when the access token expires (derived from expires_in). */
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  updatedAt: number;
}
