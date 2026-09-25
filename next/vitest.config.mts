import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Repo-wide unit test config. Discovers every `*.test.ts` under `src/`.
 * `*.integration.test.ts` files are excluded here — they're allowed to hit
 * a real Postgres database and run separately via
 * vitest.integration.config.mts (`pnpm test:integration`), so this default
 * config (`pnpm test`) never requires a database. See docs/testing/README.md.
 *
 * `*.contract.test.ts` files are excluded too: they call a real third-party API
 * (Razorpay TEST) and are opt-in, run only by `pnpm test:contract`
 * (vitest.contract.config.mts). They must never run here, and never in CI by
 * default.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "**/*.contract.test.ts", "**/node_modules/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
