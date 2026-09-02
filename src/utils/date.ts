import { UsageError } from "./errors.js";

/** Format a Date as local YYYY-MM-DD. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function today(): string {
  return formatLocalDate(new Date());
}

export function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatLocalDate(d);
}

/**
 * The calendar day after `date` (both YYYY-MM-DD).
 *
 * Pure UTC arithmetic on purpose: parsing a bare YYYY-MM-DD yields UTC
 * midnight, so reading it back with local getters can shift the day for
 * anyone west of UTC. Used to build the exclusive upper bound for Oura's
 * date-range queries (see OuraClient.requestDay).
 */
function shiftUtcDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function nextDay(date: string): string {
  return shiftUtcDate(date, 1);
}

export function previousDay(date: string): string {
  return shiftUtcDate(date, -1);
}

/** Validate a YYYY-MM-DD string; returns it unchanged, or throws UsageError. */
export function validateISODate(value: string): string {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(value)) {
    throw new UsageError(`Invalid date "${value}" — expected YYYY-MM-DD, "today", or "yesterday"`);
  }
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== m - 1 ||
    t.getUTCDate() !== d ||
    Number.isNaN(t.getTime())
  ) {
    throw new UsageError(`Invalid date "${value}" — not a real calendar day`);
  }
  return value;
}

/** Expand a date shortcut ("today", "yesterday") to YYYY-MM-DD. */
export function resolveDate(value: string): string {
  if (value === "today") return today();
  if (value === "yesterday") return yesterday();
  return validateISODate(value);
}

/**
 * Validate an ISO 8601 datetime string (used by heartrate --start/--end).
 * Accepts date-only ("2026-01-18") or a full datetime
 * ("2026-01-18T09:30", "2026-01-18T09:30:45Z", "2026-01-18T09:30:45+02:00").
 * Returns it unchanged, or throws UsageError.
 */
export function validateISODateTime(value: string): string {
  const re = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?)?$/;
  const m = re.exec(value);
  if (!m) {
    throw new UsageError(
      `Invalid datetime "${value}" — expected ISO 8601, e.g. "2026-01-18" or "2026-01-18T09:30:00Z"`,
    );
  }
  validateISODate(m[1]);
  if (m[2] !== undefined) {
    const hh = Number(m[2]);
    const mm = Number(m[3]);
    const ss = m[4] !== undefined ? Number(m[4]) : 0;
    if (hh > 23 || mm > 59 || ss > 59) {
      throw new UsageError(`Invalid datetime "${value}" — time components out of range`);
    }
  }
  return value;
}

export type DateWindow = { start: string; end: string };

/**
 * Resolve the date window from CLI options.
 *
 * The window flags are mutually exclusive — --start/--end, --date, and
 * --days N each define a window on their own, and combining any two is a
 * usage error (no silent precedence). With no flags, the window is today.
 */
export function resolveDateWindow(opts: {
  start?: string;
  end?: string;
  date?: string;
  days?: number;
}): DateWindow {
  const hasRange = opts.start !== undefined || opts.end !== undefined;
  const hasDate = opts.date !== undefined;
  const hasDays = opts.days !== undefined;

  if (hasRange) {
    if (hasDate) {
      throw new UsageError("--start/--end and --date are mutually exclusive");
    }
    if (hasDays) {
      throw new UsageError("--start/--end and --days are mutually exclusive");
    }
    if (!opts.start || !opts.end) {
      throw new UsageError("--start and --end must be used together");
    }
    const start = validateISODate(opts.start);
    const end = validateISODate(opts.end);
    if (start > end) throw new UsageError(`--start (${start}) is after --end (${end})`);
    return { start, end };
  }

  if (hasDate && hasDays) {
    throw new UsageError("--date and --days are mutually exclusive");
  }

  if (opts.date) {
    const d = resolveDate(opts.date);
    return { start: d, end: d };
  }

  if (opts.days !== undefined) {
    if (!Number.isInteger(opts.days) || opts.days < 1 || opts.days > 366) {
      throw new UsageError("--days must be an integer between 1 and 366");
    }
    const end = today();
    const startD = new Date();
    startD.setDate(startD.getDate() - (opts.days - 1));
    return { start: formatLocalDate(startD), end };
  }

  const t = today();
  return { start: t, end: t };
}
