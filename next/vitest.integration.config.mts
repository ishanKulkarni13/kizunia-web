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
    /**
     * One file at a time.
     *
     * Every integration test shares one database. Most isolate themselves with
     * a unique key prefix, which is enough while a test only ever reads back
     * rows it created. It stops being enough for the work queue: claiming is a
     * *global* operation over whatever is due, so a job another file created
     * concurrently is genuinely indistinguishable from one under test.
     *
     * The suite runs in a few seconds, so serialising files costs almost
     * nothing and removes a whole category of flake that would otherwise
     * surface as an occasional, unreproducible failure in the concurrency
     * tests — the exact place a spurious failure is most expensive, because it
     * is where a real one would matter most.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
