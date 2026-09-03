import { describe, expect, it } from "vitest";
import { formatDailyPlain } from "../../src/commands/daily.js";
import type { DailyCardiovascularAge } from "../../src/types.js";

const columns = [
  { key: "day", header: "Day" },
  { key: "pulse_wave_velocity", header: "PWV" },
  { key: "vascular_age", header: "VascularAge" },
];

const cardio: DailyCardiovascularAge = {
  id: "daily_cardiovascular_age-0-2026-1-18",
  day: "2026-01-18",
  pulse_wave_velocity: 6.4,
  vascular_age: 41,
};

describe("formatDailyPlain (cardiovascular-age columns)", () => {
  it("prints Header: value pairs for a single document", () => {
    const text = formatDailyPlain(cardio, columns);
    expect(text).toBe("Day: 2026-01-18\nPWV: 6.4\nVascularAge: 41");
  });

  it("renders null metrics as an em dash", () => {
    const text = formatDailyPlain(
      { ...cardio, pulse_wave_velocity: null, vascular_age: null },
      columns,
    );
    expect(text).toContain("PWV: —");
    expect(text).toContain("VascularAge: —");
  });

  it("prints (no data) for an empty day", () => {
    expect(formatDailyPlain(null as unknown as DailyCardiovascularAge, columns)).toBe("(no data)");
  });

  it("prints compact lines for a range", () => {
    const next: DailyCardiovascularAge = {
      ...cardio,
      id: "daily_cardiovascular_age-1-2026-1-19",
      day: "2026-01-19",
      pulse_wave_velocity: null,
      vascular_age: 42,
    };
    const text = formatDailyPlain([cardio, next], columns);
    expect(text).toBe("2026-01-18  6.4  41\n2026-01-19  —  42");
  });
});
