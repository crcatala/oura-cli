# oura-cli — Status & Roadmap

> **Status: M2/MVP complete** (2026-08-05). Spun off from the `research-learning-agent`
> monorepo (`experiments/oura-cli`) into this standalone repo — no git history carried
> over (repo will be public). Full phased plan: [`docs/implementation-plan.md`](docs/implementation-plan.md);
> deferred review notes: [`docs/followups-register.md`](docs/followups-register.md).

## What was built

**M1 (Phases 0–2)** — project setup, core infrastructure, daily summaries:

```
src/
  cli.ts / run.ts / cli-main.ts   # entrypoints (DI streams/env/fetch)
  api/client.ts                   # OuraClient: requestDay, pagination, refresh rotation
  api/endpoints.ts                # endpoint paths (prod + sandbox)
  api/pagination.ts               # next_token cursor loop
  oauth/flow.ts                   # loopback auth flow, preflight, revoke
  oauth/scopes.ts                 # exact scope list
  config/credentials.ts           # keyring (lazy) + 0600 config fallback + env
  config/config.ts                # 0600 JSON file store
  commands/{auth,daily,today,profile}.ts
  output/index.ts                 # json/plain/table/quiet + TTY auto
  utils/{date,errors}.ts
  cli/{context,program}.ts
tests/ unit(4) + integration(1)   # 83 tests, all green
```

**M2 (Phase 3, minus `ring` — 2026-08)**
- `heartrate` command — `--start/--end` ISO 8601 datetime range (required) + `--bucket avg|min|max|count` (default avg); samples aggregated into hourly buckets; warns on stderr when a range is empty (Gen3+ ring + app sync); JSON always carries all four aggregates per hour.
- `workouts` command — `--date | --days N | --start/--end` windowing (same shared semantics as daily commands); columns: day/activity/calories/distance/intensity/source.
- **`ring` command dropped by decision** — battery/configuration is low-value for personal use. `today` keeps its battery section; client keeps `ringBattery`/`ringConfiguration` methods for future use.
- Flag-conflict semantics codified in `resolveDateWindow` — `--start/--end`, `--date`, `--days` are mutually exclusive groups; any combination is a usage error (exit 2, no silent precedence).

## Decisions taken during the spike

1. **Keyring is lazy** — `--help`/`--version`/env-token commands never import keytar (headless Linux GLib D-Bus noise otherwise pollutes stderr). Headless Linux (no DISPLAY/WAYLAND) skips keyring probing entirely and uses the 0600 config file.
2. **argv normalization** — `run.ts` slices `process.argv.slice(2)`; `parseAsync(argv, { from: "user" })` keeps tests and CLI consistent (commander's default `from:"node"` double-sliced prefix-less test argv).
3. **`--sandbox` skips credential resolution** — sandbox data needs no token; Oura requires *some* Authorization string, so the client sends `Bearer sandbox`.
4. **requestDay workaround proven live** — sandbox confirmed `start==end` returns empty for `daily_sleep`; `[date,+1)` + `day` filter returns the doc.
5. **Refresh rotation persisted before retry** — `persistTokens` callback invoked with the new token pair before the retried request uses the new access token (crash-safe against losing the rotated refresh token).
6. **Base-URL double-slash bug found via sandbox 404** — `API_BASE + "/" + collectionBase` produced `//v2/...`; fixed by removing leading slashes from collection paths.

## Verified live

- Sandbox (2026-08-05): `today` returns all 7 sections; `sleep/readiness/activity/stress/spo2/resilience/vo2max` single-day + `--days N`; usage errors → exit 2 JSON envelope; missing creds → exit 1 with `AUTH_REQUIRED` envelope + `Run: oura auth login`; `auth status` reports source/scopes/expiry (masked).
- Real token (2026-08): `heartrate`/`workouts` verified. **Not yet live-verified: the loopback login flow itself** (needs a real Oura app registration + redirect URI).

---

## Remaining work (M3 — Release)

### Phase 4: Agent optimization & polish (small)
- [x] `oura doctor` — credential source, token expiry, endpoint reachability (the only missing command; everything else in Phase 4 — `--quiet`, JSON error envelopes, stable keys, stdin-free — is already implemented)
- [x] `today --table` format decision — `today` is currently JSON-only; `--table` falls back to JSON for the composite
- [x] `--quiet` on composite `today` — **prints the resolved date**: `today` has no single document id, and the date is the key other date-based commands chain on (`--date`, `--days`, heartrate `--start`). Implemented as a `quietKey` option on the output module.
- [x] Settle auth-required exit code — **exit 1 + envelope code `AUTH_REQUIRED`** (cli-starter convention; no bespoke exit 3). `AuthRequiredError` renamed to `AuthError` to match the collection; 401s also exit 1 with `http_401` in the envelope. Recorded in `cli-playbook.md` (collection-wide — see followups register item 4).

### Phase 5: Distribution
- [ ] CI — see `.github/workflows/ci.yml` (added at spin-off)
- [ ] npm publishing via `release-it` (`oura-cli` or `@crcatala/oura-cli`), prepublish verification
- [ ] Live-test docs: registering an Oura app, scopes, headless notes (mostly in README already)
- [ ] Optional post-v1: Homebrew tap / standalone binaries (`bun build --compile`)

### Pre-release checklist
- [ ] Live-verify the full OAuth2 loopback login flow against a real Oura app (login → status → refresh rotation → logout/revoke)
- [x] Decide the `today --quiet` / `--table` shapes above — `--table`/`--plain` ship as a per-section briefing; `--quiet` prints the date; `--sections` applies to the briefing and JSON, quiet always emits the date
- [ ] Document the auth-required pattern in the collection's `cli-playbook.md` (monorepo)
- [ ] Add live-test creds as repo secrets (needed once live tests run in CI)

### Non-goals (v1 — from implementation plan)
Webhooks (defer; polling is safe at 5k req/5min) · tags (deprecated) · offline SQLite cache/digest · sessions/sleep-time/rest-mode/cardiovascular age · multi-user OAuth.
