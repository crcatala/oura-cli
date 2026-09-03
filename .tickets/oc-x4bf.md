---
id: oc-x4bf
status: open
deps: []
links: []
created: 2026-09-03T22:56:32Z
type: feature
priority: 2
assignee: cc-vps
tags: [api, new-command]
---
# Add cardiovascular-age command (daily_cardiovascular_age)

Expose the /v2/usercollection/daily_cardiovascular_age collection as `oura cardiovascular-age`. This endpoint returns two daily cardiovascular-health metrics the CLI does not surface anywhere today:

- pulse_wave_velocity (number|null) - arterial stiffness indicator, m/s
- vascular_age (integer|null) - Oura's estimated cardiovascular age in years

It completes the daily-summary command family (sleep, readiness, activity, stress, resilience, spo2, vo2max) and is the highest-value remaining health collection in the API v2 spec that the CLI does not cover.

## Design

- Follow the established makeDailyCommand pattern exactly (see src/commands/daily.ts and the seven existing daily commands in src/cli/program.ts).
- Add endpoint key daily_cardiovascular_age to ENDPOINTS in src/api/endpoints.ts and client methods dailyCardiovascular(day) / dailyCardiovascularRange(start, end) in src/api/client.ts, mirroring the vo2Max pair.
- Add a DailyCardiovascularAge interface to src/types.ts: id, day, pulse_wave_velocity (number|null), vascular_age (integer|null). Do not invent fields beyond the API schema.
- Register the command in buildProgram with columns: day, pulse_wave_velocity, vascular_age. Wire loadDay with the exclusive-end workaround pattern used by the other daily commands.
- Plain/table/JSON/quiet output comes free from the shared output module; no custom formatter.

## Acceptance Criteria

- `oura cardiovascular-age --date YYYY-MM-DD` returns a single document as `Header: value` plain lines; --json matches the API field names exactly (pulse_wave_velocity, vascular_age).
- --days N and --start/--end windowing behave identically to the other daily commands, including the exclusive end_date workaround.
- An empty day prints "(no data)" / empty JSON array rather than erroring; null metric values render as an em dash in plain output.
- Unit tests cover parsing, column rendering, and the single-day loadDay path with a redacted fixture; failure/auth/timeout behavior is inherited from the shared client and not re-tested.
- README command list and CHANGELOG (Unreleased > Added) updated; `npm test` and `npm run lint` pass.

