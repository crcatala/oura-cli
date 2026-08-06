# Oura CLI Implementation Plan

> A TypeScript CLI for the Oura Ring API v2, built on `commander` + native `fetch`, designed for AI agent integration and personal productivity workflows. **OAuth2-only** (personal access tokens were deprecated Dec 2025).

> **Status banner (2026-08-05):** This plan originally lived at `plans/oura-cli-implementation-plan.md` in the `research-learning-agent` monorepo. The CLI has since been **spun off into this standalone repo** (`github.com/crcatala/oura-cli`). **M1 (Phases 0–2) and M2 (Phase 3) are complete** — see the checkboxes below and [`PLAN.md`](../PLAN.md) for the remaining M3 work. Research source docs referenced below live in the monorepo and were superseded by the implementation.

**Based on:**
- `docs/research/oura-api-cli-spike.md` — API audit (endpoints, schemas, freshness semantics)
- `docs/research/oura-cli-oauth2-and-existing-tools.md` — OAuth2-in-CLI complexity + OSS survey
- `docs/research/oura-cli-review-daveremy-oura-mcp.md` — code review of the top adoption candidate (patterns to reuse, pitfalls to avoid)
- `cli-playbook.md` + `cli-starter/` — collection conventions

## Project Overview

### Goals
- Query Oura Ring health data from the terminal: sleep, readiness, activity, stress, resilience, SpO2, VO2max, heart rate, workouts, ring battery, personal info
- Optimize for AI agent consumption (structured JSON output, stable IDs, machine-safe stdout)
- Support human-friendly output (tables, plain text)
- **OAuth2 auth only**, with automatic token refresh — no PATs (deprecated)
- Enable automation/scripting for the personal "life & health" CLI collection
- Fill the gaps the OSS survey confirmed: none of the existing tools are OAuth2-correct *and* TS *and* collection-quality

### Non-Goals (v1)
- Webhook subscriptions (defer; polling is safe at 5k req/5min)
- Tags / enhanced tags (deprecated / user-entered in app)
- Offline SQLite cache or weekly digest (a separate consumer workflow can own this — see review docs)
- Sessions, sleep-time, rest-mode, cardiovascular age (nice-to-have, defer)
- Multi-user OAuth (personal use only)

### Tech Stack
- **Runtime**: Node.js 22.12+ (commander v15 is ESM-only), built with Bun (matches raindrop/ticktick)
- **Language**: TypeScript 5.x, strict mode
- **CLI Framework**: Commander.js ^15
- **API Client**: native `fetch` (no axios — matches ticktick)
- **Types**: hand-curated from the pinned OpenAPI spec (`https://cloud.ouraring.com/v2/static/json/openapi-1.37.json`), with a `schema:capture` refresh script
- **Secrets**: `keytar` (OS keyring, lazy-loaded) with `0600` config-file fallback (`--use-config`) and env overrides — collection convention
- **Output**: JSON / table / plain / quiet with TTY auto-detection (reuse `cli-starter/src/cli/output.ts` patterns)
- **Build**: `bun build` + `tsc --emitDeclarationOnly` (raindrop pattern); biome/oxlint + prettier; `release-it`
- **Testing**: unit + integration with recorded sandbox fixtures; live tests gated behind real OAuth creds

### Key design decisions (from research)

1. **OAuth2 loopback flow** — the only viable auth. Register an Oura app with redirect URI `http://localhost:9876/callback` (configurable port). Flow: bind localhost server → open browser (always print URL to stderr for headless) → validate `state` → exchange code → persist tokens.
2. **Scopes must be exact** — request only valid scope names: `daily heartrate workout session spo2Daily personal email` (skip `tag`, deprecated). Record *granted* scopes (users can untick) and surface them in `auth status`.
3. **Refresh-token rotation** — Oura refresh tokens are single-use and rotate. Persist the new refresh token *before* using the new access token; serialize concurrent refreshes (daveremy's `refreshPromise` pattern); on refresh failure, clear tokens and ask for re-auth. Revoke on logout (`POST /oauth/revoke`).
4. **`requestDay` exclusive-end workaround** — Oura's `end_date` is exclusive/inconsistent per endpoint. Query `[date, date+1)` and filter client-side on `day` (daveremy's verified approach). Use UTC-safe `nextDay`.
5. **Data freshness** — sleep/readiness/sleep-time appear only after app sync; activity/stress/heartrate update in background. `today` must degrade gracefully ("no sleep data yet — open the Oura app").
6. **Sandbox routing** — `--sandbox` flag routes to `/v2/sandbox/usercollection/...` for zero-credential demos and test fixtures (ouracli pattern).
7. **Preflight authorize check** — hit the authorize URL before opening a browser to fail fast on unregistered redirect URIs (ouracli pattern).

---

## Phase 0: Project Setup
**Effort**: Small | **Priority**: P0 (blocker)

### 0.1 Repository & Initialization
- [x] Create new repo `oura-cli` (bin `oura`, plus `oura-cli` alias — raindrop precedent) — done at spin-off: `github.com/crcatala/oura-cli`
- [x] Bootstrap from `cli-starter` (structure, output utils, error classes, EPIPE/NO_COLOR handling)
- [x] TypeScript config (strict, NodeNext), `.gitignore`, biome + prettier
- [x] README with unofficial-project disclaimer (Oura is a registered trademark; unaffiliated)

### 0.2 Dependencies
```json
{
  "dependencies": {
    "commander": "^15.0.0",
    "keytar": "^7.9.0"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "bun": "^1.x",
    "vitest": "^2.x",
    "@types/node": "^22.x"
  }
}
```

### 0.3 Project Structure
```
oura-cli/
├── src/
│   ├── cli.ts               # Thin entrypoint (#!/usr/bin/env node)
│   ├── index.ts             # Library entry (exports types + client)
│   ├── cli-main.ts          # DI of streams/env/fetch (testable)
│   ├── run.ts               # Orchestration
│   ├── api/
│   │   ├── client.ts        # OuraClient: fetch, auth header, refresh, retry
│   │   ├── endpoints.ts     # Endpoint paths + param builders
│   │   ├── pagination.ts    # next_token loop, day batching
│   │   └── types.ts         # Oura API types (curated from pinned spec)
│   ├── oauth/
│   │   ├── flow.ts          # Loopback auth flow (server, state, exchange)
│   │   ├── refresh.ts       # Serialized refresh + rotation persistence
│   │   └── scopes.ts        # Scope constants + granted-scope handling
│   ├── config/
│   │   ├── config.ts        # ~/.config/oura-cli/ (0600)
│   │   └── credentials.ts   # keytar keyring + --use-config fallback + env
│   ├── commands/
│   │   ├── auth.ts          # login / status / logout
│   │   ├── today.ts         # Morning briefing composite
│   │   ├── sleep.ts         # + readiness/activity/stress/resilience/spo2/vo2max (shared daily pattern)
│   │   ├── heartrate.ts     # Time series + aggregation
│   │   ├── workouts.ts
│   │   ├── ring.ts          # battery + configuration
│   │   └── profile.ts       # personal_info
│   ├── output/              # json/table/plain/quiet + TTY detection (from starter)
│   ├── utils/
│   │   ├── date.ts          # today/yesterday/--days N/nextDay (UTC-safe)
│   │   ├── errors.ts        # Typed errors + exit codes
│   │   └── backoff.ts       # 429 handling
│   └── cli/
│       ├── program.ts
│       ├── context.ts
│       └── errors.ts
├── tests/
│   ├── unit/                # date, oauth, credentials, client, output
│   ├── integration/         # command-level with mocked fetch
│   ├── fixtures/            # recorded sandbox responses
│   └── live/                # gated: REAL_OURA_CLIENT_ID/SECRET
├── scripts/
│   ├── schema-capture.ts    # re-pin OpenAPI spec + regenerate types
│   └── live-test-preflight.ts
└── package.json
```

### 0.4 Deliverables
- [ ] `bun run build` produces executable; `npx . --help` works
- [ ] `oura --version` works
- [ ] CI runs lint + typecheck + unit tests

---

## Phase 1: Core Infrastructure
**Effort**: Medium | **Priority**: P0 (blocker)

### 1.1 Credentials & Config
- [ ] `credentials.ts`: keytar service `oura-cli`, lazy-loaded; `--use-config` fallback to `~/.config/oura-cli/credentials.json` (mode 0600); env overrides (`OURA_ACCESS_TOKEN`, `OURA_REFRESH_TOKEN`, `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`) with documented precedence (env > keyring > config)
- [ ] `config.ts`: per-invocation/per-user settings (default port 9876, default output, date defaults)
- [ ] `auth status` reports source (env/keyring/config), scope set, expiry, masked values

### 1.2 OAuth2 Module (the de-risked core)
- [ ] `flow.ts` — loopback authorization-code flow:
  - Bind `localhost:PORT/callback` (default 9876, `--port` / `OURA_PORT` override; pick free port on conflict)
  - Build authorize URL with `state` (random), exact scope list, exact redirect URI
  - **Preflight** the authorize URL (fail fast on unregistered redirect URI)
  - Print URL to stderr always; `--no-browser` for headless; 2-min timeout with `unref()`
  - Validate `state` on callback; handle `error=access_denied`
  - Exchange at `https://api.ouraring.com/oauth/token` (`authorization_code` grant)
  - Record granted scopes (may be subset) + expiry; persist tokens to keyring
- [ ] `refresh.ts`:
  - On 401: single-flight serialized refresh (`refreshPromise` pattern)
  - `refresh_token` grant; **persist new refresh token before returning** (rotation)
  - On refresh failure: clear stored tokens, typed error → "run `oura auth login`"
  - Never refresh for bare PAT/static tokens (env-provided access tokens without refresh support)
- [ ] `logout` — clear tokens; attempt `POST /oauth/revoke` (best-effort)

### 1.3 Typed API Client
- [ ] `client.ts`: `OuraClient` over native fetch, base `https://api.ouraring.com`, 30s timeouts, `Authorization: Bearer`
- [ ] `requestDay<T>` — `[date, date+1)` + `day` filter (exclusive-end workaround); UTC-safe `nextDay`
- [ ] `pagination.ts` — loop `next_token` with `--limit`/max-pages guard; day-batched fetch for time series (heartrate)
- [ ] `fields` param support for slim payloads (optional, additive-only semantics documented)
- [ ] `--sandbox` routing to `/v2/sandbox/usercollection/...` (no creds needed)
- [ ] `OURA_API_DELAY_MS` test hook (raindrop precedent) for deterministic live tests — needed as soon as live tests exist (Phase 1), don't defer
- [ ] Typed errors: 401 (auth expired), 403 (scope missing), 404, 422 (bad date), 429 (backoff)
- [ ] `types.ts` curated from pinned spec; `scripts/schema-capture.ts` re-pins + diff-checks

### 1.4 Output & Date Utils
- [ ] JSON when stdout is not a TTY; `--json/--plain/--table/--quiet`; `--no-color`; `NO_COLOR`; `-v/--verbose` and `--debug` global flags (cli-starter's `logVerbose`/`logDebug` in the output module this plan reuses depend on both; without them they're dead code)
- [ ] Date shortcuts: `today`, `yesterday`, `--days N`, `--start/--end`, ISO dates; validate + typed 422 errors
- [ ] Exit codes: 0 success / 1 general / 2 usage / 130 interrupted; "auth required" is a typed `AuthError` (exit 1, code `AUTH_REQUIRED`) matching cli-starter's error classes — no bespoke exit code 3

### 1.5 Deliverables
- [ ] `oura auth login/status/logout` working end-to-end against a real Oura app (dev)
- [ ] Client unit tests green with sandbox fixtures (zero live deps)
- [ ] `oura profile` returns personal info

---

## Phase 2: Daily Summary Commands
**Effort**: Medium | **Priority**: P0

Shared daily-summary pattern (endpoint → single doc or day-filtered list → output). Each command: `[--date D]`, `[--days N]`, `--json/--table/--plain`.

- [ ] `oura today` — composite briefing: readiness (score, temp deviation), sleep (score, duration), activity (steps, calories), stress, SpO2, resilience, ring battery; flags to subset (`--sleep` etc.); graceful "no data yet" handling
- [ ] `oura sleep` — daily score + contributors; `--detail` adds sleep periods (stages, avg/lowest HR, HRV, latency, efficiency)
- [ ] `oura readiness` — score + contributors + temperature deviation
- [ ] `oura activity` — steps, calories, MET minutes, activity zones, targets, contributors
- [ ] `oura stress` — day summary + stress_high/recovery_high minutes
- [ ] `oura resilience` — level + contributors
- [ ] `oura spo2` — average + breathing disturbance index
- [ ] `oura vo2max` — daily estimate
- [ ] Table output shows day, score, and 2–3 headline fields; `--json` is the full document

### Deliverables
- [ ] All 8 commands returning correct data against sandbox fixtures and live
- [ ] `today` degrades gracefully when sleep/readiness are missing (sync-pending)

---

## Phase 3: Time Series & Events
**Effort**: Medium | **Priority**: P1

- [x] `oura heartrate --start ISO --end ISO` (required range) with `--bucket avg|min|max|count` hourly aggregation; day-batched pagination; warn on Gen3-only
- [x] `oura workouts [--date | --days N]` — activity, calories, distance, intensity, source
- [ ] ~~`oura ring`~~ — **removed from scope by decision (2026-08):** battery/configuration is low-value for personal use; the `today` briefing keeps its ring-battery section, and the client keeps the `ringBattery`/`ringConfiguration` methods (cheap, already written) for future use

### Deliverables
- [x] Heartrate aggregation table + JSON; pagination correct on multi-day ranges
- [ ] ~~Ring battery history over `--days N`~~ (dropped with the `ring` command)
- [ ] Shared window-flag semantics: `--date`, `--days`, and `--start/--end` are mutually exclusive (usage error on any combination — no silent precedence); codified in `resolveDateWindow` so every command behaves identically

---

## Phase 4: Agent Optimization & Polish
**Effort**: Small | **Priority**: P1

- [x] `--quiet` (IDs/values only) for chaining — implemented in the output module; composite `today` quiet shape still open (see PLAN.md)
- [x] Stable keys in JSON (`day`, `id`, `timestamp_unix` for dedup)
- [x] Stdin-free, no interactive prompts (agent-safe); all prompts opt-in
- [x] JSON error envelope for machine consumers + human-readable stderr
- [x] `oura doctor` — credential source, token expiry, endpoint reachability (ouracli inspiration)

---

## Phase 5: Distribution & Documentation
**Effort**: Small | **Priority**: P1

- [ ] npm publishing (`oura-cli` or `@crcatala/oura-cli`) via `release-it`, prepublish verification
- [x] README: quick start (register Oura app → `oura auth login`), command reference, env vars, sandbox demo, disclaimer
- [x] Live test docs: how to register an app, what scopes, headless notes
- [ ] Optionally: Homebrew tap / standalone binaries (bun build --compile) — post-v1

---

## Milestones

| Milestone | Scope | Definition of done | Status |
|---|---|---|---|
| **M1 — Spike** | Phases 0–2 | `oura auth login` + `today`/`sleep`/`readiness`/`activity` work live; unit tests green | ✅ done (2026-08) |
| **M2 — MVP** | + Phase 3 (minus `ring`, deferred by decision) | heartrate + workouts live; agent flags; integration tests | ✅ done (2026-08) |
| **M3 — Release** | + Phases 4–5 | Published to npm, README complete, live-test suite documented | 🔄 in progress — see [`PLAN.md`](../PLAN.md) |

## Open Questions
1. Repo location/name: new repo `oura-cli` (matches collection) — confirm bin name `oura` (no conflicts?) — **resolved:** repo `crcatala/oura-cli`; bins `oura` + `oura-cli`. npm name conflict (`oura` is taken by the Go project) still open for Phase 5 publishing.
2. Scope of `today`: include workouts + heartrate summary, or just daily summaries? (default: daily summaries + ring battery) — **resolved:** daily summaries + ring battery.
3. Include `--sandbox` as a first-class demo flag? (recommended: yes — doubles as fixture source) — **resolved:** yes, implemented.
4. Keep `oura doctor` in v1 or defer? (default: v1, it's cheap and useful for the collection) — **open:** planned for M3 (Phase 4); not yet implemented.
