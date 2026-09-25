/**
 * Entitlements — Plan Catalog
 *
 * The ONE authoritative definition of what each plan means. Which capability
 * sits behind which plan is expected to change (SB-PL-04); when it does, this
 * table changes and nothing else. Feature code never compares plan names — it
 * asks for a capability or a quota (SB-PL-02).
 *
 * Source: docs/project/feature-specification/subscription/plans.md
 *
 * Pure and dependency-free, so it is safe to import from client components
 * (for labels). Import it as `@/lib/entitlements/catalog` from the client —
 * never the `@/lib/entitlements` barrel, which reaches the database.
 */

/**
 * The plans a user can resolve to. `FREE` is what "no other source is
 * currently valid" resolves to; it is never stored (SB-EA-01), which is why
 * the database enum `MembershipPlan` holds only the paid plans.
 */
export const EffectivePlan = {
  FREE: "FREE",
  PRO: "PRO",
  PRO_PLUS: "PRO_PLUS",
} as const;

export type EffectivePlan = (typeof EffectivePlan)[keyof typeof EffectivePlan];

/** The plans that can be stored on a grant (the database `MembershipPlan`). */
export type PaidPlan = Exclude<EffectivePlan, typeof EffectivePlan.FREE>;

/** Lowest to highest. "Highest wins" (SB-EA-02) is decided by this order. */
export const PLAN_ORDER: readonly EffectivePlan[] = [
  EffectivePlan.FREE,
  EffectivePlan.PRO,
  EffectivePlan.PRO_PLUS,
];

export const Capability = {
  /** Creating a portfolio, and showing it at its public URL. */
  PORTFOLIO: "PORTFOLIO",
  /** Competition deadline notifications (the `REGISTRATION_CLOSING` intent). */
  DEADLINE_NOTIFICATIONS: "DEADLINE_NOTIFICATIONS",
  /** Competition recommendations (the `TOP_RELEVANT_COMPETITION` intent). */
  RECOMMENDATIONS: "RECOMMENDATIONS",
  /** Using Kizunia through MCP. */
  MCP: "MCP",
} as const;

export type Capability = (typeof Capability)[keyof typeof Capability];

export const Quota = {
  /** Projects the user holds `ProjectMember.role = OWNER` on (SB-PL-03). */
  OWNED_PROJECTS: "OWNED_PROJECTS",
} as const;

export type Quota = (typeof Quota)[keyof typeof Quota];

export interface PlanDefinition {
  readonly capabilities: ReadonlySet<Capability>;
  readonly quotas: Readonly<Record<Quota, number>>;
}

export const PLAN_CATALOG: Readonly<Record<EffectivePlan, PlanDefinition>> = {
  [EffectivePlan.FREE]: {
    capabilities: new Set<Capability>([]),
    quotas: { [Quota.OWNED_PROJECTS]: 5 },
  },
  [EffectivePlan.PRO]: {
    capabilities: new Set<Capability>([
      Capability.PORTFOLIO,
      Capability.DEADLINE_NOTIFICATIONS,
    ]),
    quotas: { [Quota.OWNED_PROJECTS]: 10 },
  },
  [EffectivePlan.PRO_PLUS]: {
    capabilities: new Set<Capability>([
      Capability.PORTFOLIO,
      Capability.DEADLINE_NOTIFICATIONS,
      Capability.RECOMMENDATIONS,
      Capability.MCP,
    ]),
    quotas: { [Quota.OWNED_PROJECTS]: 20 },
  },
};

export function planRank(plan: EffectivePlan): number {
  return PLAN_ORDER.indexOf(plan);
}

/** The highest of the given plans, or `FREE` when there are none. */
export function maxPlan(plans: Iterable<EffectivePlan>): EffectivePlan {
  let best: EffectivePlan = EffectivePlan.FREE;

  for (const plan of plans) {
    if (planRank(plan) > planRank(best)) best = plan;
  }

  return best;
}

export function planHasCapability(plan: EffectivePlan, capability: Capability): boolean {
  return PLAN_CATALOG[plan].capabilities.has(capability);
}

export function quotaFor(plan: EffectivePlan, quota: Quota): number {
  return PLAN_CATALOG[plan].quotas[quota];
}

/** Every plan that includes `capability`, lowest first. */
export function plansWith(capability: Capability): EffectivePlan[] {
  return PLAN_ORDER.filter((plan) => planHasCapability(plan, capability));
}

/** The storable (paid) plans that include `capability`. */
export function paidPlansWith(capability: Capability): PaidPlan[] {
  return plansWith(capability).filter(
    (plan): plan is PaidPlan => plan !== EffectivePlan.FREE,
  );
}

/** Capabilities and quotas of a plan, as flat records callers can read directly. */
export interface PlanAccess {
  readonly plan: EffectivePlan;
  readonly capabilities: Readonly<Record<Capability, boolean>>;
  readonly quotas: Readonly<Record<Quota, number>>;
}

export function accessForPlan(plan: EffectivePlan): PlanAccess {
  const capabilities = Object.fromEntries(
    Object.values(Capability).map((capability) => [
      capability,
      planHasCapability(plan, capability),
    ]),
  ) as Record<Capability, boolean>;

  return {
    plan,
    capabilities,
    quotas: { ...PLAN_CATALOG[plan].quotas },
  };
}

/**
 * The lowest plan that includes `capability`. Feature code and the UI use it
 * to say "requires Pro" without naming a plan themselves: when a capability
 * moves between plans, the copy follows the catalog.
 */
export function minimumPlanFor(capability: Capability): EffectivePlan {
  const [lowest] = plansWith(capability);

  // Every capability sits in at least the highest plan; the catalog test
  // guards that, so this only fires if the table itself is broken.
  if (lowest === undefined) {
    throw new Error(`No plan includes the capability ${capability}.`);
  }

  return lowest;
}

/** Customer-facing plan names, for copy such as "Requires Pro+". */
export const PLAN_DISPLAY_NAME: Readonly<Record<EffectivePlan, string>> = {
  [EffectivePlan.FREE]: "Free",
  [EffectivePlan.PRO]: "Pro",
  [EffectivePlan.PRO_PLUS]: "Pro+",
};
