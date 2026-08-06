import { existsSync, statSync } from "node:fs";
import type { Command } from "commander";
import type { OuraClient } from "../api/client.js";
import type { CliContext } from "../cli/context.js";
import type { AuthDeps } from "../commands/auth.js";
import { configFileStore } from "../config/credentials.js";
import { REQUESTED_SCOPES } from "../oauth/scopes.js";
import { output } from "../output/index.js";
import { today } from "../utils/date.js";
import { AuthRequiredError, CliError } from "../utils/errors.js";

export type CheckStatus = "ok" | "warn" | "error" | "skipped";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  generatedAt: string;
  sandbox: boolean;
  summary: { checks: number; ok: number; warnings: number; errors: number; skipped: number };
  checks: DoctorCheck[];
}

/** Non-zero exit so agents can react to `oura doctor` failing. */
class DoctorFailedError extends CliError {
  readonly kind = "doctor";
  constructor(count: number) {
    super(`doctor: ${count} problem${count === 1 ? "" : "s"} found — see report`, {
      exitCode: 1,
    });
    this.name = "DOCTOR_FAILED";
  }
}

function check(name: string, status: CheckStatus, detail: string, hint?: string): DoctorCheck {
  return { name, status, detail, ...(hint ? { hint } : {}) };
}

function humanDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * `oura doctor` — diagnostics for credential source, token expiry, granted
 * scopes, storage backend, and API reachability. Exits 0 when everything is
 * healthy (or only warnings are found), 1 when an error is found.
 */
export function registerDoctor(
  program: Command,
  ctx: CliContext,
  client: OuraClient,
  deps: AuthDeps,
): void {
  program
    .command("doctor")
    .description("Diagnostics: credentials, token expiry, scopes, storage, API reachability")
    .action(async () => {
      const sandbox = Boolean(program.opts().sandbox);
      const report = await runDoctor({ ...deps, client, sandbox });

      output(ctx, report, {
        formatter: (data, format) => formatDoctor(data as DoctorReport, format),
      });

      if (report.summary.errors > 0) {
        throw new DoctorFailedError(report.summary.errors);
      }
    });
}

async function runDoctor(
  deps: AuthDeps & { client: OuraClient; sandbox: boolean },
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const sandbox = deps.sandbox;

  // load() also resolves the lazy backing store, so store.type is accurate.
  const creds = await deps.store.load();

  const envAccess = Boolean(deps.env.OURA_ACCESS_TOKEN);
  const envRefresh = Boolean(deps.env.OURA_REFRESH_TOKEN);
  const envConfigured = envAccess && envRefresh;
  const partialEnv = envAccess !== envRefresh;
  const source = envConfigured ? "env" : creds ? deps.store.type : null;

  // ---- credentials ----
  if (sandbox) {
    checks.push(check("credentials", "ok", "sandbox mode — no credentials required"));
  } else if (!source) {
    checks.push(
      partialEnv
        ? check(
            "credentials",
            "error",
            "partial env configuration — set both OURA_ACCESS_TOKEN and OURA_REFRESH_TOKEN",
          )
        : check("credentials", "error", "no credentials configured", "Run: oura auth login"),
    );
  } else {
    const parts = [`source: ${source}`];
    if (envConfigured) parts.push("access + refresh tokens (env)");
    else parts.push("access + refresh tokens (stored)");
    if (!(envConfigured || creds?.refreshToken)) {
      parts.push("no refresh token — expiry cannot be renewed");
    }
    checks.push(check("credentials", "ok", parts.join(", ")));
  }

  // ---- token expiry ----
  if (sandbox || !source) {
    checks.push(
      check("token expiry", "skipped", sandbox ? "no tokens in sandbox mode" : "no credentials"),
    );
  } else if (envConfigured) {
    checks.push(check("token expiry", "skipped", "no expiry recorded for env-provided tokens"));
  } else if (creds?.expiresAt !== undefined && creds.expiresAt !== null) {
    const msLeft = creds.expiresAt - Date.now();
    checks.push(
      msLeft <= 0
        ? check(
            "token expiry",
            "error",
            `expired ${humanDuration(-msLeft)} ago`,
            "Run: oura auth login",
          )
        : check("token expiry", "ok", `valid — expires in ${humanDuration(msLeft)}`),
    );
  } else {
    checks.push(check("token expiry", "warn", "no expiry recorded for stored credentials"));
  }

  // ---- scopes ----
  if (sandbox || !creds) {
    checks.push(
      check("scopes", "skipped", sandbox ? "no scopes in sandbox mode" : "no credentials"),
    );
  } else if (!creds.grantedScopes) {
    checks.push(check("scopes", "warn", "no granted scopes recorded"));
  } else {
    const granted = creds.grantedScopes;
    const missing = REQUESTED_SCOPES.filter((s) => !granted.includes(s));
    checks.push(
      missing.length === 0
        ? check(
            "scopes",
            "ok",
            `all requested granted (${granted.length}/${REQUESTED_SCOPES.length})`,
          )
        : check(
            "scopes",
            "warn",
            `missing ${missing.length} of ${REQUESTED_SCOPES.length}: ${missing.join(", ")}`,
            "Re-run: oura auth login and grant all scopes",
          ),
    );
  }

  // ---- storage ----
  const fileStore = configFileStore(deps.env.OURA_CONFIG_DIR);
  const fileExists = existsSync(fileStore.filePath);
  const activeBackend = deps.store.type;
  if (fileExists && activeBackend === "config" && process.platform !== "win32") {
    const mode = statSync(fileStore.filePath).mode & 0o777;
    const detail = `backend: ${activeBackend} — ${fileStore.filePath} (${mode.toString(8)})`;
    checks.push(
      mode & 0o077
        ? check(
            "storage",
            "warn",
            `${detail} — permissions too open (should be 600)`,
            `chmod 600 ${fileStore.filePath}`,
          )
        : check("storage", "ok", detail),
    );
  } else {
    checks.push(
      check(
        "storage",
        "ok",
        fileExists
          ? `backend: ${activeBackend} — ${fileStore.filePath}`
          : `backend: ${activeBackend} — no config file yet`,
      ),
    );
  }

  // ---- api reachability ----
  if (sandbox || source) {
    try {
      // daily_activity is the lightest probe that exists in BOTH the real
      // API and the sandbox (personal_info is not implemented in sandbox).
      await deps.client.dailyActivity(today());
      checks.push(
        check(
          "api reachability",
          "ok",
          sandbox ? "sandbox API responded (daily_activity)" : "API responded (daily_activity)",
        ),
      );
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        checks.push(check("api reachability", "error", err.message, err.hint));
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push(check("api reachability", "error", `request failed: ${msg}`));
      }
    }
  } else {
    checks.push(
      check("api reachability", "skipped", "no credentials — skipped", "Run: oura auth login"),
    );
  }

  const summary = {
    checks: checks.length,
    ok: checks.filter((c) => c.status === "ok").length,
    warnings: checks.filter((c) => c.status === "warn").length,
    errors: checks.filter((c) => c.status === "error").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    sandbox,
    summary,
    checks,
  };
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  ok: "✓",
  warn: "⚠",
  error: "✗",
  skipped: "–",
};

function formatDoctor(report: DoctorReport, _format: "plain" | "table"): string {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const lines = [`oura doctor — ${report.generatedAt}${report.sandbox ? " (sandbox)" : ""}`, ""];
  for (const c of report.checks) {
    const glyph = STATUS_GLYPH[c.status];
    lines.push(`  ${glyph} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.hint) lines.push(`    → ${c.hint}`);
  }
  const { errors, warnings, ok, skipped } = report.summary;
  lines.push("", `${errors} error(s), ${warnings} warning(s), ${ok} ok, ${skipped} skipped`);
  return lines.join("\n");
}
