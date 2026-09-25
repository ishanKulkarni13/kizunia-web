/**
 * Billing — TEST Plan Setup (a development tool)
 *
 * Creates the TEST verification plans in `config/test-plan-spec.ts` in the
 * Razorpay TEST account, idempotently, and reports their IDs for the TEST plan
 * catalog. Run by a developer: `pnpm billing:test-plans [--dry-run]`.
 *
 * Why it is safe to rerun: Razorpay has no API to delete a plan, so a
 * duplicate would be permanent. Every plan carries a stable key in its notes
 * (`kz_catalog_key`, e.g. `TEST:v1:PRO:MONTHLY`), and the tool lists every plan
 * in the account first:
 *
 *   a plan with the key (or, failing that, the exact name) exists
 *     and matches the spec      -> reused
 *     and differs from the spec -> reported, nothing created, exit non-zero
 *   none exists                 -> created (`--dry-run`: only reported)
 *
 * It refuses anything but TEST: the configured key must start `rzp_test_` and
 * the resolved mode must be TEST. It never prints a key, a secret or a
 * header; only plan IDs, names and amounts, none of which are secret.
 *
 * **A deliberate exception to "every Razorpay call goes through
 * `BudgetedProvider`".** Plan management is not part of the provider boundary
 * (the app never creates or reads plans), and this runs by hand, once, outside
 * the app, like the opt-in contract suite, which also uses the client
 * directly. It lives in `provider/` because only this directory may use the
 * Razorpay client (the ESLint boundary).
 */
import type { BillingCycle, MembershipPlan } from "@/generated/prisma";

import { TEST_PLAN_SPECS, TEST_PLAN_VERSION, type TestPlanSpec } from "../config/test-plan-spec";
import type { ProviderConfiguration } from "./provider-mode";
import { RazorpayClient, type RazorpayRawResult, type RazorpayRequestMethod, type RazorpayRequestOptions } from "./razorpay/razorpay-client";

/** The slice of the client the tool uses, so tests can substitute it. */
export interface PlanApiClient {
  request(method: RazorpayRequestMethod, path: string, options?: RazorpayRequestOptions): Promise<RazorpayRawResult>;
}

export interface ResolvedPlanSpec {
  readonly key: string;
  readonly name: string;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly period: "monthly" | "yearly";
  readonly interval: 1;
  readonly amountMinor: number;
  readonly currency: "INR";
}

export type PlanAction = "REUSED" | "CREATED" | "WOULD_CREATE" | "MISMATCH";

export interface PlanSetupEntry {
  readonly key: string;
  readonly name: string;
  readonly plan: MembershipPlan;
  readonly cycle: BillingCycle;
  readonly amountMinor: number;
  readonly providerPlanId: string | null;
  readonly action: PlanAction;
  /** For a MISMATCH: what differs, as "field: expected x, found y". */
  readonly differences?: readonly string[];
}

export interface PlanSetupResult {
  readonly entries: readonly PlanSetupEntry[];
  /** True when nothing mismatched and nothing failed. */
  readonly ok: boolean;
}

export interface EnsureTestPlansOptions {
  readonly dryRun: boolean;
  readonly configuration: ProviderConfiguration;
  readonly client?: PlanApiClient;
  readonly specs?: readonly TestPlanSpec[];
  readonly version?: number;
}

interface RemotePlan {
  readonly id: string;
  readonly period?: unknown;
  readonly interval?: unknown;
  readonly item?: { readonly name?: unknown; readonly amount?: unknown; readonly currency?: unknown };
  readonly notes?: unknown;
}

const PAGE = 100;

export function resolvePlanSpecs(specs: readonly TestPlanSpec[], version: number): ResolvedPlanSpec[] {
  return specs.map((spec) => ({
    key: `TEST:v${version}:${spec.plan}:${spec.cycle}`,
    name: `KZ-TEST v${version} ${spec.plan} ${spec.cycle.toLowerCase()}`,
    plan: spec.plan,
    cycle: spec.cycle,
    period: spec.cycle === "MONTHLY" ? "monthly" : "yearly",
    interval: 1,
    amountMinor: Math.round(spec.amountRupees * 100),
    currency: "INR",
  }));
}

export async function ensureTestPlans(options: EnsureTestPlansOptions): Promise<PlanSetupResult> {
  const { configuration } = options;

  if (configuration.mode !== "TEST" || !configuration.razorpay.keyId.startsWith("rzp_test_")) {
    throw new Error(
      "billing:test-plans runs only against Razorpay TEST mode: RAZORPAY_KEY_ID must be an rzp_test_ key and BILLING_EXPECTED_MODE test.",
    );
  }

  const client =
    options.client ??
    new RazorpayClient({ keyId: configuration.razorpay.keyId, keySecret: configuration.razorpay.keySecret });
  const specs = resolvePlanSpecs(options.specs ?? TEST_PLAN_SPECS, options.version ?? TEST_PLAN_VERSION);
  const existing = await listAllPlans(client);
  const entries: PlanSetupEntry[] = [];

  for (const spec of specs) {
    const base = { key: spec.key, name: spec.name, plan: spec.plan, cycle: spec.cycle, amountMinor: spec.amountMinor };
    const found = existing.find((plan) => noteKey(plan) === spec.key) ?? existing.find((plan) => plan.item?.name === spec.name);

    if (found) {
      const differences = compare(spec, found);

      entries.push(
        differences.length === 0
          ? { ...base, providerPlanId: found.id, action: "REUSED" }
          : { ...base, providerPlanId: found.id, action: "MISMATCH", differences },
      );
      continue;
    }

    if (options.dryRun) {
      entries.push({ ...base, providerPlanId: null, action: "WOULD_CREATE" });
      continue;
    }

    // Sequential, and each result read back: a rerun after a failure finds what was created.
    const created = await createPlan(client, spec);
    entries.push({ ...base, providerPlanId: created, action: "CREATED" });
  }

  return { entries, ok: entries.every((entry) => entry.action !== "MISMATCH") };
}

/** The TEST catalog entries, as TypeScript, for `plan-catalog.ts`. */
export function catalogSnippet(result: PlanSetupResult): string {
  const lines = result.entries
    .filter((entry) => entry.providerPlanId !== null && entry.action !== "MISMATCH")
    .map(
      (entry) =>
        `  // ${entry.name}: ₹${entry.amountMinor / 100} (temporary TEST-only price)\n` +
        `  { providerPlanId: "${entry.providerPlanId}", plan: "${entry.plan}", cycle: "${entry.cycle}" },`,
    );

  return `const TEST_PLANS: readonly PlanCatalogEntry[] = [\n${lines.join("\n")}\n];`;
}

// ---------------------------------------------------------------------------

async function listAllPlans(client: PlanApiClient): Promise<RemotePlan[]> {
  const plans: RemotePlan[] = [];

  for (let skip = 0; ; skip += PAGE) {
    const response = await client.request("GET", "/plans", { query: { count: PAGE, skip } });
    const items = itemsOf(response, "list plans");

    plans.push(...items);

    if (items.length < PAGE) return plans;
  }
}

async function createPlan(client: PlanApiClient, spec: ResolvedPlanSpec): Promise<string> {
  const response = await client.request("POST", "/plans", {
    body: {
      period: spec.period,
      interval: spec.interval,
      item: {
        name: spec.name,
        amount: spec.amountMinor,
        currency: spec.currency,
        description: "Kizunia TEST verification plan. Temporary TEST-only price; not Kizunia pricing.",
      },
      notes: { kz_catalog_key: spec.key, kz_env: "TEST" },
    },
  });

  if (response.kind !== "RESPONSE" || response.status !== 200) {
    throw new Error(`creating ${spec.name} failed: ${describe(response)}`);
  }

  const body = response.body as RemotePlan | undefined;

  if (!body || typeof body.id !== "string" || compare(spec, body).length > 0) {
    throw new Error(`creating ${spec.name} returned an unexpected plan: ${describe(response)}`);
  }

  return body.id;
}

function itemsOf(response: RazorpayRawResult, what: string): RemotePlan[] {
  if (response.kind !== "RESPONSE" || response.status !== 200) throw new Error(`${what} failed: ${describe(response)}`);

  const items = (response.body as { items?: unknown } | undefined)?.items;

  if (!Array.isArray(items)) throw new Error(`${what} returned no items`);

  return items.filter((item): item is RemotePlan => typeof item === "object" && item !== null && typeof item.id === "string");
}

function noteKey(plan: RemotePlan): string | null {
  const notes = plan.notes;

  if (typeof notes !== "object" || notes === null || Array.isArray(notes)) return null;

  const key = (notes as Record<string, unknown>).kz_catalog_key;

  return typeof key === "string" ? key : null;
}

function compare(spec: ResolvedPlanSpec, plan: RemotePlan): string[] {
  const checks: [string, unknown, unknown][] = [
    ["period", spec.period, plan.period],
    ["interval", spec.interval, plan.interval],
    ["amount", spec.amountMinor, plan.item?.amount],
    ["currency", spec.currency, plan.item?.currency],
  ];

  return checks
    .filter(([, expected, found]) => expected !== found)
    .map(([field, expected, found]) => `${field}: expected ${String(expected)}, found ${String(found)}`);
}

/** Status and error code only: never headers, never the request. */
function describe(response: RazorpayRawResult): string {
  if (response.kind === "NO_RESPONSE") return "no response (timeout or network)";

  const error = (response.body as { error?: { code?: unknown; description?: unknown } } | undefined)?.error;

  return `HTTP ${response.status}${error ? ` ${String(error.code)}: ${String(error.description)}` : ""}`;
}
