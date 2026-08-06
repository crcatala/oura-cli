# oura-cli — M1 Spike

An **OAuth2-only** TypeScript CLI for the [Oura Ring API v2](https://cloud.ouraring.com/v2/docs), built for AI-agent integration and personal health monitoring. Standalone repo spun off from the `research-learning-agent` experiments (2026-08); current status: **M2/MVP complete** — plan and remaining roadmap live in [`docs/implementation-plan.md`](docs/implementation-plan.md) and [`PLAN.md`](PLAN.md).

> **Unofficial software:** not affiliated with, endorsed by, or sponsored by Oura Health Oy. "Oura" is a trademark of Oura Health Oy. Personal access tokens were **deprecated December 2025** — this CLI uses OAuth2 only.

## Quick start (sandbox — zero credentials)

```bash
npm install
npm run build

# Oura's sandbox serves fake data without any account
node dist/cli.js --sandbox --json today            # morning briefing (all sections)
node dist/cli.js --sandbox --table sleep --days 5  # sleep trends
node dist/cli.js --sandbox readiness --date 2026-01-18
```

## Real auth (OAuth2, one-time setup)

> **New IdP (2026):** Oura migrated its identity provider to Curity
> (`moi.ouraring.com`). Scopes are `extapi:`-prefixed and the token endpoint
> is `https://moi.ouraring.com/oauth/v2/ext/oauth-token` — the CLI is already
> wired for this. The public docs at `cloud.ouraring.com/docs/authentication`
> are stale (legacy scope names + token URL).

1. Register an app in the developer portal with a redirect URI for the
   loopback callback (see note below)
2. Set credentials (env vars, never shell-history flags):

   ```bash
   export OURA_CLIENT_ID=...
   export OURA_CLIENT_SECRET=...
   node dist/cli.js auth login     # opens browser → callback → tokens stored
   node dist/cli.js auth status    # source, scopes, expiry (masked)
   node dist/cli.js auth logout    # revoke + clear
   ```

Tokens are stored in the OS keyring (keytar), falling back to a `0600` config file at `~/.config/oura-cli/credentials.json` when the keyring is unavailable (e.g., headless Linux) or with `--use-config`. Env overrides: `OURA_ACCESS_TOKEN` / `OURA_REFRESH_TOKEN` (+ `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET`). Access-token refresh is automatic; the single-use rotating refresh token is persisted before it's consumed.

### Redirect URI (current developer portal)

The CLI listens on `http://localhost:9876/callback/` by default (`--port` to change). **Register the URI with the trailing slash** — the current developer-portal form rejects the no-slash variant (`http://localhost:9876/callback`) with `invalid_redirect_uri`; `http://localhost:9876/callback/` is accepted. The CLI accepts callbacks on both `/callback` and `/callback/`.

### Headless / SSH machines

On a headless box (no browser, e.g. a VPS), `auth login` prints the authorize URL instead of opening a browser. To complete the flow from your laptop:

```bash
# 1. From your laptop, tunnel the callback port to the remote machine:
ssh -L 9876:localhost:9876 user@remote-host

# 2. On the remote machine:
OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... node dist/cli.js auth login
#    → prints the authorize URL; open it in your LOCAL browser
#    → consent → browser redirects to localhost:9876/callback/ → tunnel → CLI completes
```

Or use `--no-browser` explicitly to skip any browser attempt. The callback must reach the machine running the CLI — the URL is always printed so you can drive it manually.

**Easiest for headless/remote: `auth login --manual`** (no tunnel needed):

```bash
OURA_CLIENT_ID=... OURA_CLIENT_SECRET=... node dist/cli.js auth login --manual
# 1. Prints the authorize URL → open it in ANY browser (your laptop)
# 2. Approve → the browser tries localhost:9876 and fails (expected)
# 3. Copy the full URL from the address bar, paste it back into the CLI
```

The CLI extracts the `code` and exchanges it directly — the browser's localhost never needs to reach the remote machine, and there's no state mismatch because you paste into the same run that printed the URL. (A pasted URL from an *older* run is detected and rejected with a clear hint.)

The CLI listens on `http://localhost:9876/callback/` by default (`--port` to change).
**Register the URI with the trailing slash** — the current developer-portal form rejects
the no-slash variant (`http://localhost:9876/callback`) with `invalid_redirect_uri`;
`http://localhost:9876/callback/` is accepted. The CLI accepts callbacks on both
`/callback` and `/callback/`.
## Commands

| Command | Description |
|---|---|
| `today [--date] [--sections csv]` | Composite morning briefing: sleep, readiness, activity, stress, SpO2, resilience, ring battery |
| `sleep \| readiness \| activity \| stress \| resilience \| spo2 \| vo2max` | Daily summaries; `--date`, `--days N`, `--start/--end` |
| `heartrate --start <iso> --end <iso> [--bucket avg\|min\|max\|count]` | Heart rate samples aggregated per hour (Gen3+); JSON carries avg/min/max/count per hour |
| `workouts [--date \| --days N \| --start/--end]` | Workout sessions: activity, calories, distance, intensity, source |
| `profile` | Personal info (age, sex, weight, height, email) |
| `auth login \| status \| logout` | OAuth2 lifecycle |

Global flags: `--json` `--plain` `--table` `--quiet` `--no-color` `--verbose` `--sandbox` `--port <n>`.

Window flags are mutually exclusive: `--date`, `--days N`, and `--start/--end` each define the window on their own; combining any two is a usage error (no silent precedence). `--days N` is the last N days ending today.

Output is JSON automatically when piped (non-TTY); exit codes: `0` ok, `1` general, `2` usage, `3` auth required. Errors are JSON envelopes in `--json` mode.

## Design highlights (from the research)

- **`requestDay`** — Oura's `end_date` is exclusive/inconsistent per endpoint; single-day queries use `[date, date+1)` + a client-side `day` filter (verified quirk that breaks other CLIs).
- **Exact scopes** — requests only valid scope names (`daily heartrate workout session spo2Daily personal email`); the daveremy/oura-mcp review showed a real-world bug from invalid scope strings.
- **Refresh rotation** — single-flight refresh; the new (rotated) refresh token is persisted before the retry uses the new access token.
- **Preflight authorize** — fails fast on an unregistered redirect URI before opening the browser; URL is always printed to stderr for headless use.
- **Sandbox routing** — `--sandbox` hits `/v2/sandbox/usercollection/...` (no token needed), which also doubles as the test-fixture source.

## Development

```bash
npm test          # 81 unit + integration tests (mocked fetch + real loopback)
npm run lint      # biome
npm run typecheck
npm run test:live # gated: requires OURA_CLIENT_ID + OURA_CLIENT_SECRET
```

Not in v1 (see [`docs/implementation-plan.md`](docs/implementation-plan.md) Non-Goals): webhooks, tags, offline cache/digest, sessions/sleep-time/cardiovascular age, multi-user OAuth. Remaining before M3 release: `oura doctor`, `today --table` format decision, npm publish (`release-it`), live-test of the loopback login flow, and the auth-required exit-code decision (see [`PLAN.md`](PLAN.md)).
