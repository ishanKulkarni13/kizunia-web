/**
 * Subscription Phase II boundary guard.
 *
 * ESLint (`eslint.config.mjs`) enforces the import rules on every lint run;
 * this test states the same invariants as executable acceptance criteria, and
 * adds the ones a lint rule cannot express (no plan literals, no direct reads
 * of the grant table, rate limiting untouched):
 *
 * - `@/lib/entitlements` is the single source of truth: feature code asks
 *   capability/quota questions and never names a plan (SB-PL-02);
 * - no feature module reads subscription state from Prisma directly;
 * - no Razorpay or billing import reaches a feature module — so paid
 *   subscriptions can arrive in Phase III as one more resolver source with no
 *   feature code changing;
 * - rate limiting stays on its synchronous default tier (IB-3).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/** The feature modules Phase II integrates with entitlements. */
const FEATURE_ROOTS = [
  "modules/projects",
  "modules/portfolio",
  "modules/notifications",
  "modules/preferences",
  "modules/mcp",
  "modules/recommendations",
  "components/preferences",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }

  return out;
}

function sources(roots: readonly string[]): { file: string; text: string }[] {
  return roots.flatMap((root) =>
    walk(join(SRC, root)).map((path) => ({
      file: relative(SRC, path).split(sep).join("/"),
      text: readFileSync(path, "utf8"),
    })),
  );
}

/** Strips comments, so prose mentioning a plan does not trip a code check. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offenders(pattern: RegExp, roots: readonly string[] = FEATURE_ROOTS): string[] {
  return sources(roots)
    .filter(({ text }) => pattern.test(code(text)))
    .map(({ file }) => file);
}

describe("feature modules consume entitlements through one seam", () => {
  it("scans a meaningful number of files (the guard itself is not vacuous)", () => {
    expect(sources(FEATURE_ROOTS).length).toBeGreaterThan(100);
  });

  it("never import Razorpay", () => {
    expect(offenders(/razorpay/i)).toEqual([]);
  });

  it("never import the billing module", () => {
    expect(offenders(/@\/modules\/billing/)).toEqual([]);
  });

  it("never name the stored plan enum", () => {
    expect(offenders(/\bMembershipPlan\b/)).toEqual([]);
  });

  it("never compare against or branch on a plan literal", () => {
    // `"FREE"` is deliberately not matched: it is also a competition's
    // registration fee type. `EffectivePlan.FREE` below covers the plan.
    expect(offenders(/["'`](PRO|PRO_PLUS)["'`]/)).toEqual([]);
    expect(offenders(/\bEffectivePlan\.(FREE|PRO|PRO_PLUS)\b/)).toEqual([]);
    expect(offenders(/\bplan\s*(===|!==|==|!=)/)).toEqual([]);
  });

  it("never read the grant tables directly (the resolver is the single source of truth)", () => {
    expect(offenders(/\bentitlementGrant\b|\bgrantAuditEntry\b/)).toEqual([]);
  });

  it("never build a second capability catalog or plan resolver", () => {
    expect(offenders(/\bPLAN_CATALOG\b|\bmaxPlan\b|\bplanHasCapability\b/)).toEqual([]);
  });
});

describe("rate limiting is untouched by entitlements (IB-3)", () => {
  it("does not use the per-user resolver, so no request pays a database read for it", () => {
    expect(offenders(/resolveEffectiveAccess|hasCapability|getQuota|entitledUsersWhere/, ["lib/rate-limit"])).toEqual(
      [],
    );
  });

  it("still resolves the synchronous default tier", async () => {
    const { resolveEntitlements } = await import("./index");

    expect(resolveEntitlements()).toEqual({ tier: "default" });
  });
});

describe("the entitlement read side never depends on billing or a provider", () => {
  it("lib/entitlements imports neither modules/billing nor razorpay", () => {
    expect(offenders(/razorpay/i, ["lib/entitlements"])).toEqual([]);
    expect(offenders(/@\/modules\/billing/, ["lib/entitlements"])).toEqual([]);
  });
});
