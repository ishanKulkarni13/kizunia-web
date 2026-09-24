/**
 * Entitlements — Explain
 *
 * Answers "why does this user have this access?" for support: every source
 * the resolver considered, whether it contributed at the given instant, and
 * why not. Billing-admin only; the admin view that shows it arrives in
 * Phase VIII. It is part of the resolver's contract, so it lives here.
 *
 * It derives each grant's state with `grantStateAt`, the in-memory twin of the
 * resolver's database predicate, and an integration test holds the two to the
 * same effective plan.
 */
import prisma from "@/lib/prisma";

import { EffectivePlan, maxPlan } from "./catalog";
import type { ResolveOptions } from "./resolver";
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

export type ExplainedSource = ExplainedDefaultSource | ExplainedGrantSource;

export interface AccessExplanation {
  readonly userId: string;
  readonly at: Date;
  readonly plan: EffectivePlan;
  readonly sources: readonly ExplainedSource[];
  /** The source that decides the effective plan: the default, or the highest contributing grant. */
  readonly winningSource: { readonly kind: "DEFAULT" } | { readonly kind: "GRANT"; readonly grantId: string };
}

export async function explainEffectiveAccess(
  userId: string,
  options: ResolveOptions = {},
): Promise<AccessExplanation> {
  const at = options.now ?? new Date();
  const db = options.db ?? prisma;

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
    },
  });

  const grantSources: ExplainedGrantSource[] = grants.map((grant) => {
    const state = grantStateAt(grant, at);

    return {
      kind: "GRANT",
      grantId: grant.id,
      source: grant.source,
      plan: grant.plan,
      state,
      contributes: state === "ACTIVE",
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
    };
  });

  const contributing = grantSources.filter((source) => source.contributes);
  const plan = maxPlan(contributing.map((source) => source.plan));
  // The earliest-created contributing grant at the winning plan.
  const winner = contributing.find((source) => source.plan === plan);

  return {
    userId,
    at,
    plan,
    sources: [
      { kind: "DEFAULT", plan: EffectivePlan.FREE, contributes: true },
      ...grantSources,
    ],
    winningSource: winner ? { kind: "GRANT", grantId: winner.grantId } : { kind: "DEFAULT" },
  };
}
