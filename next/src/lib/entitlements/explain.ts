/**
 * Entitlements — Explain
 *
 * Answers "why does this user have this access?" for support: every source
 * the resolver considered, whether it contributed at the given instant, and
 * why not. Billing-admin only; the admin view that shows it arrives in
 * Phase VIII. It is part of the resolver's contract, so it lives here.
 *
 * Sources are the FREE default, every subscription and every grant. It derives
 * a grant's state with `grantStateAt` and a subscription's contribution with
 * `subscriptionContribution`, the in-memory twins of the resolver's database
 * predicates, and an integration test holds the two to the same effective plan.
 *
 * A subscription that does not contribute says why: its phase grants nothing,
 * or it was created in a provider mode this deployment does not expect (a
 * `TEST` row in a `LIVE`-expected deployment, the case a support engineer most
 * needs named). Only Kizunia's own identifiers appear here: nothing about the
 * payment provider crosses this file.
 */
import type { ProviderMode, SubscriptionPhase } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { expectedBillingMode } from "./billing-mode";
import { EffectivePlan, maxPlan } from "./catalog";
import type { ResolveOptions } from "./resolver";
import { subscriptionContribution, type SubscriptionContribution } from "./subscription-contribution";
import { grantStateAt, type GrantState } from "./validity";

export interface ExplainedDefaultSource {
  readonly kind: "DEFAULT";
  readonly plan: typeof EffectivePlan.FREE;
  readonly contributes: true;
}

export interface ExplainedGrantSource {
  readonly kind: "GRANT";
  readonly grantId: string;
  readonly source: string;
  readonly plan: EffectivePlan;
  readonly state: GrantState;
  readonly contributes: boolean;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

export interface ExplainedSubscriptionSource {
  readonly kind: "SUBSCRIPTION";
  readonly subscriptionId: string;
  readonly plan: EffectivePlan;
  readonly phase: SubscriptionPhase;
  readonly providerMode: ProviderMode;
  /** `CONTRIBUTING`, or why it is not: `MODE_MISMATCH` or `NON_CONTRIBUTING_PHASE`. */
  readonly contribution: SubscriptionContribution;
  readonly contributes: boolean;
}

export type ExplainedSource =
  | ExplainedDefaultSource
  | ExplainedSubscriptionSource
  | ExplainedGrantSource;

export interface AccessExplanation {
  readonly userId: string;
  readonly at: Date;
  /** The provider mode this deployment honors subscriptions from. */
  readonly expectedMode: ProviderMode;
  readonly plan: EffectivePlan;
  readonly sources: readonly ExplainedSource[];
  /**
   * The source that decides the effective plan: the default, or the earliest
   * created contributing source at the winning plan (a subscription before a
   * grant when created at the same instant).
   */
  readonly winningSource:
    | { readonly kind: "DEFAULT" }
    | { readonly kind: "SUBSCRIPTION"; readonly subscriptionId: string }
    | { readonly kind: "GRANT"; readonly grantId: string };
}

interface Candidate {
  readonly source: ExplainedSubscriptionSource | ExplainedGrantSource;
  readonly createdAt: Date;
  /** Breaks a tie on `createdAt`: subscriptions first. */
  readonly rank: 0 | 1;
}

export async function explainEffectiveAccess(
  userId: string,
  options: ResolveOptions = {},
): Promise<AccessExplanation> {
  const at = options.now ?? new Date();
  const db = options.db ?? prisma;
  const expectedMode = options.expectedMode ?? expectedBillingMode();

  const subscriptions = await db.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, plan: true, phase: true, providerMode: true, createdAt: true },
  });

  const grants = await db.entitlementGrant.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      source: true,
      plan: true,
      status: true,
      validFrom: true,
      validUntil: true,
      createdAt: true,
    },
  });

  const subscriptionCandidates: Candidate[] = subscriptions.map((subscription) => {
    const contribution = subscriptionContribution(subscription, expectedMode);

    return {
      createdAt: subscription.createdAt,
      rank: 0,
      source: {
        kind: "SUBSCRIPTION",
        subscriptionId: subscription.id,
        plan: subscription.plan,
        phase: subscription.phase,
        providerMode: subscription.providerMode,
        contribution,
        contributes: contribution === "CONTRIBUTING",
      },
    };
  });

  const grantCandidates: Candidate[] = grants.map((grant) => {
    const state = grantStateAt(grant, at);

    return {
      createdAt: grant.createdAt,
      rank: 1,
      source: {
        kind: "GRANT",
        grantId: grant.id,
        source: grant.source,
        plan: grant.plan,
        state,
        contributes: state === "ACTIVE",
        validFrom: grant.validFrom,
        validUntil: grant.validUntil,
      },
    };
  });

  const contributing = [...subscriptionCandidates, ...grantCandidates].filter(
    (candidate) => candidate.source.contributes,
  );
  const plan = maxPlan(contributing.map((candidate) => candidate.source.plan));

  const [winner] = contributing
    .filter((candidate) => candidate.source.plan === plan)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.rank - b.rank);

  return {
    userId,
    at,
    expectedMode,
    plan,
    sources: [
      { kind: "DEFAULT", plan: EffectivePlan.FREE, contributes: true },
      ...subscriptionCandidates.map((candidate) => candidate.source),
      ...grantCandidates.map((candidate) => candidate.source),
    ],
    winningSource: !winner
      ? { kind: "DEFAULT" }
      : winner.source.kind === "SUBSCRIPTION"
        ? { kind: "SUBSCRIPTION", subscriptionId: winner.source.subscriptionId }
        : { kind: "GRANT", grantId: winner.source.grantId },
  };
}
