/**
 * The subscription ESLint boundary, proven rather than assumed.
 *
 * A clean lint run only shows that no existing file breaks the rules; it says
 * nothing about whether the rules would catch a new violation. And flat config
 * has a trap that makes that a real risk: for a file matched by several config
 * objects, a later `no-restricted-imports` REPLACES an earlier one instead of
 * merging, so a careless edit can silently switch a restriction off.
 *
 * So this runs the repository's actual ESLint config over synthetic files at
 * realistic paths and asserts that each violation is rejected and each
 * legitimate import is still allowed.
 *
 * The boundary being enforced
 * (docs/architecture/subscription/implementation/architecture-fit.md):
 *  - only modules/billing, app routes and pages, and instrumentation.ts import billing;
 *  - Razorpay is private to modules/billing/provider: no `razorpay` package, no
 *    provider/razorpay/** import, no RAZORPAY_* variable outside it;
 *  - billing never imports feature modules;
 *  - the read side (lib/entitlements) never imports billing.
 */
import { join } from "node:path";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

let eslint: ESLint;

/** The boundary errors ESLint reports for `code` written at `path` (relative to the project root). */
async function boundaryErrors(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, path) });

  return result.messages
    .filter((message) => message.severity === 2 && message.ruleId !== null && RULES.has(message.ruleId))
    .map((message) => `${message.ruleId}: ${message.message}`);
}

beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT });

  // Loading the config (eslint-config-next and the TypeScript parser) is the
  // slow part; pay for it once, here.
  await boundaryErrors("src/lib/warm-up.ts", "export {};");
}, 120_000);

const RAZORPAY_PROVIDER = "@/modules/billing/provider/razorpay/razorpay-provider";

describe("Razorpay stays inside modules/billing/provider", () => {
  const importers: Array<[string, string]> = [
    ["a feature module", "src/modules/projects/backend/x.ts"],
    ["another feature module", "src/modules/notifications/delivery/x.ts"],
    ["a lib module", "src/lib/rate-limit/x.ts"],
    ["a component", "src/components/x.tsx"],
    ["an app route", "src/app/api/v1/x/route.ts"],
    ["an app page", "src/app/(dashboard)/x/page.tsx"],
    ["the boot hook", "src/instrumentation.ts"],
    ["the read side", "src/lib/entitlements/x.ts"],
    ["billing outside the provider", "src/modules/billing/backend/x.ts"],
    ["billing's budget adapters", "src/modules/billing/backend/budget/x.ts"],
    ["billing's config", "src/modules/billing/config/x.ts"],
  ];

  it.each(importers)("rejects the razorpay package from %s", async (_who, path) => {
    const errors = await boundaryErrors(path, 'import Razorpay from "razorpay";\nexport const x = Razorpay;');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Payment providers stay behind modules/billing/provider");
  });

  it.each(importers)("rejects provider/razorpay/** by alias from %s", async (_who, path) => {
    const errors = await boundaryErrors(path, `import { RazorpayBillingProvider } from "${RAZORPAY_PROVIDER}";\nexport const x = RazorpayBillingProvider;`);

    expect(errors.some((error) => error.includes("private to modules/billing/provider"))).toBe(true);
  });

  it("rejects provider/razorpay/** by relative path from billing outside the provider", async () => {
    for (const specifier of [
      "../../provider/razorpay/razorpay-provider",
      "../../provider/razorpay/signatures",
      "../provider/razorpay",
    ]) {
      const errors = await boundaryErrors(
        "src/modules/billing/backend/x.ts",
        `import * as x from "${specifier}";\nexport { x };`,
      );

      expect(errors.some((error) => error.includes("private to modules/billing/provider")), specifier).toBe(true);
    }
  });

  it("rejects deep and index imports of razorpay internals", async () => {
    for (const specifier of [
      "@/modules/billing/provider/razorpay",
      "@/modules/billing/provider/razorpay/mapping",
      "@/modules/billing/provider/razorpay/deeper/still",
    ]) {
      const errors = await boundaryErrors("src/modules/mcp/x.ts", `import * as x from "${specifier}";\nexport { x };`);

      expect(errors.length, specifier).toBeGreaterThan(0);
    }
  });

  it("allows the provider directory to use its own Razorpay code", async () => {
    for (const [path, specifier] of [
      ["src/modules/billing/provider/provider-factory.ts", "./razorpay/razorpay-provider"],
      ["src/modules/billing/provider/fake-provider.ts", "./razorpay/signatures"],
      ["src/modules/billing/provider/razorpay/razorpay-provider.ts", "./mapping"],
      ["src/modules/billing/provider/razorpay/razorpay-client.ts", "../../config/billing-config"],
    ] as const) {
      expect(await boundaryErrors(path, `import * as x from "${specifier}";\nexport { x };`), path).toEqual([]);
    }
  });
});

describe("no RAZORPAY_* variable is read outside the provider directory", () => {
  const readers: Array<[string, string]> = [
    ["a lib module", "src/lib/x.ts"],
    ["a feature module", "src/modules/portfolio/backend/x.ts"],
    ["an app route", "src/app/api/v1/x/route.ts"],
    ["billing outside the provider", "src/modules/billing/backend/x.ts"],
    ["the read side", "src/lib/entitlements/x.ts"],
    ["the boot hook", "src/instrumentation.ts"],
  ];

  it.each(readers)("rejects process.env.RAZORPAY_* in %s", async (_who, path) => {
    const errors = await boundaryErrors(path, "export const id = process.env.RAZORPAY_KEY_ID;");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("RAZORPAY_* variables are read only in modules/billing/provider");
  });

  it("rejects the bracket form", async () => {
    const errors = await boundaryErrors("src/lib/x.ts", 'export const s = process.env["RAZORPAY_KEY_SECRET"];');

    expect(errors).toHaveLength(1);
  });

  it("allows the provider directory to read them, and everyone to read other variables", async () => {
    expect(
      await boundaryErrors("src/modules/billing/provider/provider-mode.ts", "export const id = process.env.RAZORPAY_KEY_ID;"),
    ).toEqual([]);
    expect(
      await boundaryErrors("src/modules/billing/provider/razorpay/x.ts", 'export const s = process.env["RAZORPAY_KEY_SECRET"];'),
    ).toEqual([]);
    expect(await boundaryErrors("src/lib/x.ts", "export const e = process.env.NODE_ENV;")).toEqual([]);
    expect(await boundaryErrors("src/lib/x.ts", "export const e = process.env.BILLING_EXPECTED_MODE;")).toEqual([]);
  });
});

describe("only billing, the app and the boot hook import modules/billing", () => {
  const billingImports = [
    "@/modules/billing",
    "@/modules/billing/backend/controller",
    "@/modules/billing/provider/provider-mode",
  ];

  const forbidden: Array<[string, string]> = [
    ["a feature module", "src/modules/projects/backend/x.ts"],
    ["a lib module", "src/lib/rate-limit/x.ts"],
    ["a component", "src/components/x.tsx"],
    ["a hook", "src/hooks/x.ts"],
    ["the authorization layer", "src/authorization/x.ts"],
    ["the read side", "src/lib/entitlements/x.ts"],
  ];

  for (const [who, path] of forbidden) {
    it(`rejects ${who}`, async () => {
      for (const specifier of billingImports) {
        const errors = await boundaryErrors(path, `import * as x from "${specifier}";\nexport { x };`);

        expect(errors.length, `${path} -> ${specifier}`).toBeGreaterThan(0);
      }
    });
  }

  it("gives the read side its own reason", async () => {
    const [error] = await boundaryErrors("src/lib/entitlements/x.ts", 'import * as x from "@/modules/billing";\nexport { x };');

    expect(error).toContain("read side");
  });

  it("allows app routes, app pages and the boot hook", async () => {
    for (const path of [
      "src/app/api/v1/admin/billing/grants/route.ts",
      "src/app/(dashboard)/admin/billing/grants/page.tsx",
      "src/instrumentation.ts",
    ]) {
      for (const specifier of billingImports) {
        expect(await boundaryErrors(path, `import * as x from "${specifier}";\nexport { x };`), `${path} -> ${specifier}`).toEqual([]);
      }
    }
  });

  it("allows billing to import itself", async () => {
    expect(
      await boundaryErrors("src/modules/billing/backend/x.ts", 'import * as x from "@/modules/billing/errors";\nexport { x };'),
    ).toEqual([]);
  });
});

describe("billing never imports feature modules", () => {
  const features = ["projects", "portfolio", "notifications", "preferences", "mcp", "recommendations"];
  const billingFiles = [
    "src/modules/billing/backend/x.ts",
    "src/modules/billing/backend/grants/x.ts",
    "src/modules/billing/policy/x.ts",
    "src/modules/billing/provider/x.ts",
    "src/modules/billing/provider/razorpay/x.ts",
    "src/modules/billing/frontend/components/x.tsx",
  ];

  for (const path of billingFiles) {
    it(`rejects every feature module from ${path}`, async () => {
      for (const feature of features) {
        const errors = await boundaryErrors(path, `import * as x from "@/modules/${feature}/backend/service";\nexport { x };`);

        expect(errors.length, `${path} -> ${feature}`).toBeGreaterThan(0);
      }
    });
  }

  it("rejects a feature module's barrel and a relative path into one", async () => {
    for (const specifier of ["@/modules/projects", "../../../../modules/notifications/backend/x"]) {
      const errors = await boundaryErrors("src/modules/billing/backend/x.ts", `import * as x from "${specifier}";\nexport { x };`);

      expect(errors.length, specifier).toBeGreaterThan(0);
    }
  });

  it("allows what billing is meant to depend on", async () => {
    const allowed = [
      "@/lib/entitlements",
      "@/lib/entitlements/catalog",
      "@/lib/errors",
      "@/lib/rate-limit/store",
      "@/lib/logger",
      "@/lib/prisma",
      "@/authorization",
      "@/generated/prisma",
      "../provider/types",
      "../../policy/cooldown",
    ];

    for (const specifier of allowed) {
      expect(
        await boundaryErrors("src/modules/billing/backend/x.ts", `import * as x from "${specifier}";\nexport { x };`),
        specifier,
      ).toEqual([]);
    }
  });
});

describe("the read side and features keep working the way they did", () => {
  it("lets a feature module ask lib/entitlements", async () => {
    for (const specifier of ["@/lib/entitlements", "@/lib/entitlements/catalog"]) {
      expect(
        await boundaryErrors("src/modules/projects/backend/x.ts", `import * as x from "${specifier}";\nexport { x };`),
      ).toEqual([]);
    }
  });

  it("still keeps the stored plan enum out of feature code, the app and lib", async () => {
    for (const path of ["src/modules/projects/backend/x.ts", "src/app/api/v1/x/route.ts", "src/lib/rate-limit/x.ts"]) {
      const errors = await boundaryErrors(path, 'import { MembershipPlan } from "@/generated/prisma";\nexport const p = MembershipPlan;');

      expect(errors.length, path).toBeGreaterThan(0);
    }
  });

  it("still lets the read side and billing use the stored plan enum", async () => {
    for (const path of ["src/lib/entitlements/x.ts", "src/modules/billing/backend/x.ts", "src/testing/x.ts"]) {
      expect(
        await boundaryErrors(path, 'import { MembershipPlan } from "@/generated/prisma";\nexport const p = MembershipPlan;'),
        path,
      ).toEqual([]);
    }
  });
});
