import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runUpdate = vi.hoisted(() => vi.fn());
const resolveCredentials = vi.hoisted(() => vi.fn());

vi.mock("../../src/cli-meta.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cli-meta.js")>()),
  runUpdate,
}));
vi.mock("../../src/config/credentials.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/credentials.js")>();
  resolveCredentials.mockImplementation(actual.resolveCredentials);
  return { ...actual, resolveCredentials };
});

const { main } = await import("../../src/cli-main.js");

const sink = { write: () => true } as unknown as NodeJS.WritableStream;
const env = () => ({
  OURA_CONFIG_DIR: join(mkdtempSync(join(tmpdir(), "oura-cli-update-")), "config"),
});

describe("oura update", () => {
  beforeEach(() => {
    runUpdate.mockReset();
    resolveCredentials.mockClear();
  });

  it.each([
    [["update"]],
    [["update", "--check"]],
    [["update", "--force"]],
    [["--verbose", "update", "--check"]],
  ])("%j never loads credentials", async (argv) => {
    runUpdate.mockReturnValue(0);
    expect(await main(argv, env(), { stdout: sink, stderr: sink })).toBe(0);
    expect(runUpdate).toHaveBeenCalledOnce();
    expect(resolveCredentials).not.toHaveBeenCalled();
  });

  it("passes --check and --force through to runUpdate", async () => {
    runUpdate.mockReturnValue(0);
    await main(["update", "--check", "--force"], env(), { stdout: sink, stderr: sink });
    expect(runUpdate).toHaveBeenCalledWith(
      "oura",
      expect.objectContaining({ check: true, force: true }),
    );
  });

  it.each([1, 2])("returns the update exit code %i from main()", async (code) => {
    runUpdate.mockReturnValue(code);
    expect(await main(["update", "--check"], env(), { stdout: sink, stderr: sink })).toBe(code);
  });

  it("still loads credentials for data commands", async () => {
    await main(["profile", "--json"], env(), { stdout: sink, stderr: sink });
    expect(resolveCredentials).toHaveBeenCalledOnce();
  });
});
