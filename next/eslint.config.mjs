import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// -----------------------------------------------------------------------------
// Subscription boundaries
// (docs/architecture/subscription/implementation/architecture-fit.md,
//  implementation-plan/phase-II and phase-III)
// -----------------------------------------------------------------------------
//
// Subscription & Billing has two homes with a one-way relationship:
//
//   lib/entitlements   the READ side. Every feature asks it capability and quota
//                      questions and never names a plan (SB-PL-02). It reads
//                      Kizunia's own tables and never imports billing.
//   modules/billing    the WRITE side. Owns every write to billing tables, and
//                      the provider boundary. Everything provider-specific is
//                      private to modules/billing/provider.
//
// The rules that keep it that way:
//
//   1. Only modules/billing, the app routes and pages, and the boot hook may
//      import modules/billing. Feature code, lib/* and the read side may not.
//   2. Razorpay is private to modules/billing/provider: nothing outside it
//      imports the `razorpay` package or provider/razorpay/**, or reads a
//      RAZORPAY_* variable (SB-PB-04). A provider is obtained from
//      getBillingProvider(), which wraps it in the request budget, so no call
//      can bypass the budget.
//   3. Billing never reaches into feature modules.
//   4. The stored plan enum is off limits outside the read side and billing.
//
// IMPORTANT: for a file matched by several config objects, a later
// `no-restricted-imports` REPLACES an earlier one; the options are not merged.
// So the zones below are disjoint (each file matches exactly one), and every
// zone lists its full set of restrictions.

const MEMBERSHIP_PLAN_IMPORT = {
  name: "@/generated/prisma",
  importNames: ["MembershipPlan"],
  message:
    "Feature code asks @/lib/entitlements for capabilities and quotas; it never names a plan (SB-PL-02).",
};

const FEATURE_MODULE_NAMES = [
  "projects",
  "portfolio",
  "notifications",
  "preferences",
  "mcp",
  "recommendations",
];

const FEATURE_MODULES = FEATURE_MODULE_NAMES.map((name) => `src/modules/${name}/**`);

const RAZORPAY_PACKAGE = {
  group: ["razorpay", "razorpay/*"],
  message: "Payment providers stay behind modules/billing/provider.",
};

const RAZORPAY_INTERNALS = {
  group: ["**/provider/razorpay", "**/provider/razorpay/**"],
  message:
    "Razorpay code is private to modules/billing/provider. Obtain a provider from getBillingProvider(priority), which enforces the request budget.",
};

const BILLING_MODULE = {
  group: ["@/modules/billing", "@/modules/billing/**"],
  message:
    "Only modules/billing, app routes and pages, and instrumentation.ts import billing. Ask @/lib/entitlements for access questions.",
};

const BILLING_FROM_FEATURES = {
  group: ["@/modules/billing", "@/modules/billing/**"],
  message: "Feature modules never import billing; ask @/lib/entitlements instead.",
};

const BILLING_FROM_ENTITLEMENTS = {
  group: ["@/modules/billing", "@/modules/billing/**"],
  message:
    "lib/entitlements is the read side: it reads Kizunia's own tables and never imports billing code.",
};

// Billing never reaches into feature modules (architecture-fit, forbidden
// dependencies).
const FEATURES_FROM_BILLING = FEATURE_MODULE_NAMES.map((name) => ({
  group: [
    `@/modules/${name}`,
    `@/modules/${name}/**`,
    `**/modules/${name}`,
    `**/modules/${name}/**`,
  ],
  message: `Billing never reaches into feature modules (${name}). Features ask @/lib/entitlements, and billing exposes nothing to them.`,
}));

// Razorpay identifiers and configuration stay behind the provider boundary:
// nothing outside it reads a RAZORPAY_* variable (SB-PB-04). Provider mode is
// asked through isBillingProviderEnabled(), never re-derived from the
// environment at a call site.
const RAZORPAY_ENV_MESSAGE =
  "RAZORPAY_* variables are read only in modules/billing/provider/provider-mode.ts. Ask isBillingProviderEnabled() or getBillingProvider().";

const RAZORPAY_ENV_SELECTORS = [
  // process.env.RAZORPAY_KEY_ID
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name=/^RAZORPAY_/]",
    message: RAZORPAY_ENV_MESSAGE,
  },
  // process.env["RAZORPAY_KEY_ID"]
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.value=/^RAZORPAY_/]",
    message: RAZORPAY_ENV_MESSAGE,
  },
];

const subscriptionBoundaries = [
  // Zone 1: everything else in src. Not a feature, not the read side, not
  // billing, not the app. May not import billing or Razorpay.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/**",
      "src/instrumentation.ts",
      "src/lib/entitlements/**",
      "src/modules/billing/**",
      "src/testing/**",
      "src/generated/**",
      ...FEATURE_MODULES,
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [MEMBERSHIP_PLAN_IMPORT],
          patterns: [RAZORPAY_PACKAGE, RAZORPAY_INTERNALS, BILLING_MODULE],
        },
      ],
    },
  },
  // Zone 2: app routes and pages, and the boot hook. The only callers outside
  // billing that may import it. They still may not touch Razorpay directly.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/instrumentation.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [MEMBERSHIP_PLAN_IMPORT],
          patterns: [RAZORPAY_PACKAGE, RAZORPAY_INTERNALS],
        },
      ],
    },
  },
  // Zone 3: feature modules. Ask @/lib/entitlements; never billing or Razorpay.
  {
    files: FEATURE_MODULES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [MEMBERSHIP_PLAN_IMPORT],
          patterns: [RAZORPAY_PACKAGE, RAZORPAY_INTERNALS, BILLING_FROM_FEATURES],
        },
      ],
    },
  },
  // Zone 4: the read side. Reads tables, never billing or Razorpay.
  {
    files: ["src/lib/entitlements/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [RAZORPAY_PACKAGE, RAZORPAY_INTERNALS, BILLING_FROM_ENTITLEMENTS] },
      ],
    },
  },
  // Zone 5: billing outside the provider. No Razorpay internals, no features.
  {
    files: ["src/modules/billing/**/*.{ts,tsx}"],
    ignores: ["src/modules/billing/provider/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [RAZORPAY_PACKAGE, RAZORPAY_INTERNALS, ...FEATURES_FROM_BILLING] },
      ],
    },
  },
  // Zone 6: the provider directory, the one place Razorpay lives. Still no
  // features.
  {
    files: ["src/modules/billing/provider/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: FEATURES_FROM_BILLING }],
    },
  },
  // Razorpay configuration is read in one file, inside the provider directory.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/billing/provider/**", "src/generated/**"],
    rules: {
      "no-restricted-syntax": ["error", ...RAZORPAY_ENV_SELECTORS],
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
