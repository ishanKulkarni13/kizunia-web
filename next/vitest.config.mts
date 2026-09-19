import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Repo-wide unit test config. Discovers every `*.test.ts` under `src/`.
 * `*.integration.test.ts` files are excluded here — they're allowed to hit
 * a real Postgres database and run separately via
 * vitest.integration.config.mts (`pnpm test:integration`), so this default
 * config (`pnpm test`) never requires a database. See docs/testing/README.md.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
