import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration test config. Discovers `*.integration.test.ts` under `src/`
 * — tests allowed to hit a real Postgres database. `setupFiles` enforces
 * DATABASE_TEST_URL before any test (or its imports, including
 * `@/lib/prisma`) runs; see src/testing/setup/integration-env.ts and
 * docs/testing/database.md. Run via `pnpm test:integration`.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["./src/testing/setup/integration-env.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
