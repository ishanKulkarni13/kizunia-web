import "dotenv/config";

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Provider contract suite config. Discovers `*.contract.test.ts` under `src/` —
 * tests that call a REAL third-party API (Razorpay, TEST mode) to check that
 * Kizunia's provider implementation still matches how the provider behaves.
 * Run via `pnpm test:contract`.
 *
 * Opt-in, and never part of `pnpm test`, `pnpm test:integration` or CI by
 * default: it needs network access and Razorpay TEST keys, it creates and then
 * cancels real TEST-mode subscriptions, and it is slow. Running this command IS
 * the opt-in, so it sets RAZORPAY_CONTRACT for the suite. The suite still
 * refuses to run against anything but an `rzp_test_` key.
 *
 * `dotenv/config` loads `.env`, so the keys an engineer already keeps there for
 * TEST are picked up (the same file `prisma.config.ts` reads). Nothing here
 * touches the database.
 *
 * See docs/architecture/subscription/implementation/test-strategy.md
 * (Provider-TEST) and the phase III document.
 */
process.env.RAZORPAY_CONTRACT ??= "1";

export default defineConfig({
  test: {
    include: ["src/**/*.contract.test.ts"],
    environment: "node",
    // A real network round trip per call, and some tests wait on the provider.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One at a time: the calls share one Razorpay account and its rate limit.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
