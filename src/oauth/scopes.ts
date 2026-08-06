/**
 * Oura OAuth2 scopes — CURRENT IdP (Curity, migrated ~2026).
 *
 * IMPORTANT: Oura migrated its identity provider; scopes are now
 * `extapi:`-prefixed. The strings below are the exact checkbox values from
 * the developer-portal application form (verified live 2026-08-05).
 * The old scope names (email, daily, spo2Daily, ...) are stale — the
 * cloud docs still list them, but the new portal/IdP rejects them.
 */
export const OURA_SCOPES = {
  email: "extapi:email",
  personal: "extapi:personal",
  daily: "extapi:daily",
  heartrate: "extapi:heartrate",
  workout: "extapi:workout",
  tag: "extapi:tag",
  session: "extapi:session",
  spo2: "extapi:spo2",
  ringConfiguration: "extapi:ring_configuration",
  stress: "extapi:stress",
  heartHealth: "extapi:heart_health",
} as const;

export type OuraScope = (typeof OURA_SCOPES)[keyof typeof OURA_SCOPES];

/**
 * Scopes our CLI requests. All 11 are requested for full read coverage of
 * every collection; users can untick individual scopes on the consent
 * screen, so commands must tolerate a reduced grant.
 */
export const REQUESTED_SCOPES: readonly OuraScope[] = [
  OURA_SCOPES.daily,
  OURA_SCOPES.heartrate,
  OURA_SCOPES.workout,
  OURA_SCOPES.session,
  OURA_SCOPES.spo2,
  OURA_SCOPES.ringConfiguration,
  OURA_SCOPES.stress,
  OURA_SCOPES.heartHealth,
  OURA_SCOPES.personal,
  OURA_SCOPES.email,
  OURA_SCOPES.tag,
];

export function scopeList(scopes: readonly string[] = REQUESTED_SCOPES): string {
  return scopes.join(" ");
}

/** Normalize the `scope` query param returned in the callback redirect. */
export function parseGrantedScopes(scopeParam: string | null): string[] {
  if (!scopeParam) return [];
  return scopeParam.split(" ").filter(Boolean);
}
