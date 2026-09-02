import { describe, expect, it } from "vitest";
import {
  formatLocalDate,
  nextDay,
  previousDay,
  resolveDate,
  resolveDateWindow,
  validateISODate,
  validateISODateTime,
} from "../../src/utils/date.js";
import { UsageError } from "../../src/utils/errors.js";

describe("nextDay", () => {
  it("adds one calendar day", () => {
    expect(nextDay("2026-01-18")).toBe("2026-01-19");
  });

  it("handles month boundaries", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("handles leap years", () => {
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
  });

  it("is immune to host timezone (UTC arithmetic)", () => {
    // Would fail for UTC-* zones if implemented with local getters.
    expect(nextDay("2026-07-01")).toBe("2026-07-02");
  });
});

describe("previousDay", () => {
  it("subtracts one calendar day", () => {
    expect(previousDay("2026-01-18")).toBe("2026-01-17");
  });

  it("handles month and year boundaries", () => {
    expect(previousDay("2026-02-01")).toBe("2026-01-31");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});

describe("validateISODate", () => {
  it("accepts real calendar days", () => {
    expect(validateISODate("2026-01-18")).toBe("2026-01-18");
    expect(validateISODate("2024-02-29")).toBe("2024-02-29");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => validateISODate("2026-13-01")).toThrow(UsageError);
    expect(() => validateISODate("2026-02-30")).toThrow(UsageError);
    expect(() => validateISODate("26-01-18")).toThrow(UsageError);
    expect(() => validateISODate("20260118")).toThrow(UsageError);
  });
});

describe("resolveDate", () => {
  it("expands shortcuts", () => {
    expect(resolveDate("yesterday")).toBe(formatLocalDate(new Date(Date.now() - 86_400_000)));
    expect(resolveDate("today")).toBe(formatLocalDate(new Date()));
  });
});

describe("resolveDateWindow", () => {
  it("defaults to today", () => {
    const w = resolveDateWindow({});
    expect(w.start).toBe(w.end);
    expect(w.start).toBe(formatLocalDate(new Date()));
  });

  it("resolves --date", () => {
    expect(resolveDateWindow({ date: "yesterday" }).start).toBe(
      formatLocalDate(new Date(Date.now() - 86_400_000)),
    );
  });

  it("resolves --days N", () => {
    const w = resolveDateWindow({ days: 7 });
    expect(w.end).toBe(formatLocalDate(new Date()));
    expect(w.start).toBe(formatLocalDate(new Date(Date.now() - 6 * 86_400_000)));
  });

  it("requires --start with --end", () => {
    expect(() => resolveDateWindow({ start: "2026-01-01" })).toThrow(UsageError);
  });

  it("rejects reversed ranges", () => {
    expect(() => resolveDateWindow({ start: "2026-01-10", end: "2026-01-01" })).toThrow(UsageError);
  });

  it("bounds --days", () => {
    expect(() => resolveDateWindow({ days: 0 })).toThrow(UsageError);
    expect(() => resolveDateWindow({ days: 400 })).toThrow(UsageError);
  });

  it("rejects --date combined with --days", () => {
    expect(() => resolveDateWindow({ date: "today", days: 7 })).toThrow(UsageError);
  });

  it("rejects --start/--end combined with --date", () => {
    expect(() =>
      resolveDateWindow({ start: "2026-01-01", end: "2026-01-07", date: "today" }),
    ).toThrow(/--start\/--end and --date/);
  });

  it("rejects --start/--end combined with --days", () => {
    expect(() => resolveDateWindow({ start: "2026-01-01", end: "2026-01-07", days: 7 })).toThrow(
      /--start\/--end and --days/,
    );
  });

  it("gives the conflict error (not 'must be used together') when --start alone is combined with --date", () => {
    expect(() => resolveDateWindow({ start: "2026-01-01", date: "today" })).toThrow(
      /--start\/--end and --date/,
    );
  });

  it("gives the conflict error when --end alone is combined with --days", () => {
    expect(() => resolveDateWindow({ end: "2026-01-07", days: 7 })).toThrow(
      /--start\/--end and --days/,
    );
  });
});

describe("validateISODateTime", () => {
  it("accepts date-only and full datetimes with or without offsets", () => {
    expect(validateISODateTime("2026-01-18")).toBe("2026-01-18");
    expect(validateISODateTime("2026-01-18T09:30")).toBe("2026-01-18T09:30");
    expect(validateISODateTime("2026-01-18T09:30:45Z")).toBe("2026-01-18T09:30:45Z");
    expect(validateISODateTime("2026-01-18T09:30:45+02:00")).toBe("2026-01-18T09:30:45+02:00");
  });

  it("rejects malformed and impossible datetimes", () => {
    expect(() => validateISODateTime("2026-01-18 09:30")).toThrow(UsageError); // space, not T
    expect(() => validateISODateTime("2026-01-18T25:00")).toThrow(UsageError);
    expect(() => validateISODateTime("2026-01-18T09:60")).toThrow(UsageError);
    expect(() => validateISODateTime("2026-02-30T09:30")).toThrow(UsageError);
    expect(() => validateISODateTime("nonsense")).toThrow(UsageError);
  });
});
