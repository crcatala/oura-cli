import { OuraClient } from "./api/client.js";
import { createContext } from "./cli/context.js";
import { buildProgram } from "./cli/program.js";
import { createStore, resolveCredentials } from "./config/credentials.js";
import { logVerbose, outputError, setOutputStream } from "./output/index.js";
import type { OuraTokens } from "./types.js";
import { UsageError } from "./utils/errors.js";

export interface MainOptions {
  /** Override for tests. */
  fetcher?: typeof fetch;
  openBrowser?: (url: string) => void;
  /** Override for tests. */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export async function main(
  argv = process.argv,
  env = process.env,
  opts: MainOptions = {},
): Promise<number> {
  const ctx = createContext(argv, env);
  if (opts.stdout || opts.stderr) {
    setOutputStream(opts.stdout ?? process.stdout, opts.stderr ?? process.stderr);
  }

  try {
    const sandbox = flag(argv, "--sandbox");
    const useConfig = flag(argv, "--use-config") || Boolean(env.OURA_USE_CONFIG);
    const configDir = env.OURA_CONFIG_DIR;

    // Help/version never need credentials or a keyring.
    const informational = argv.some((a) => ["--help", "-h", "--version", "-V"].includes(a));

    const store = informational
      ? createStore({ useConfig: true, configDir: configDir ?? "/tmp" })
      : createStore({ useConfig, configDir });
    // Sandbox data needs no credentials at all.
    const resolved: Awaited<ReturnType<typeof resolveCredentials>> =
      sandbox || informational
        ? { creds: null, clientId: undefined, clientSecret: undefined, source: null }
        : await resolveCredentials(env, store);

    if (ctx.output.verbose) {
      if (sandbox) {
        logVerbose(ctx, "Sandbox mode — no credentials");
      } else {
        logVerbose(ctx, `Credentials: source=${resolved.source ?? "none"}`);
      }
    }

    // Persist rotated refresh tokens back to the store only when the source
    // is the store (env-provided tokens stay ephemeral).
    const persistTokens =
      resolved.source !== "env" && resolved.creds
        ? async (tokens: OuraTokens): Promise<void> => {
            const existing = await store.load();
            // If the store was cleared between init and refresh, hold on to
            // the fields we already have instead of starting from scratch.
            const base = existing ?? {
              accessToken: resolved.creds!.accessToken,
              refreshToken: resolved.creds!.refreshToken,
              clientId: resolved.clientId,
              clientSecret: resolved.clientSecret,
              grantedScopes: resolved.creds!.grantedScopes,
              expiresAt: resolved.creds!.expiresAt,
              updatedAt: resolved.creds!.updatedAt,
            };
            await store.save({
              ...base,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: Date.now() + tokens.expires_in * 1000,
              updatedAt: Date.now(),
            });
          }
        : undefined;

    const client = new OuraClient({
      accessToken: resolved.creds?.accessToken ?? "",
      refreshToken: resolved.creds?.refreshToken,
      clientId: resolved.clientId,
      clientSecret: resolved.clientSecret,
      persistTokens,
      sandbox,
      fetcher: opts.fetcher,
    });

    const program = buildProgram({
      ctx,
      client,
      auth: { env, store, fetcher: opts.fetcher, openBrowser: opts.openBrowser, argv },
    });
    program.exitOverride();

    // argv is already user args (run.ts slices the node/script prefix).
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    // Convert Commander usage errors (unknown options, etc.) to our
    // clig.dev-compliant exit-code-2 + JSON-envelope contract.
    // Help/version (exitOverride with exitCode 0) pass through directly.
    if (isCommanderError(err)) {
      const exit = (err as { exitCode?: number }).exitCode ?? 1;
      if (exit === 0) return 0; // --help, --version
      const msg =
        err.code === "commander.unknownOption" ? err.message : `Invalid usage: ${err.message}`;
      outputError(ctx, new UsageError(msg));
      return 2;
    }
    outputError(ctx, err);
    const exitCode =
      err && typeof err === "object" && "exitCode" in err
        ? ((err as { exitCode: number }).exitCode ?? 1)
        : 1;
    return exitCode;
  }
}

function isCommanderError(err: unknown): err is Error & { code: string } {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("commander.");
}
