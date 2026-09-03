# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-03

### Added

- Added `oura cardiovascular-age` for daily pulse-wave velocity and vascular
  age data.
- Added `oura sessions` for Moments such as meditation, naps, and breathing
  exercises, with `--type` filtering.
- Added `oura tags` for enhanced lifestyle event tags.

## [0.4.0] - 2026-09-01

### Added

- `sleep-periods` accepts `--start`, `--end`, and `--days` in addition to
  `--date`, so the raw `/sleep` window can be inspected without the
  single-day `day` filter.

### Changed

- Requires Node.js 22.12+ (previously 22+) to align with commander v15.

### Fixed

- `sleep-periods --date D` queries `[D-1, D+1)` and keeps `day === D`, so
  nights that begin just after local midnight (UTC day D-1) are no longer
  dropped.

## [0.3.1] - 2026-08-31

### Fixed

- Show help when options are provided without a command or when the command is
  missing.
- Derive the CLI version from package metadata.

## [0.3.0] - 2026-08-31

### Added

- Added a command to retrieve raw sleep periods.

### Changed

- Added npm, license, and CI badges to the README.

## [0.2.1] - 2026-08-07

### Changed

- Trimmed the README: collapsed the 2026 IdP note into a collapsible
  disclosure and removed the "Out of scope" section.

## [0.2.0] - 2026-08-07

### Added

- Initial release: OAuth2 loopback login (`auth login/status/logout`), daily
  summaries (`today`, `sleep`, `readiness`, `activity`, `stress`, `resilience`,
  `spo2`, `vo2max`), time series (`heartrate`, `workouts`), `profile`, `doctor`,
  sandbox mode, and JSON/table/plain/quiet output for agent consumption.
- `--quiet`/`-q` and `--verbose`/`--debug` aliases on commands.
- `auth login --manual` captures the `scope` parameter from a pasted URL when
  present.
- `doctor --sandbox` skips the storage check ("not applicable in sandbox").
- `today --sections` validates section names (case-insensitive) and rejects
  unknown names with a usage error.

### Changed

- Daily summary commands now render `--plain` output as human-readable text —
  `Key: value` pairs for single days, compact lines per row for ranges — instead
  of falling back to JSON.
- `today --quiet` now prints the resolved date (previously nothing), giving
  scripts a stable key to chain other date-based commands.
- `today --sections` now filters JSON output as well as human-readable formats.
- Auth-required errors exit with status 1 and envelope code `AUTH_REQUIRED`
  (previously a bespoke exit 3); API 401s keep code `http_401`.
- Workout output rounds calories to whole numbers and reports distance in
  kilometers.
- `doctor` treats empty `grantedScopes` as "unknown" rather than warning about
  0 of 11 scopes, and checks config-file permissions only when the config
  backend is the active credential source.
- `--verbose` now prints the credential source in use.

### Fixed

- `profile` no longer crashes: `personal_info` returns a plain object, not a
  `{data:[...]}` envelope.
- `heartrate --quiet` now emits hour keys instead of nothing.
- Unknown options on subcommands now exit with status 2 and a JSON error
  envelope instead of falling through to a bare `process.exit(1)`.
