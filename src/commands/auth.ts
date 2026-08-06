import { createInterface } from "node:readline";
import { createContext } from "../cli/context.js";
import type { CredentialStore } from "../config/credentials.js";
import { DEFAULT_PORT, revokeTokens, runManualOAuthFlow, runOAuthFlow } from "../oauth/flow.js";
import { REQUESTED_SCOPES } from "../oauth/scopes.js";
import { logInfo, logSuccess, output } from "../output/index.js";
import type { StoredCredentials } from "../types.js";
import { AuthError, CliError } from "../utils/errors.js";

export interface AuthDeps {
  env: Record<string, string | undefined>;
  store: CredentialStore;
  /** Override for tests. */
  fetcher?: typeof fetch;
  openBrowser?: (url: string) => void;
  argv?: string[];
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function mask(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function requireClientCredentials(
  deps: AuthDeps,
): Promise<{ clientId: string; clientSecret: string }> {
  let clientId = deps.env.OURA_CLIENT_ID;
  let clientSecret = deps.env.OURA_CLIENT_SECRET;

  if (!clientId && !deps.env.OURA_NONINTERACTIVE) {
    clientId = await prompt("Oura client ID: ");
  }
  if (!clientSecret && !deps.env.OURA_NONINTERACTIVE) {
    clientSecret = await prompt("Oura client secret: ");
  }

  if (!clientId || !clientSecret) {
    throw new CliError("Missing Oura OAuth app credentials", {
      hint: "Set OURA_CLIENT_ID and OURA_CLIENT_SECRET env vars (or run interactively)",
    });
  }
  return { clientId, clientSecret };
}

/** `oura auth login` — run the OAuth loopback flow and persist tokens. */
export async function cmdAuthLogin(
  deps: AuthDeps,
  opts: { port?: number; useConfig?: boolean; noBrowser?: boolean; manual?: boolean },
): Promise<void> {
  const ctx = createContext(deps.argv ?? process.argv, deps.env);
  const { clientId, clientSecret } = await requireClientCredentials(deps);

  const port = opts.port ?? DEFAULT_PORT;
  const flowOpts = {
    clientId,
    clientSecret,
    port,
    scopes: REQUESTED_SCOPES,
    fetcher: deps.fetcher,
  };

  // Headless-friendly: print URL, paste back the redirect URL/code.
  const result = opts.manual
    ? await runManualOAuthFlow(flowOpts)
    : await runOAuthFlow({
        ...flowOpts,
        openBrowser: opts.noBrowser ? () => {} : deps.openBrowser,
      });

  const creds: StoredCredentials = {
    accessToken: result.tokens.access_token,
    refreshToken: result.tokens.refresh_token,
    grantedScopes: result.grantedScopes,
    expiresAt: Date.now() + result.tokens.expires_in * 1000,
    clientId,
    clientSecret,
    updatedAt: Date.now(),
  };
  await deps.store.save(creds);

  logInfo(ctx, `Granted scopes: ${result.grantedScopes.join(", ") || "(none)"}`);
  logSuccess(ctx, "Authorized — tokens stored");
  output(ctx, {
    ok: true,
    grantedScopes: result.grantedScopes,
    expiresAt: creds.expiresAt,
  });
}

/** `oura auth status` — report credential source, scopes, expiry. */
export async function cmdAuthStatus(deps: AuthDeps): Promise<void> {
  const ctx = createContext(deps.argv ?? process.argv, deps.env);
  const creds = await deps.store.load();
  const envConfigured = Boolean(deps.env.OURA_ACCESS_TOKEN && deps.env.OURA_REFRESH_TOKEN);

  const status = {
    configured: envConfigured || creds !== null,
    source: envConfigured ? "env" : creds ? "keyring/config" : null,
    accessToken: envConfigured
      ? mask(deps.env.OURA_ACCESS_TOKEN)
      : creds
        ? mask(creds.accessToken)
        : null,
    grantedScopes: creds?.grantedScopes ?? [],
    expiresAt: creds?.expiresAt ?? null,
    expired:
      creds?.expiresAt !== undefined && creds.expiresAt !== null
        ? Date.now() > creds.expiresAt
        : null,
  };
  output(ctx, status);
}

/** `oura auth logout` — revoke (best-effort) and clear local tokens. */
export async function cmdAuthLogout(deps: AuthDeps): Promise<void> {
  const ctx = createContext(deps.argv ?? process.argv, deps.env);
  const creds = await deps.store.load();
  if (creds) {
    if (creds.clientId && creds.clientSecret) {
      await revokeTokens({
        accessToken: creds.accessToken,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        fetcher: deps.fetcher,
      });
    }
    await deps.store.clear();
    logSuccess(ctx, "Logged out — credentials cleared");
    return;
  }
  if (deps.env.OURA_ACCESS_TOKEN) {
    throw new CliError(
      "Credentials come from environment variables — unset OURA_ACCESS_TOKEN / OURA_REFRESH_TOKEN to log out",
    );
  }
  throw new AuthError("Not logged in", "Run: oura auth login");
}
