/**
 * Typed errors with stable exit codes (clig.dev contract):
 *   0 success | 1 general | 2 usage | 130 interrupted
 *
 * "Auth required" is a typed `AuthError` (exit 1, code `AUTH_REQUIRED`)
 * matching the collection's cli-starter convention — no bespoke exit code 3.
 * The JSON error envelope carries the machine-readable code.
 */

export const EXIT = { OK: 0, GENERAL: 1, USAGE: 2, INTERRUPTED: 130 } as const;

export type ErrorEnvelope = {
  error: {
    kind: string;
    code: string;
    message: string;
    hint?: string;
  };
};

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

export class CliError extends Error {
  readonly kind: string = "cli";
  readonly exitCode: number;
  readonly hint?: string;

  constructor(message: string, opts: { exitCode?: number; hint?: string } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = opts.exitCode ?? EXIT.GENERAL;
    this.hint = opts.hint;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        kind: this.kind,
        code: this.name,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

export class UsageError extends CliError {
  readonly kind = "usage";
  constructor(message: string, hint?: string) {
    super(message, { exitCode: EXIT.USAGE, hint });
    this.name = "UsageError";
  }
}

export class AuthError extends CliError {
  readonly kind = "auth";
  constructor(message = "No valid Oura credentials", hint?: string) {
    super(message, { exitCode: EXIT.GENERAL, hint: hint ?? "Run: oura auth login" });
    this.name = "AuthError";
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        kind: this.kind,
        code: "AUTH_REQUIRED",
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

export class OuraApiError extends CliError {
  readonly kind = "api";
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    const detail = extractDetail(body);
    // 401s are auth-related but exit 1 like any general error; the envelope
    // code (http_401) + hint keep them machine-distinguishable.
    super(detail, { exitCode: EXIT.GENERAL });
    this.name = "OuraApiError";
    this.status = status;
    this.body = body;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        kind: this.kind,
        code: `http_${this.status}`,
        message: this.message,
        ...(this.status === 401 ? { hint: "Token invalid or expired — run: oura auth login" } : {}),
      },
    };
  }
}

/** Try to pull `detail` out of Oura's error JSON bodies. */
function extractDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.detail === "string")
        return `Oura API ${statusLabel(parsed)}: ${parsed.detail}`;
      if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
        const first = parsed.detail[0];
        if (first && typeof first === "object" && first.msg) return `Oura API: ${first.msg}`;
      }
    }
  } catch {
    // not JSON — fall through
  }
  return `Oura API error: ${body.slice(0, 300)}`;
}

function statusLabel(parsed: unknown): string {
  return typeof (parsed as { status?: unknown }).status === "number"
    ? String((parsed as { status?: number }).status)
    : "";
}
