---
id: oc-c6ye
status: open
deps: []
links: []
created: 2026-09-03T22:56:40Z
type: feature
priority: 2
assignee: cc-vps
tags: [api, new-command]
---
# Add sessions command (Moments: meditation, naps, breathing, rest)

Expose the /v2/usercollection/session collection as `oura sessions`. These are Oura "Moments" - guided breathing, meditation, nap, relaxation, rest, and body_status sessions. Each document carries:

- type (enum: breathing, meditation, nap, relaxation, rest, body_status)
- start_datetime / end_datetime (localized)
- day (assigned logical day)
- mood (enum, nullable)
- heart_rate, heart_rate_variability, motion_count sample arrays (PublicSample: interval, items[], timestamp) - the only place in the API with a HRV time series outside sleep documents

This is the API's only event-style wellness data beyond workouts and matters for anyone correlating recovery practices with sleep/readiness.

## Design

- Model the command on src/commands/workouts.ts (event-style documents with day + start/end datetimes), not makeDailyCommand; reuse resolveDateWindow for --date/--days/--start/--end.
- Add endpoint key session to ENDPOINTS and client methods sessionRange(start, end); add a Session type with id, day, type, start_datetime, end_datetime, mood, and the three sample arrays (typed loosely enough to preserve the raw PublicSample shape).
- Table columns stay minimal: day, type, start_datetime, end_datetime, mood. The full document - including sample arrays - is always preserved in --json output. Do not attempt to aggregate samples in table output.
- Add an optional --type <type> filter applied client-side over the fetched rows; validate against the API enum (breathing, meditation, nap, relaxation, rest, body_status) and reject unknown values with a usage error.
- Single-day mode uses the [D-1, D+1) day-assignment trick only if day-based exclusive-end filtering drops sessions; sessions are keyed by day like workouts, so the workouts approach should suffice - verify in tests.

## Acceptance Criteria

- `oura sessions --date YYYY-MM-DD` lists that day's moments; --days and --start/--end windowing work like workouts.
- --json output preserves the complete source document including heart_rate / heart_rate_variability / motion_count sample arrays and source id.
- --type nap filters results; an invalid --type value exits with a structured usage error listing valid types.
- Empty day/range prints "(no data)" without error; null mood renders as an em dash in plain output.
- Unit tests with a redacted multi-session fixture cover filtering, windowing, and column rendering; README command list and CHANGELOG updated; npm test and npm run lint pass.

