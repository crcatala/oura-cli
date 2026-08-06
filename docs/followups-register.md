# Oura CLI Implementation Plan — Follow-up Register

> **Status: moved with the repo (2026-08-05).** This register followed the CLI from the
> `research-learning-agent` monorepo (`plans/oura-cli-plan-followups.md`) into the standalone
> repo. Items resolved during M1/M2 are marked below; item 4 (cli-playbook convention) is a
> **monorepo-wide** task that still lives in `cli-playbook.md` and remains open there.
>
> **Status:** Open register of deferred suggestions from review of `plans/oura-cli-implementation-plan.md` (PR #94).
> **Date:** 2026-08-05
> Reviewed but consciously **not** folded into the plan. Tracked here so nothing is lost; priorities are per-item assessments.

## Issues addressed directly in PR #94 (for context)

1. Exit code `3` ("auth required") → replaced with typed `AuthError` (exit 1, code `AUTH_REQUIRED`), matching `cli-starter` error classes.
2. Missing `--verbose` / `--debug` global flags → added to §1.4 (cli-starter's `logVerbose`/`logDebug` depend on them).
3. `OURA_API_DELAY_MS` test hook → moved from Phase 4 into Phase 1 (§1.3), since deterministic live tests are needed from the first live test.
4. Spike doc PAT guidance → deprecation banner added atop `docs/research/oura-api-cli-spike.md`.

---

## 1. Consolidated risk register inside the plan
- **Status:** open in the plan's research docs (monorepo); superseded by implementation knowledge captured in `PLAN.md` decisions.
- **Issue:** All three research docs carry substantial risks/gotchas (data-availability lag until app sync, unbounded heartrate volume, additive-only `fields` semantics, spec drift at openapi-1.37, Gen3-only heartrate, ring-local `day` vs host timezone) that the plan only touches in passing. An implementer reading only the plan will rediscover them the hard way.
- **Assessment:** **Medium priority, cheap.** Worth doing before Phase 1 implementation, not blocking.
- **Suggested action:** Add a "Risks & gotchas (from research)" section to the plan (top ~8 items, one line each, cross-linking the source docs).

## 2. Flag-interaction semantics (`--date` + `--days`, `--start/--end` + `--days`)

- **Issue:** Phase 1/2 daily commands define `--date D` and `--days N`; Phase 3 heartrate takes `--start/--end`. The plan never defines precedence when both are supplied (conflict error vs. `--days` as offset from `--date`/`--start`).
- **Assessment:** **Low now** — genuinely an implementation detail best resolved when Commander wiring lands; premature to pin down in a plan.
- **Status: resolved (2026-08, M2).** `resolveDateWindow` now errors on ANY combination of `--start/--end`, `--date`, and `--days` (mutually exclusive groups — no silent precedence); `--days` alone implies the last N days ending today. Shared by all daily commands + `workouts`, so every command behaves identically. Covered by unit + integration tests.

## 3. Dependency & wording hygiene in the plan

- **Issue:** `bun` is listed as a `devDependency` (Bun is a runtime/toolchain, not an npm package — the actual need is `@types/bun` or `tsx`); §1.2 says "Never refresh for bare PAT/static tokens" — "PAT" is wrong vocabulary in an OAuth2-only plan (the real intent is env-provided *static access tokens* without refresh support).
- **Assessment:** **Low.** Cosmetic; corrected naturally during Phase 0 bootstrap.
- **Suggested action:** fix the deps block during project bootstrap and rename the phrase to "static access tokens" when the refresh module is written.

## 4. Collection-wide "auth required" convention

- **Issue:** The review chose exit 1 + typed `AuthError` over a bespoke exit code 3. React with sibling CLIs (mymacros-cli, raindrop-cli, ticktick-cli) may each invent their own "auth required" signal. This plan now sets the precedent; documenting it makes it sticky.
- **Assessment:** **Medium, one-time.** Do it before another auth'd CLI lands, not after.
- **Suggested action:** add an "auth-required" pattern note to `cli-playbook.md` (exit code, typed error class/code, JSON error envelope shape) so future collection tools share it.

## 5. Spike doc — eventual removal or rewrite (superseding the banner)

- **Issue:** `docs/research/oura-api-cli-spike.md` remains body-first (its §8 still asks "PAT vs OAuth2?"). The deprecation banner neutralizes the immediate hazard; long-term the doc will mislead if the banner is ignored.
- **Assessment:** **Low — banner suffices for now.** Only revisit if the doc keeps being cited.
- **Suggested action:** on the next edit of that doc, fold its still-valid findings (endpoint inventory, freshness semantics) into the plan (or a consolidated research doc) and remove/replace the doc, updating the "Based on" references.

---

### Not tracked elsewhere
- Bin name `/package conflicts (`oura` taken by the Go project) — already an **Open Question** in the plan itself.
- `sessions` / `sleep-time` / `cardiovascular-age` deferrals — already in the plan's Non-Goals.