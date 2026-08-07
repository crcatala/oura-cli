import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import type { OuraTokens } from "../types.js";
import { CliError } from "../utils/errors.js";
import { parseGrantedScopes, scopeList } from "./scopes.js";

export const DEFAULT_PORT = 9876;
export const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";

// Oura migrated its IdP to Curity (moi.ouraring.com) — new-portal apps
// exchange codes and refresh at this endpoint. The legacy
// https://api.ouraring.com/oauth/token no longer works for new apps.
export const TOKEN_URL = "https://moi.ouraring.com/oauth/v2/ext/oauth-token";
export const REVOKE_URL = "https://moi.ouraring.com/oauth/v2/ext/oauth/revoke";

// The current developer portal REQUIRES the trailing slash when registering
// the loopback redirect URI (http://localhost:9876/callback/ is accepted,
// without it you get invalid_redirect_uri). The CLI mirrors it exactly so
// the authorize request matches the registration.
export function loopbackRedirectUri(port: number): string {
  return `http://localhost:${port}/callback/`;
}

export interface OAuthFlowResult {
  tokens: OuraTokens;
  grantedScopes: string[];
}

export interface OAuthFlowOptions {
  clientId: string;
  clientSecret: string;
  port?: number;
  scopes?: readonly string[];
  /** Override for tests. */
  fetcher?: typeof fetch;
  /** Override for tests / headless use. */
  openBrowser?: (url: string) => void;
  /** Wait timeout in ms. */
  timeoutMs?: number;
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", scopeList(params.scopes));
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Fail fast on an unregistered redirect URI (or other bad client config)
 * BEFORE opening a browser: fetch the authorize URL without following the
 * redirect. A 3xx means Oura accepted the request; a 4xx means bad config.
 */
export async function preflightAuthorize(
  authorizeUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(authorizeUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status >= 400) {
    const body = await res.text();
    const redirectUri = new URL(authorizeUrl).searchParams.get("redirect_uri");
    throw new CliError(
      `Oura rejected the authorization request (HTTP ${res.status}). Check that the redirect URI "${redirectUri}" is registered exactly in your Oura app.`,
      { hint: body.slice(0, 300) },
    );
  }
}

export interface CallbackResult {
  code?: string;
  error?: string;
  scope?: string | null;
  state?: string | null;
}

export interface CallbackServer {
  url: string;
  close: () => void;
  result: Promise<CallbackResult>;
}

/**
 * Bind the loopback callback server on all interfaces (dual-stack so both
 * 127.0.0.1 and ::1 browser resolutions reach us). The server lives for the
 * duration of one auth flow only; the state check guards against CSRF.
 */
export function startCallbackServer(opts: {
  port: number;
  expectedState: string;
  timeoutMs: number;
}): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let resolveResult: (r: CallbackResult) => void = () => {};

    const resultPromise = new Promise<CallbackResult>((r) => {
      resolveResult = r;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
      // Accept both /callback and /callback/ (the registered URI has the
      // trailing slash; some browsers/clients normalize it away).
      if (url.pathname !== "/callback" && url.pathname !== "/callback/") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const result: CallbackResult = {
        code: url.searchParams.get("code") ?? undefined,
        error: url.searchParams.get("error") ?? undefined,
        scope: url.searchParams.get("scope"),
        state: url.searchParams.get("state"),
      };

      if (result.state !== opts.expectedState) {
        res.writeHead(403);
        res.end("Invalid state parameter — possible CSRF attack.");
      } else if (result.error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${result.error}`);
      } else if (!result.code) {
        res.writeHead(400);
        res.end("No authorization code received");
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<!doctype html><h1>oura-cli authorized!</h1><p>You can close this tab.</p>");
      }

      // Always settle so the flow can act on the outcome (incl. CSRF).
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        server.close();
        resolveResult(result);
      }
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(
          new CliError(`Could not bind callback server on port ${opts.port}: ${err.message}`, {
            hint: "Use --port to pick another port",
          }),
        );
      }
    });

    server.listen(opts.port, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : opts.port;
      resolve({
        url: `http://localhost:${port}/callback/`,
        close: () => {
          if (!settled) {
            settled = true;
            if (timer) clearTimeout(timer);
            server.close();
          }
        },
        result: resultPromise,
      });
    });

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(
          new CliError("Timed out waiting for the Oura authorization callback", {
            hint: "Re-run: oura auth login",
          }),
        );
      }
    }, opts.timeoutMs);
    timer.unref();
  });
}

export interface ManualOAuthOptions extends OAuthFlowOptions {
  /** Override for tests. */
  readLine?: (prompt: string) => Promise<string>;
}

function defaultReadLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Extract the OAuth `code` (and optional `state`) from a pasted value.
 * Accepts a full redirect URL or a bare code string.
 */
export function extractCodeAndState(pasted: string): { code: string | null; state: string | null } {
  const trimmed = pasted.trim();
  if (!trimmed) return { code: null, state: null };
  if (trimmed.includes("code=")) {
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `http://localhost/${trimmed}`);
      return {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      };
    } catch {
      return { code: null, state: null };
    }
  }
  // Bare code: must look like a code (no whitespace).
  return /\s/u.test(trimmed) ? { code: null, state: null } : { code: trimmed, state: null };
}

/**
 * Try to extract OAuth scope names from a pasted redirect URL.
 * Returns an empty array when no scope param is present.
 */
function extractScopesFromPasted(pasted: string): string[] {
  const trimmed = pasted.trim();
  if (!trimmed.includes("scope=")) return [];
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `http://localhost/${trimmed}`);
    const scopeParam = url.searchParams.get("scope");
    return scopeParam ? scopeParam.split(" ").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Headless/remote-friendly flow: print the authorize URL, read back the
 * redirect URL (or code) pasted from a browser on another machine, and
 * exchange it. The browser's localhost redirect never needs to reach this
 * machine — the user copies the URL from their address bar instead.
 */
export async function runManualOAuthFlow(opts: ManualOAuthOptions): Promise<OAuthFlowResult> {
  const { clientId, clientSecret } = opts;
  const port = opts.port ?? DEFAULT_PORT;
  const state = randomBytes(16).toString("hex");
  const redirectUri = loopbackRedirectUri(port);
  const scopes = opts.scopes ?? [];

  const authUrl = buildAuthorizeUrl({ clientId, redirectUri, state, scopes });
  await preflightAuthorize(authUrl, opts.fetcher);

  process.stderr.write(`Authorize in your browser (any machine):\n  ${authUrl}\n`);
  process.stderr.write(
    `After approving, your browser will try to open localhost:9876 — that's expected to fail.\n`,
  );
  process.stderr.write(
    `Copy the full URL from the address bar (or just the code) and paste it here.\n`,
  );

  const readLine = opts.readLine ?? defaultReadLine;
  const pasted = await readLine("Paste the redirect URL or code: ");
  const { code, state: pastedState } = extractCodeAndState(pasted);

  if (pastedState && pastedState !== state) {
    throw new CliError("The pasted URL is from a different auth session (state mismatch)", {
      hint: "Use the URL printed by THIS run of 'oura auth login --manual'",
    });
  }
  if (!code) {
    throw new CliError("No authorization code found in the pasted value", {
      hint: "Copy the full URL your browser redirected to — it contains code=...",
    });
  }

  const tokens = await exchangeCode({
    code,
    redirectUri,
    clientId,
    clientSecret,
    fetcher: opts.fetcher,
  });
  // Parse scopes from the pasted value when present (normal loopback flow
  // already captures them; manual flow users can paste the scope-bearing URL).
  const grantedScopes = extractScopesFromPasted(pasted);
  return { tokens, grantedScopes };
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<OuraTokens> {
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new CliError(`Token exchange failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as OuraTokens;
}

/**
 * Best-effort browser open. Never blocks: spawns the opener detached so a
 * hung or missing browser can't stall the auth flow. Skips entirely on
 * headless Linux (no display) — runOAuthFlow always prints the URL anyway.
 */
export function defaultOpenBrowser(url: string): void {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return;
  }
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // The URL is always printed by runOAuthFlow.
  }
}

/**
 * Full loopback authorization-code flow.
 *
 * 1. Preflight the authorize URL (catch unregistered redirect URIs early)
 * 2. Bind localhost callback server, validate state on callback
 * 3. Open the browser (or print URL for headless)
 * 4. Exchange the code for tokens; return them + granted scopes
 *
 * Token persistence is left to the caller (store.save).
 */
export async function runOAuthFlow(opts: OAuthFlowOptions): Promise<OAuthFlowResult> {
  const { clientId, clientSecret } = opts;
  const port = opts.port ?? DEFAULT_PORT;
  const state = randomBytes(16).toString("hex");
  const redirectUri = loopbackRedirectUri(port);
  const scopes = opts.scopes ?? [];

  const authUrl = buildAuthorizeUrl({ clientId, redirectUri, state, scopes });
  await preflightAuthorize(authUrl, opts.fetcher);

  // Always surface the URL on stderr so headless/SSH users can open it
  // manually (and port-forward the callback).
  process.stderr.write(`Open this URL in your browser to authorize oura:\n  ${authUrl}\n`);

  const openBrowser = opts.openBrowser ?? defaultOpenBrowser;
  openBrowser(authUrl);
  process.stderr.write(`Waiting for the authorization redirect on ${redirectUri}...\n`);

  const server = await startCallbackServer({
    port,
    expectedState: state,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });
  const result = await server.result;

  if (result.state !== state) {
    throw new CliError("Invalid state parameter — possible CSRF attack", {
      hint: "Re-run: oura auth login",
    });
  }
  if (result.error) {
    throw new CliError(`Authorization failed: ${result.error}`);
  }
  if (!result.code) {
    throw new CliError("No authorization code received from Oura");
  }

  const tokens = await exchangeCode({
    code: result.code,
    redirectUri,
    clientId,
    clientSecret,
    fetcher: opts.fetcher,
  });

  return {
    tokens,
    grantedScopes: parseGrantedScopes(result.scope ?? null),
  };
}

/** Best-effort token revocation on logout (current IdP first, legacy fallback). */
export async function revokeTokens(opts: {
  accessToken: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const fetcher = opts.fetcher ?? fetch;
  const urls = [REVOKE_URL, "https://api.ouraring.com/oauth/revoke"];
  for (const url of urls) {
    try {
      await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: opts.accessToken,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          token_type_hint: "access_token",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      break; // first endpoint that accepts the request wins
    } catch {
      // Best-effort only — local credential clearing is the source of truth.
    }
  }
}
