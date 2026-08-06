import { describe, expect, it } from "vitest";
import { createContext } from "../../src/cli/context.js";
import { formatTable, output, setOutputStream } from "../../src/output/index.js";

const rows = [
  { id: "a1", day: "2026-01-18", score: 80 },
  { id: "a2", day: "2026-01-19", score: 61, extra: true },
];

function capture(argv: string[]) {
  let out = "";
  let err = "";
  const stdout = {
    write: (s: string) => {
      out += s;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write: (s: string) => {
      err += s;
    },
  } as unknown as NodeJS.WritableStream;
  setOutputStream(stdout, stderr);
  return { ctx: createContext(argv, {}), out: () => out, err: () => err };
}

describe("output", () => {
  it("defaults to JSON when stdout is not a TTY", () => {
    const { ctx, out } = capture([]);
    output(ctx, rows);
    expect(JSON.parse(out())).toEqual(rows);
  });

  it("emits stable JSON with --json", () => {
    const { ctx, out } = capture(["--json"]);
    output(ctx, rows);
    expect(JSON.parse(out())).toHaveLength(2);
  });

  it("builds a table with --table", () => {
    const { ctx, out } = capture(["--table"]);
    output(ctx, rows, {
      columns: [
        { key: "day", header: "Day" },
        { key: "score", header: "Score" },
      ],
    });
    expect(out()).toContain("Day");
    expect(out()).toContain("2026-01-18");
    expect(out()).toContain("80");
  });

  it("emits IDs only with --quiet", () => {
    const { ctx, out } = capture(["--quiet"]);
    output(ctx, rows);
    expect(out().trim().split("\n")).toEqual(["a1", "a2"]);
  });

  it("handles null data (missing docs) without crashing", () => {
    const { ctx, out } = capture(["--json"]);
    output(ctx, null);
    expect(out().trim()).toBe("null");
  });

  it("renders empty table as (no data)", () => {
    const { ctx, out } = capture(["--table"]);
    output(ctx, [], { columns: [{ key: "day", header: "Day" }] });
    expect(out().trim()).toBe("(no data)");
  });
});

describe("formatTable", () => {
  it("uses em-dash for null values", () => {
    const t = formatTable(
      [{ day: "2026-01-18", score: null }],
      [
        { key: "day", header: "Day" },
        { key: "score", header: "Score" },
      ],
    );
    expect(t).toContain("—");
  });

  it("reads nested keys via dot notation", () => {
    const t = formatTable(
      [{ day: "d", contributors: { deep_sleep: 70 } }],
      [{ key: "contributors.deep_sleep", header: "Deep" }],
    );
    expect(t).toContain("70");
  });
});
