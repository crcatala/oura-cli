import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, resolveCredentials } from "../../src/config/credentials.js";
import type { StoredCredentials } from "../../src/types.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "oura-cli-test-"));
  dirs.push(d);
  return d;
}

afterEach(() => {});

const creds: StoredCredentials = {
  accessToken: "AT",
  refreshToken: "RT",
  grantedScopes: ["daily", "personal"],
  expiresAt: Date.now() + 3600_000,
  clientId: "cid",
  clientSecret: "cs",
  updatedAt: Date.now(),
};

describe("config-file credential store", () => {
  it("round-trips credentials", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    await store.save(creds);
    const loaded = await store.load();
    expect(loaded).toEqual(creds);
  });

  it("writes 0600 permissions", async () => {
    const dir = tempDir();
    const store = createStore({ useConfig: true, configDir: dir });
    await store.save(creds);
    const file = join(dir, "credentials.json");
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("clears credentials", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    await store.save(creds);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("returns null when empty", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    expect(await store.load()).toBeNull();
  });
});

describe("resolveCredentials", () => {
  it("prefers env tokens over the store", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    await store.save(creds);
    const resolved = await resolveCredentials(
      { OURA_ACCESS_TOKEN: "env-at", OURA_REFRESH_TOKEN: "env-rt", OURA_CLIENT_ID: "env-cid" },
      store,
    );
    expect(resolved.source).toBe("env");
    expect(resolved.creds?.accessToken).toBe("env-at");
    expect(resolved.clientId).toBe("env-cid");
  });

  it("falls back to the store when env is absent", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    await store.save(creds);
    const resolved = await resolveCredentials({}, store);
    expect(resolved.source).toBe("config");
    expect(resolved.creds?.accessToken).toBe("AT");
    expect(resolved.clientId).toBe("cid");
  });

  it("returns null when nothing is configured", async () => {
    const store = createStore({ useConfig: true, configDir: tempDir() });
    const resolved = await resolveCredentials({}, store);
    expect(resolved.creds).toBeNull();
    expect(resolved.source).toBeNull();
  });
});
