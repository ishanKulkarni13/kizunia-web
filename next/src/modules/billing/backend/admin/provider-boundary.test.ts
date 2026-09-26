/**
 * Phase VIII adds no provider work: explain, timeline, anomalies, bulk re-sync,
 * health and payload pruning read and write Kizunia's own tables only. Bulk
 * re-sync in particular marks rows due and lets the existing `billing:sync`
 * path do the fetching, inside its budget.
 *
 * ESLint already forbids Razorpay internals outside `provider/`; this pins the
 * stricter Phase VIII rule that these files do not even obtain a provider
 * (`getBillingProvider`, the provider factory) — so a future edit that makes a
 * "helpful" fetch here fails a test, not just a code review.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ADMIN_DIR = __dirname;
const BACKEND_DIR = join(__dirname, "..");

/** Non-test sources whose behavior must stay provider-free. */
function sources(): string[] {
  const admin = readdirSync(ADMIN_DIR)
    .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
    .map((file) => join(ADMIN_DIR, file));

  return [
    ...admin,
    join(BACKEND_DIR, "reconciliation", "payload-prune.ts"),
    join(BACKEND_DIR, "anomalies", "anomaly.repository.ts"),
  ].filter((path) => {
    try {
      readFileSync(path);
      return true;
    } catch {
      return false;
    }
  });
}

const FORBIDDEN = [
  /provider-factory/,
  /provider\/razorpay/,
  /getBillingProvider/,
  /budgeted-provider/,
  /from ["']razorpay["']/,
  /fake-provider/,
];

describe("Phase VIII provider boundary", () => {
  it("finds the admin sources it is meant to guard", () => {
    const names = sources().map((path) => path.split(/[\\/]/).pop());

    expect(names).toEqual(expect.arrayContaining(["bulk-resync.service.ts", "explain.service.ts", "timeline.service.ts"]));
  });

  it.each(sources().map((path) => [path.split(/[\\/]/).slice(-2).join("/"), path]))(
    "%s obtains no provider",
    (_name, path) => {
      const text = readFileSync(path, "utf8");

      for (const pattern of FORBIDDEN) expect(text, `${path} matches ${pattern}`).not.toMatch(pattern);
    },
  );
});
