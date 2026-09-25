import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// -----------------------------------------------------------------------------
// Subscription boundaries (docs/architecture/subscription/implementation-plan/phase-II)
// -----------------------------------------------------------------------------
//
// Feature code asks `@/lib/entitlements` capability and quota questions and
// never names a plan (SB-PL-02), so the stored plan enum is off limits outside
// the entitlement read side and the billing write side. Feature modules also
// never import billing or a payment provider: paid subscriptions arrive as one
// more entitlement source, with no feature code changing.

const MEMBERSHIP_PLAN_IMPORT = {
  name: "@/generated/prisma",
  importNames: ["MembershipPlan"],
  message:
    "Feature code asks @/lib/entitlements for capabilities and quotas; it never names a plan (SB-PL-02).",
};

const FEATURE_MODULES = [
  "src/modules/projects/**",
  "src/modules/portfolio/**",
  "src/modules/notifications/**",
  "src/modules/preferences/**",
  "src/modules/mcp/**",
  "src/modules/recommendations/**",
];

const subscriptionBoundaries = [
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/entitlements/**",
      "src/modules/billing/**",
      "src/testing/**",
      "src/generated/**",
      ...FEATURE_MODULES,
    ],
    rules: {
      "no-restricted-imports": ["error", { paths: [MEMBERSHIP_PLAN_IMPORT] }],
    },
  },
  {
    files: FEATURE_MODULES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [MEMBERSHIP_PLAN_IMPORT],
          patterns: [
            {
              group: ["razorpay", "razorpay/*"],
              message: "Payment providers stay behind modules/billing.",
            },
            {
              group: ["@/modules/billing", "@/modules/billing/*"],
              message:
                "Feature modules never import billing; ask @/lib/entitlements instead.",
            },
          ],
        },
      ],
    },
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...subscriptionBoundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
