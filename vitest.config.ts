import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live tests require real Oura credentials; gated separately via test:live
    exclude: ["tests/live/**"],
  },
});
