import { join } from "node:path";
import type { StoredCredentials } from "../types.js";
import { defaultConfigDir, JsonFileStore } from "./config.js";

const SERVICE_NAME = "oura-cli";
const ACCOUNT_NAME = "oauth";
const CONFIG_FILE = "credentials.json";

export type CredentialSource = "env" | "keyring" | "config" | null;

export interface ResolvedCredentials {
  creds: StoredCredentials | null;
  clientId?: string;
  clientSecret?: string;
  source: CredentialSource;
}

/**
 * Lazy-load keytar so the config-file fallback works without native deps,
 * and so commands that never touch credentials (--help, env-token data
 * commands) never pay for the native module.
 */
async function getKeytar() {
  try {
    const mod = await import("keytar");
    // CJS interop: keytar may expose the API directly or under .default
    const kt = (mod as { default?: unknown }).default ?? mod;
    return kt as {
      getPassword: (service: string, account: string) => Promise<string | null>;
      setPassword: (service: string, account: string, password: string) => Promise<void>;
      deletePassword: (service: string, account: string) => Promise<boolean>;
    };
  } catch {
    return null;
  }
}

export function configFileStore(configDir?: string): JsonFileStore<StoredCredentials> {
  return new JsonFileStore<StoredCredentials>(join(configDir ?? defaultConfigDir(), CONFIG_FILE));
}

export interface CredentialStore {
  /** Actual backend type, set after lazy resolution. */
  type: CredentialSource;
  load: () => Promise<StoredCredentials | null>;
  save: (creds: StoredCredentials) => Promise<void>;
  clear: () => Promise<void>;
}

/**
 * Headless Linux (no DISPLAY/WAYLAND) almost never has a usable Secret
 * Service; skip the native keytar import to avoid GLib D-Bus noise and
 * fall straight to the 0600 config file.
 */
function keyringLikelyAvailable(): boolean {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false;
  }
  return true;
}

function storeFromFile(file: JsonFileStore<StoredCredentials>): CredentialStore {
  return {
    type: "config",
    load: () => Promise.resolve(file.load()),
    save: async (c) => file.save(c),
    clear: async () => file.clear(),
  };
}

async function resolveBackingStore(configDir?: string): Promise<CredentialStore> {
  if (!keyringLikelyAvailable()) {
    return storeFromFile(configFileStore(configDir));
  }
  const keytar = await getKeytar();
  if (!keytar) return storeFromFile(configFileStore(configDir));
  return {
    type: "keyring",
    load: async () => {
      const raw = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      return raw ? (JSON.parse(raw) as StoredCredentials) : null;
    },
    save: async (creds) => {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, JSON.stringify(creds));
    },
    clear: async () => {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    },
  };
}

/**
 * Build a CredentialStore.
 * - `useConfig: true` → the 0600 config file (headless / explicit choice)
 * - otherwise → OS keyring, falling back to the config file when the
 *   keyring is unavailable (resolved lazily on first use)
 */
export function createStore(opts: { useConfig?: boolean; configDir?: string }): CredentialStore {
  if (opts.useConfig) {
    return storeFromFile(configFileStore(opts.configDir));
  }
  // Lazily resolve the backing store on first use, so commands that never
  // touch credentials (--help, env-token data commands) never load keytar.
  let backing: Promise<CredentialStore> | null = null;
  let resolved: CredentialStore | null = null;
  const get = () => (backing ??= resolveBackingStore(opts.configDir));
  const resolve = async (): Promise<CredentialStore> => {
    resolved ??= await get();
    return resolved;
  };
  return {
    get type() {
      // Accurate after the first load/save/clear resolves the backend.
      return resolved ? resolved.type : "config";
    },
    load: async () => (await resolve()).load(),
    save: async (c) => (await resolve()).save(c),
    clear: async () => (await resolve()).clear(),
  };
}

/**
 * Resolve credentials with documented precedence:
 *   env (OURA_ACCESS_TOKEN + OURA_REFRESH_TOKEN) > store (keyring/config)
 * Client id/secret likewise: env > store.
 */
export async function resolveCredentials(
  env: Record<string, string | undefined>,
  store: CredentialStore,
): Promise<ResolvedCredentials> {
  const envAccess = env.OURA_ACCESS_TOKEN;
  const envRefresh = env.OURA_REFRESH_TOKEN;

  if (envAccess && envRefresh) {
    return {
      creds: {
        accessToken: envAccess,
        refreshToken: envRefresh,
        updatedAt: Date.now(),
      },
      clientId: env.OURA_CLIENT_ID,
      clientSecret: env.OURA_CLIENT_SECRET,
      source: "env",
    };
  }

  const stored = await store.load();
  if (stored) {
    return {
      creds: stored,
      clientId: env.OURA_CLIENT_ID ?? stored.clientId,
      clientSecret: env.OURA_CLIENT_SECRET ?? stored.clientSecret,
      source: store.type ?? "config",
    };
  }

  return {
    creds: null,
    clientId: env.OURA_CLIENT_ID,
    clientSecret: env.OURA_CLIENT_SECRET,
    source: null,
  };
}
