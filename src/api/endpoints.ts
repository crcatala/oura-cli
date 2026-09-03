/** Oura API v2 endpoint paths (production + sandbox). */

export const API_HOST = "https://api.ouraring.com";

const COLLECTION = "v2/usercollection";
const SANDBOX_COLLECTION = "v2/sandbox/usercollection";

export function collectionBase(sandbox: boolean): string {
  return sandbox ? SANDBOX_COLLECTION : COLLECTION;
}

export const ENDPOINTS = {
  dailySleep: "daily_sleep",
  dailyReadiness: "daily_readiness",
  dailyActivity: "daily_activity",
  dailyStress: "daily_stress",
  dailyResilience: "daily_resilience",
  dailySpO2: "daily_spo2",
  vo2Max: "vO2_max",
  dailyCardiovascularAge: "daily_cardiovascular_age",
  sleep: "sleep",
  heartrate: "heartrate",
  ringBattery: "ring_battery_level",
  ringConfiguration: "ring_configuration",
  workout: "workout",
  session: "session",
  enhancedTag: "enhanced_tag",
  personalInfo: "personal_info",
} as const;
