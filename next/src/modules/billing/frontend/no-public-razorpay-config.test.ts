/**
 * The TEST/LIVE seam stays on the server (checkout-flow.md): Razorpay
 * Checkout gets its key from the checkout response, so no
 * `NEXT_PUBLIC_RAZORPAY_*` variable may exist. A `NEXT_PUBLIC_` variable is
 * inlined into the browser bundle at build time, which would let a build pick
 * the provider mode and would put Razorpay configuration in every page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FORBIDDEN = /NEXT_PUBLIC_RAZORPAY/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) return [];

    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("no NEXT_PUBLIC_RAZORPAY_* configuration", () => {
  it("is not referenced anywhere in src (this test excepted)", () => {
    const offenders = filesUnder(join(ROOT, "src"))
      .filter((path) => /\.(ts|tsx|js|jsx|mjs)$/.test(path) && !path.endsWith("no-public-razorpay-config.test.ts"))
      .filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("is not declared in .env.example", () => {
    expect(readFileSync(join(ROOT, ".env.example"), "utf8")).not.toMatch(FORBIDDEN);
  });
});
