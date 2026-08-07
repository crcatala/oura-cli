# oura-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An **OAuth2-only** TypeScript CLI for the [Oura Ring API v2](https://cloud.ouraring.com/v2/docs), built for personal health monitoring, scripting, and AI-agent integration.

> **Unofficial software:** not affiliated with, endorsed by, or sponsored by Oura Health Oy. "Oura" is a trademark of Oura Health Oy. Personal access tokens were **deprecated December 2025** — this CLI uses OAuth2 only.

## Features

- **Morning briefing** — one command for sleep, readiness, activity, stress, SpO2, resilience, and ring battery
- **Daily summaries & trends** — `sleep`, `readiness`, `activity`, `stress`, `resilience`, `spo2`, `vo2max` with `--date`, `--days`, and `--start/--end` windows
- **Time series** — hourly-aggregated heart rate and workout history
- **Agent-friendly output** — JSON automatically when piped, stable keys for chaining, machine-safe stdout
- **OAuth2 with automatic refresh** — tokens in the OS keyring (or a `0600` config file), refresh-token rotation handled for you
- **Zero-credential sandbox** — try every command against Oura's sandbox before connecting a real account

## Requirements

- Node.js 22+
- For real data: an Oura Ring (Gen3+ for heart rate) and a registered Oura developer app

## Installation

```bash
npm install -g @crcatala/oura-cli
```

Or run it without installing:

```bash
npx @crcatala/oura-cli --help
```

This installs the `oura` command, with `oura-cli` as an alias.

## Quick start (sandbox — no account needed)

Oura's sandbox serves fake data, so you can explore every command without credentials:

```bash
oura --sandbox today                      # morning briefing (all 7 sections)
oura --sandbox --table today              # same, as a summary table
oura --sandbox sleep --days 7             # last week of sleep scores
oura --sandbox --table sleep --days 7     # sleep trend table
oura --sandbox workouts --days 3          # recent workouts
oura --sandbox --json today | jq '.sleep.score'
```

## Authentication (real account)

1. **Register an app** in the [Oura developer portal](https://cloud.ouraring.com/oauth/applications) with redirect URI `http://localhost:9876/callback/`. The **trailing slash is required** — the portal rejects the no-slash variant (`invalid_redirect_uri`); the CLI accepts both `/callback` and `/callback/`.
2. **Set your app credentials** (env vars — never shell history or files):

   ```bash
   export OURA_CLIENT_ID=your-client-id
   export OURA_CLIENT_SECRET=your-client-secret
   ```

3. **Log in:**

   ```bash
   oura auth login        # opens a browser → callback → tokens stored
   oura auth status       # credential source, scopes, expiry (masked)
   oura auth logout       # revoke + clear stored credentials
   ```

> **Note (2026):** Oura migrated to a new identity provider (`moi.ouraring.com`); the public docs at `cloud.ouraring.com/docs/authentication` are stale (legacy scope names + token URL). The CLI targets the current IdP, requests only valid scope names (`daily`, `heartrate`, `workout`, `session`, `spo2Daily`, `personal`, `email`, plus `stress`, `ringConfiguration`, `heartHealth`, `tag`), and records which scopes Oura actually granted.

### Token storage

Tokens live in the OS keyring (Keychain / Credential Manager / Secret Service) by default, falling back to a `0600` config file at `~/.config/oura-cli/credentials.json` when the keyring is unavailable (e.g., headless Linux) or with `--use-config`. Env overrides `OURA_ACCESS_TOKEN` / `OURA_REFRESH_TOKEN` bypass stored credentials entirely. Access-token refresh is automatic — Oura's single-use refresh token is rotated and persisted before it is consumed.

### Headless / SSH machines

`oura auth login --manual` needs no tunnel:

```bash
# 1. On the remote machine:
oura auth login --manual
#    → prints the authorize URL → open it in ANY browser (your laptop)
# 2. Approve → the browser tries localhost:9876 and fails (expected)
# 3. Copy the full URL from the address bar, paste it back into the CLI
```

Alternatively, tunnel the callback port (`ssh -L 9876:localhost:9876 host`) and run a normal `auth login`. On a headless box the CLI prints the authorize URL instead of opening a browser; `--no-browser` forces that behavior.

## Commands

### Morning briefing

```bash
oura today                          # all 7 sections
oura today --table                  # per-section summary table
oura today --sections sleep,stress  # subset of sections
oura today --date yesterday         # a specific day
oura today --quiet                  # print just the resolved date (for scripting)
```

### Daily summaries & trends

`sleep`, `readiness`, `activity`, `stress`, `resilience`, `spo2`, and `vo2max` share one pattern:

```bash
oura sleep                                  # today's sleep score + contributors
oura sleep --date 2026-01-18                # a specific day
oura readiness --days 7                     # last 7 days (ending today)
oura stress --start 2026-01-01 --end 2026-01-07   # an explicit range
oura activity --table --days 30             # a month of activity as a table
```

### Time series

```bash
oura heartrate --start 2026-01-18T06:00 --end 2026-01-18T09:00
oura heartrate --start 2026-01-18 --end 2026-01-20 --bucket max   # avg|min|max|count
oura workouts --days 7                      # recent workout sessions
oura workouts --date 2026-01-18             # one day
```

Heart rate samples are aggregated into hourly buckets (JSON carries avg/min/max/count per hour). Heart rate requires a **Gen3+ ring** and app sync; an empty range prints a hint on stderr.

### Account

```bash
oura profile     # age, biological sex, weight, height, email
oura doctor      # diagnostics: credential source, token expiry, scopes, storage, API reachability (exits 1 on problems)
oura auth ...    # login | status | logout
```

## Output & scripting

| Flag | Behavior |
|------|----------|
| *(default)* | JSON when piped (non-TTY), plain text in a terminal |
| `--json` | Force structured JSON |
| `--table` | Aligned table |
| `--plain` | Human-readable text |
| `--quiet` | Minimal output (dates / IDs) for chaining |
| `--no-color` | Disable ANSI colors (also honored via `NO_COLOR`) |
| `--verbose` | Progress details on stderr |
| `--sandbox` | Use Oura sandbox data (no credentials) |
| `--port <n>` | OAuth callback port (default 9876) |

- Data goes to stdout; progress, warnings, and errors go to stderr — piping stays machine-safe.
- `--date`, `--days N`, and `--start/--end` are **mutually exclusive** — combining any two is a usage error (exit 2), never silent precedence. `--days N` means the last N days ending today.
- Exit codes: `0` ok, `1` general, `2` usage, `130` interrupted. Auth failures exit `1`; machine consumers detect them via the JSON error envelope (`error.kind: "auth"`, `error.code: "AUTH_REQUIRED"`).

### Examples

```bash
# Morning check: what should I focus on today?
oura today --table

# Sleep trend for the last month
oura sleep --days 30 --table

# Did my morning run spike my heart rate?
oura heartrate --start 2026-01-18T06:00 --end 2026-01-18T09:00 --bucket max

# Agent/script: pull the sleep score into a variable
SCORE=$(oura today --json | jq -r '.sleep.score')

# Cron-friendly: check readiness, emit only the date
oura today --quiet
```

### Environment variables

| Variable | Purpose |
|---|---|
| `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` | OAuth app credentials |
| `OURA_ACCESS_TOKEN` / `OURA_REFRESH_TOKEN` | Bypass stored credentials (e.g., CI) |
| `OURA_USE_CONFIG` | Force config-file storage instead of keyring |
| `OURA_CONFIG_DIR` | Override `~/.config/oura-cli` |

## Notes & quirks

- **Exclusive end dates** — Oura's `end_date` is exclusive (and inconsistent per endpoint). Single-day queries use `[date, date+1)` with a client-side `day` filter.
- **Data availability** — sleep/readiness appear only after the ring syncs with the Oura app; `today` degrades gracefully for missing sections.
- **Refresh rotation** — Oura refresh tokens are single-use. The CLI rotates and persists the new token before the next request.

## Development

```bash
npm ci
npm run dev -- today --sandbox     # run via tsx (no build)
npm run build                      # compile TypeScript to dist/
npm test                           # unit + integration tests (mocked fetch)
npm run lint                       # biome
npm run typecheck
npm run verify                     # build + test + lint + typecheck + package smoke test
```

### Live tests (maintainers only)

`tests/live/` runs against the **real** Oura API with a dedicated token set. It is **opt-in and read-only** — GET commands only; nothing logs in, revokes, or writes. Requests are serialized and paced at 250 ms by default (`OURA_LIVE_DELAY_MS` to tune).

```bash
OURA_LIVE_TESTS=1 \
OURA_ACCESS_TOKEN=... \
OURA_REFRESH_TOKEN=... \
OURA_CLIENT_ID=... \
OURA_CLIENT_SECRET=... \
npm run test:live
```

The **Live Tests** GitHub workflow runs this suite against a same-repo PR when the owner comments `/run-live-tests` (fork PRs are rejected), or manually from the Actions tab. It requires a protected `live-tests` environment with `OURA_LIVE_ACCESS_TOKEN`, `OURA_LIVE_REFRESH_TOKEN`, `OURA_LIVE_CLIENT_ID`, and `OURA_LIVE_CLIENT_SECRET`. Refresh tokens are single-use — re-mint the pair if the stored one has gone stale.

### Releases (maintainers only)

See [RELEASING.md](RELEASING.md) for the release-it + Keep a Changelog workflow, recovery options, and post-publish verification.

## Out of scope

Webhooks, tags, offline cache/digest, sessions/sleep-time/cardiovascular age, and multi-user OAuth.

## Contributing & security

This is a personally maintained project — see [CONTRIBUTING.md](CONTRIBUTING.md) before opening issues, and report security vulnerabilities privately per [SECURITY.md](SECURITY.md). Licensed under the [MIT License](LICENSE).
