import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live tests are opt-in (OURA_LIVE_TESTS=1) and gated per-suite with
    // describe.skipIf, so `npm test` discovers but skips them; `npm run
    // test:live` runs them for real after require-live-test-env.mjs.
  },
});
