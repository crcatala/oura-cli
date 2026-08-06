import type { CliContext } from "../cli/context.js";
import { isCliError } from "../utils/errors.js";

// Injectable streams (set by cli-main / tests).
let stdoutStream: NodeJS.WritableStream = process.stdout;
let stderrStream: NodeJS.WritableStream = process.stderr;

export function setOutputStream(
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream,
): void {
  stdoutStream = stdout;
  stderrStream = stderr;
}

function writeOut(message: string): void {
  stdoutStream.write(`${message}\n`);
}

function writeErr(message: string): void {
  stderrStream.write(`${message}\n`);
}

export function logError(ctx: CliContext, message: string): void {
  const prefix = ctx.output.color ? ctx.colors.error(ctx.prefix.err) : ctx.prefix.err;
  writeErr(`${prefix}${message}`);
}

export function logSuccess(ctx: CliContext, message: string): void {
  if (ctx.output.quiet) return;
  const prefix = ctx.output.color ? ctx.colors.success(ctx.prefix.ok) : ctx.prefix.ok;
  writeErr(`${prefix}${message}`);
}

export function logInfo(ctx: CliContext, message: string): void {
  if (ctx.output.quiet) return;
  const prefix = ctx.output.color ? ctx.colors.muted(ctx.prefix.info) : ctx.prefix.info;
  writeErr(`${prefix}${message}`);
}

export type ColumnConfig = {
  /** Dot-notation key path (e.g. "contributors.deep_sleep") */
  key: string;
  header: string;
};

function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatTable<T>(data: T | T[], columns: ColumnConfig[]): string {
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0) return "(no data)";

  const widths = columns.map((col) => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...items.map((item) => formatValue(getNestedValue(item, col.key)).length),
    );
    return Math.max(headerWidth, Math.min(maxDataWidth, 40));
  });

  const header = columns.map((col, i) => col.header.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");
  const rows = items.map((item) =>
    columns
      .map((col, i) =>
        formatValue(getNestedValue(item, col.key)).slice(0, widths[i]).padEnd(widths[i]),
      )
      .join("  "),
  );
  return [header, separator, ...rows].join("\n");
}

export type OutputOptions = {
  /** Renders human-readable output; receives the active format (plain/table). */
  formatter?: (data: unknown, format: "plain" | "table") => string;
  columns?: ColumnConfig[];
  /**
   * Key to emit in quiet mode (default "id"). Composites without a single
   * document id (e.g. `today`'s date) use their own stable key instead.
   */
  quietKey?: string;
};

/**
 * Output data to stdout in the configured format.
 * Quiet mode emits only IDs (for agent chaining).
 */
export function output(ctx: CliContext, data: unknown, options: OutputOptions = {}): void {
  if (ctx.output.quiet) {
    const key = options.quietKey ?? "id";
    const items = data === null ? [] : Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (typeof item === "object" && item !== null) {
        const value = (item as Record<string, unknown>)[key];
        if (value !== undefined) writeOut(String(value));
      }
    }
    return;
  }

  switch (ctx.output.format) {
    case "json":
      writeOut(JSON.stringify(data, null, 2));
      break;
    case "table":
      if (options.columns) {
        writeOut(formatTable(data, options.columns));
      } else if (options.formatter) {
        writeOut(options.formatter(data, "table"));
      } else {
        writeOut(JSON.stringify(data, null, 2));
      }
      break;
    default:
      if (options.formatter) {
        writeOut(options.formatter(data, "plain"));
      } else {
        writeOut(JSON.stringify(data, null, 2));
      }
      break;
  }
}

/** Structured error output for agents; human text otherwise. */
export function outputError(ctx: CliContext, error: unknown): void {
  if (ctx.output.format === "json" && isCliError(error)) {
    writeErr(JSON.stringify(error.toEnvelope(), null, 2));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    logError(ctx, message);
    if (isCliError(error) && error.hint) {
      logError(ctx, `hint: ${error.hint}`);
    }
  }
}
