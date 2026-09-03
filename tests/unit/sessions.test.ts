import { describe, expect, it } from "vitest";
import {
  filterSessions,
  formatSessionPlain,
  parseSessionType,
} from "../../src/commands/sessions.js";
import type { Session } from "../../src/types.js";
import { UsageError } from "../../src/utils/errors.js";

const sample = {
  interval: 5,
  items: [62, 61, null, 60],
  timestamp: "2026-01-18T14:00:00.000+00:00",
};

const nap: Session = {
  id: "session-nap-0",
  day: "2026-01-18",
  type: "nap",
  start_datetime: "2026-01-18T14:00:00.000+00:00",
  end_datetime: "2026-01-18T14:25:00.000+00:00",
  mood: null,
  heart_rate: sample,
  heart_rate_variability: { ...sample, items: [40, 42] },
  motion_count: { ...sample, items: [1, 0, 0] },
};

const meditation: Session = {
  id: "session-med-0",
  day: "2026-01-18",
  type: "meditation",
  start_datetime: "2026-01-18T07:00:00.000+00:00",
  end_datetime: "2026-01-18T07:12:00.000+00:00",
  mood: "good",
  heart_rate: null,
  heart_rate_variability: null,
  motion_count: null,
};

const breathing: Session = {
  id: "session-br-0",
  day: "2026-01-19",
  type: "breathing",
  start_datetime: "2026-01-19T21:00:00.000+00:00",
  end_datetime: "2026-01-19T21:05:00.000+00:00",
  mood: "",
  heart_rate: sample,
  heart_rate_variability: null,
  motion_count: null,
};

describe("parseSessionType", () => {
  it("accepts every API enum value", () => {
    for (const type of ["breathing", "meditation", "nap", "relaxation", "rest", "body_status"]) {
      expect(parseSessionType(type)).toBe(type);
    }
  });

  it("passes through undefined (no filter)", () => {
    expect(parseSessionType(undefined)).toBeUndefined();
  });

  it("rejects unknown values with a usage error listing valid types", () => {
    try {
      parseSessionType("yoga");
      throw new Error("expected UsageError");
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).exitCode).toBe(2);
      expect((err as UsageError).message).toContain("yoga");
      expect((err as UsageError).message).toContain(
        "breathing, meditation, nap, relaxation, rest, body_status",
      );
    }
  });
});

describe("filterSessions", () => {
  const rows = [nap, meditation, breathing];

  it("returns all rows when no type is set", () => {
    expect(filterSessions(rows, undefined)).toEqual(rows);
  });

  it("keeps only matching types", () => {
    expect(filterSessions(rows, "nap")).toEqual([nap]);
    expect(filterSessions(rows, "meditation")).toEqual([meditation]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSessions(rows, "rest")).toEqual([]);
  });
});

describe("formatSessionPlain", () => {
  it("renders (no data) for an empty window", () => {
    expect(formatSessionPlain([])).toBe("(no data)");
  });

  it("renders mood as an em dash when null or empty", () => {
    const text = formatSessionPlain([nap, breathing]);
    expect(text).toContain("mood=—");
    expect(text).not.toContain("mood=null");
    expect(text).toContain("2026-01-18  nap");
    expect(text).toContain("2026-01-19  breathing");
  });

  it("renders a present mood value", () => {
    expect(formatSessionPlain([meditation])).toContain("mood=good");
  });
});
