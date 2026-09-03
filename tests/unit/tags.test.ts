import { describe, expect, it } from "vitest";
import { formatTagPlain, tagLabel, toTagRow } from "../../src/commands/tags.js";
import type { EnhancedTag } from "../../src/types.js";

const alcohol: EnhancedTag = {
  id: "tag-alcohol-0",
  tag_type_code: "alcohol",
  custom_name: null,
  start_time: "2026-01-18T20:00:00.000+00:00",
  end_time: null,
  start_day: "2026-01-18",
  end_day: null,
  comment: "two drinks",
};

const custom: EnhancedTag = {
  id: "tag-custom-0",
  tag_type_code: "custom",
  custom_name: "sauna",
  start_time: "2026-01-18T18:00:00.000+00:00",
  end_time: "2026-01-18T18:30:00.000+00:00",
  start_day: "2026-01-18",
  end_day: "2026-01-18",
  comment: null,
};

const textOnly: EnhancedTag = {
  id: "tag-text-0",
  tag_type_code: null,
  custom_name: null,
  start_time: "2026-01-19T09:15:00.000+00:00",
  end_time: null,
  start_day: "2026-01-19",
  end_day: null,
  comment: "felt off",
};

const duration: EnhancedTag = {
  id: "tag-travel-0",
  tag_type_code: "travel",
  custom_name: null,
  start_time: "2026-01-17T08:00:00.000+00:00",
  end_time: "2026-01-19T22:00:00.000+00:00",
  start_day: "2026-01-17",
  end_day: "2026-01-19",
  comment: "red-eye",
};

const customUnnamed: EnhancedTag = {
  id: "tag-custom-blank",
  tag_type_code: "custom",
  custom_name: null,
  start_time: "2026-01-18T12:00:00.000+00:00",
  end_time: null,
  start_day: "2026-01-18",
  end_day: null,
  comment: null,
};

describe("tagLabel", () => {
  it("uses the standardized tag_type_code", () => {
    expect(tagLabel(alcohol)).toBe("alcohol");
    expect(tagLabel(duration)).toBe("travel");
  });

  it("falls back to custom_name for custom tags", () => {
    expect(tagLabel(custom)).toBe("sauna");
  });

  it("marks text-only tags as (text)", () => {
    expect(tagLabel(textOnly)).toBe("(text)");
  });

  it("marks custom tags with no name as (text)", () => {
    expect(tagLabel(customUnnamed)).toBe("(text)");
  });
});

describe("toTagRow", () => {
  it("covers standardized, custom, text-only, and duration tags", () => {
    expect(toTagRow(alcohol)).toEqual({
      start_day: "2026-01-18",
      tag_type_code: "alcohol",
      start_time: "2026-01-18T20:00:00.000+00:00",
      end_time: "—",
      comment: "two drinks",
    });
    expect(toTagRow(custom).tag_type_code).toBe("sauna");
    expect(toTagRow(textOnly).tag_type_code).toBe("(text)");
    expect(toTagRow(duration)).toMatchObject({
      start_day: "2026-01-17",
      tag_type_code: "travel",
      end_time: "2026-01-19T22:00:00.000+00:00",
      comment: "red-eye",
    });
  });
});

describe("formatTagPlain", () => {
  it("renders (no data) for an empty window", () => {
    expect(formatTagPlain([])).toBe("(no data)");
  });

  it("renders type fallbacks and omits a missing comment", () => {
    const text = formatTagPlain([alcohol, custom, textOnly].map(toTagRow));
    expect(text).toContain("2026-01-18  alcohol");
    expect(text).toContain("two drinks");
    expect(text).toContain("sauna");
    expect(text).toContain("(text)");
    expect(text).toContain("felt off");
  });
});
