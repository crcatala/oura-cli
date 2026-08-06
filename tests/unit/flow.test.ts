import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCode,
  extractCodeAndState,
  preflightAuthorize,
  runManualOAuthFlow,
  runOAuthFlow,
  startCallbackServer,
} from "../../src/oauth/flow.js";
import { REQUESTED_SCOPES } from "../../src/oauth/scopes.js";
import { CliError } from "../../src/utils/errors.js";

const REDIRECT = "http://localhost:9876/callback/";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

describe("buildAuthorizeUrl", () => {
  it("includes exact query params", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: REDIRECT,
        state: "s3cr3t",
        scopes: REQUESTED_SCOPES,
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("s3cr3t");
    expect(url.searchParams.get("scope")).toContain("extapi:daily");
    // Current IdP: extapi:-prefixed scopes; legacy names must never appear.
    expect(url.searchParams.get("scope")).not.toContain("spo2Daily");
    expect(url.searchParams.get("scope")).not.toMatch(/\b(sleep|readiness)\b/);
  });
});

describe("preflightAuthorize", () => {
  it("passes on redirect (3xx)", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(
      preflightAuthorize("https://cloud.ouraring.com/oauth/authorize?x=1", fetcher),
    ).resolves.not.toThrow();
  });

  it("throws on 4xx (unregistered redirect URI)", async () => {
    const fetcher = vi.fn(async () => new Response("bad redirect", { status: 400 }));
    await expect(
      preflightAuthorize("https://cloud.ouraring.com/oauth/authorize?x=1", fetcher),
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe("startCallbackServer", () => {
  it("resolves with the code when state matches", async () => {
    const port = await freePort();
    const server = await startCallbackServer({ port, expectedState: "abc", timeoutMs: 10_000 });
    try {
      const res = await fetch(`${server.url}?code=CODE123&state=abc&scope=daily+personal`);
      expect(res.status).toBe(200);
      const result = await server.result;
      expect(result.code).toBe("CODE123");
      expect(result.scope).toBe("daily personal");
    } finally {
      server.close();
    }
  });

  it("rejects tampered state (CSRF)", async () => {
    const port = await freePort();
    const server = await startCallbackServer({ port, expectedState: "abc", timeoutMs: 10_000 });
    try {
      const res = await fetch(`${server.url}?code=CODE999&state=EVIL`);
      expect(res.status).toBe(403);
      const result = await server.result;
      expect(result.state).toBe("EVIL");
      // Caller is responsible for rejecting mismatched state after the fact —
      // but flow.ts's runOAuthFlow checks state before exchange, covered below.
      expect(result.code).toBe("CODE999");
    } finally {
      server.close();
    }
  });
});

describe("runOAuthFlow (end-to-end loopback)", () => {
  it("completes: preflight → browser → callback → token exchange", async () => {
    const port = await freePort();

    // Mock fetcher: authorize URL redirects; token endpoint returns tokens.
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://cloud.ouraring.com/oauth/authorize")) {
        return new Response(null, { status: 302 });
      }
      if (url === "https://moi.ouraring.com/oauth/v2/ext/oauth-token") {
        expect(String(init?.body)).toContain("grant_type=authorization_code");
        return new Response(
          JSON.stringify({
            token_type: "bearer",
            access_token: "AT",
            refresh_token: "RT",
            expires_in: 86400,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 500 });
    });

    const openBrowser = vi.fn();
    const flowPromise = runOAuthFlow({
      clientId: "cid",
      clientSecret: "cs",
      port,
      scopes: REQUESTED_SCOPES,
      fetcher,
      openBrowser,
      timeoutMs: 15_000,
    });

    // Emulate the browser redirect; state comes from the captured auth URL.
    // openBrowser fires after the preflight await, so wait for the call.
    await vi.waitFor(() => {
      expect(openBrowser).toHaveBeenCalled();
    });
    const authUrl = openBrowser.mock.calls[0][0] as string;
    const state = new URL(authUrl).searchParams.get("state") ?? "";
    const res = await fetch(
      `http://localhost:${port}/callback/?code=CODE&state=${state}&scope=daily`,
    );
    expect(res.status).toBe(200);

    const result = await flowPromise;
    expect(result.tokens.access_token).toBe("AT");
    expect(result.tokens.refresh_token).toBe("RT");
    expect(result.grantedScopes).toEqual(["daily"]);
  });

  it("fails fast when preflight rejects", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(
      runOAuthFlow({
        clientId: "cid",
        clientSecret: "cs",
        scopes: [],
        fetcher,
        openBrowser: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(CliError);
    // Browser must never open on a bad client config.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("extractCodeAndState", () => {
  it("parses a full redirect URL", () => {
    const { code, state } = extractCodeAndState(
      "http://localhost:9876/callback/?code=ABC123&scope=daily&state=xyz",
    );
    expect(code).toBe("ABC123");
    expect(state).toBe("xyz");
  });

  it("accepts a bare code", () => {
    expect(extractCodeAndState("ABC123").code).toBe("ABC123");
  });

  it("returns nulls for garbage", () => {
    expect(extractCodeAndState("").code).toBeNull();
    expect(extractCodeAndState("no code here").code).toBeNull();
  });
});

describe("runManualOAuthFlow", () => {
  it("exchanges a pasted redirect URL", async () => {
    const stderrChunks: string[] = [];
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });
    try {
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://cloud.ouraring.com/oauth/authorize"))
          return new Response(null, { status: 302 });
        if (url === "https://moi.ouraring.com/oauth/v2/ext/oauth-token") {
          expect(String(init?.body)).toContain("grant_type=authorization_code");
          return new Response(
            JSON.stringify({
              access_token: "at",
              refresh_token: "rt",
              token_type: "bearer",
              expires_in: 1,
            }),
            { status: 200 },
          );
        }
        return new Response("unexpected", { status: 500 });
      });

      const flowPromise = runManualOAuthFlow({
        clientId: "cid",
        clientSecret: "cs",
        scopes: REQUESTED_SCOPES,
        fetcher,
        readLine: async () => {
          // Build the pasted URL from the URL the flow printed (real state).
          const printed =
            stderrChunks.find((c) => c.includes("https://cloud.ouraring.com/oauth/authorize")) ??
            "";
          const authUrl =
            printed.match(/https:\/\/cloud\.ouraring\.com\/oauth\/authorize\S+/u)?.[0] ?? "";
          const state = new URL(authUrl).searchParams.get("state") ?? "";
          return `http://localhost:9876/callback/?code=PASTE1&state=${state}`;
        },
      });

      const result = await flowPromise;
      expect(result.tokens.access_token).toBe("at");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("rejects a URL from a different session (state mismatch)", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(
      runManualOAuthFlow({
        clientId: "cid",
        clientSecret: "cs",
        scopes: [],
        fetcher,
        readLine: async () => "http://localhost:9876/callback/?code=X&state=WRONG",
      }),
    ).rejects.toThrow(/state mismatch/);
  });

  it("errors when no code is pasted", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(
      runManualOAuthFlow({
        clientId: "c",
        clientSecret: "s",
        scopes: [],
        fetcher,
        readLine: async () => "",
      }),
    ).rejects.toThrow(/No authorization code/);
  });
});

describe("exchangeCode", () => {
  it("posts form-encoded body", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body);
      expect(body).toContain("code=ABC");
      expect(body).toContain("client_id=cid");
      return new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt",
          token_type: "bearer",
          expires_in: 1,
        }),
        {
          status: 200,
        },
      );
    });
    const tokens = await exchangeCode({
      code: "ABC",
      redirectUri: REDIRECT,
      clientId: "cid",
      clientSecret: "cs",
      fetcher,
    });
    expect(tokens.access_token).toBe("at");
  });
});
