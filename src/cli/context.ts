import kleur from "kleur";

export const OUTPUT_FORMATS = ["json", "plain", "table"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export type OutputConfig = {
  color: boolean;
  format: OutputFormat;
  verbose: boolean;
  quiet: boolean;
};

export type CliContext = {
  isTty: boolean;
  output: OutputConfig;
  colors: {
    muted: (t: string) => string;
    success: (t: string) => string;
    warning: (t: string) => string;
    error: (t: string) => string;
    bold: (t: string) => string;
  };
  prefix: { ok: string; warn: string; err: string; info: string };
};

function resolveOutputConfig(
  argv: string[],
  env: Record<string, string | undefined>,
): OutputConfig {
  const noColor = argv.includes("--no-color") || env.NO_COLOR !== undefined;
  const verbose = argv.includes("--verbose") || argv.includes("--debug");
  const quiet = argv.includes("--quiet") || argv.includes("-q");

  let format: OutputFormat = process.stdout.isTTY ? "plain" : "json";
  if (argv.includes("--json")) format = "json";
  else if (argv.includes("--plain")) format = "plain";
  else if (argv.includes("--table")) format = "table";

  return {
    color: process.stdout.isTTY && !noColor && format === "plain",
    format,
    verbose,
    quiet,
  };
}

export function createContext(argv: string[], env: Record<string, string | undefined>): CliContext {
  const output = resolveOutputConfig(argv, env);
  kleur.enabled = output.color;

  const style =
    (styler: (text: string) => string) =>
    (text: string): string =>
      output.color ? styler(text) : text;

  const colors = {
    muted: style((t) => kleur.gray(t)),
    success: style((t) => kleur.green(t)),
    warning: style((t) => kleur.yellow(t)),
    error: style((t) => kleur.red(t)),
    bold: style((t) => kleur.bold(t)),
  };

  const prefix = output.color
    ? { ok: "✓ ", warn: "⚠ ", err: "✗ ", info: "ℹ " }
    : { ok: "[OK] ", warn: "[WARN] ", err: "[ERR] ", info: "[INFO] " };

  return { isTty: process.stdout.isTTY ?? false, output, colors, prefix };
}
