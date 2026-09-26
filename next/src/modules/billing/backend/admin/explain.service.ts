/**
 * Billing — Admin "Explain Access" (Phase VIII)
 *
 * "Why does this user have this access?" answered from the resolver's own
 * explain function (`lib/entitlements/explain.ts`), which uses the same
 * predicates as the resolver, so the explanation cannot disagree with the
 * decision. Nothing here re-derives access: the service only **decorates**
 * each source, looked up by its id, with what a support engineer needs next
 * (when the subscription entered its phase, its sync state, who granted a
 * grant and why) and lists the user's open anomalies.
 *
 * Current state only. A historical "as of" explanation replayed from history
 * and grant audit is not built (IB-28 item 6).
 *
 * `VIEW_BILLING` (ADMIN, SUPER_ADMIN). Read-only.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { ProviderMode } from "@/generated/prisma";
import { explainEffectiveAccess, type ExplainedSource } from "@/lib/entitlements";
import prisma from "@/lib/prisma";

import { BillingUserNotFoundError } from "../../errors";
import type { UserLookupInput } from "../../schemas/admin";
import { BillingAuthorizer } from "../authorization/authorizer";
import { SubscriptionHistoryRepository } from "../history/history.repository";
import type {
  AccessExplanationDTO,
  BillingUserDTO,
  ExplainedSourceDTO,
} from "./admin-billing.dto";
import { adminPermissions, iso, toAnomalySummaryDTO } from "./admin-mappers";

const userSelect = { id: true, name: true, email: true } as const;

export interface AdminExplainServiceDeps {
  readonly now?: () => Date;
  /** Defaults to BILLING_EXPECTED_MODE, as the resolver does. */
  readonly expectedMode?: ProviderMode;
}

export class AdminExplainService {
  constructor(private readonly deps: AdminExplainServiceDeps = {}) {}

  /** Finds a user by id or e-mail address, for the admin lookup box. */
  async lookupUser(actor: StrictAuthorizationActor, input: UserLookupInput): Promise<BillingUserDTO> {
    await this.authorize(actor);

    const user = await prisma.user.findUnique({
      where: input.userId !== undefined ? { id: input.userId } : { email: input.email as string },
      select: userSelect,
    });

    if (!user) throw new BillingUserNotFoundError();

    return user;
  }

  async explain(actor: StrictAuthorizationActor, userId: string): Promise<AccessExplanationDTO> {
    const context = await this.authorize(actor);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) throw new BillingUserNotFoundError();

    const explanation = await explainEffectiveAccess(userId, {
      now: this.deps.now?.(),
      expectedMode: this.deps.expectedMode,
    });

    const subscriptionIds = explanation.sources.flatMap((s) => (s.kind === "SUBSCRIPTION" ? [s.subscriptionId] : []));
    const grantIds = explanation.sources.flatMap((s) => (s.kind === "GRANT" ? [s.grantId] : []));

    const [subscriptions, grants, openAnomalies] = await Promise.all([
      prisma.subscription.findMany({ where: { id: { in: subscriptionIds } } }),
      prisma.entitlementGrant.findMany({ where: { id: { in: grantIds } } }),
      prisma.billingAnomaly.findMany({
        where: { userId, resolvedAt: null },
        orderBy: { lastSeenAt: "desc" },
      }),
    ]);

    const phaseSince = new Map(
      await Promise.all(
        subscriptions.map(
          async (s) => [s.id, await SubscriptionHistoryRepository.phaseEnteredAt(prisma, s.id, s.phase)] as const,
        ),
      ),
    );

    const granterIds = grants.flatMap((g) => (g.grantedByUserId ? [g.grantedByUserId] : []));
    const granters = new Map(
      (
        await prisma.user.findMany({ where: { id: { in: [...new Set(granterIds)] } }, select: { id: true, name: true } })
      ).map((u) => [u.id, u.name]),
    );

    const subscriptionById = new Map(subscriptions.map((s) => [s.id, s]));
    const grantById = new Map(grants.map((g) => [g.id, g]));

    const sources = explanation.sources.map((source: ExplainedSource): ExplainedSourceDTO => {
      switch (source.kind) {
        case "DEFAULT":
          return { kind: "DEFAULT", plan: "FREE", contributes: true };

        case "SUBSCRIPTION": {
          const row = subscriptionById.get(source.subscriptionId);

          return {
            ...source,
            subscription: row
              ? {
                  kind: row.kind,
                  cycle: row.cycle,
                  phaseSince: iso(phaseSince.get(row.id)),
                  providerSubscriptionId: row.providerSubscriptionId,
                  providerStatus: row.providerStatus,
                  currentPeriodEnd: iso(row.currentPeriodEnd),
                  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
                  lastSyncedAt: iso(row.lastSyncedAt),
                  syncDueAt: iso(row.syncDueAt),
                  syncReason: row.syncReason,
                  syncAttempts: row.syncAttempts,
                  lastSyncFailureClass: row.lastSyncFailureClass,
                  createdAt: iso(row.createdAt),
                }
              : null,
          };
        }

        case "GRANT": {
          const row = grantById.get(source.grantId);

          return {
            ...source,
            validFrom: iso(source.validFrom),
            validUntil: iso(source.validUntil),
            grant: row
              ? {
                  reason: row.reason,
                  grantedBy: row.grantedByUserId
                    ? { id: row.grantedByUserId, name: granters.get(row.grantedByUserId) ?? null }
                    : null,
                  promotionId: row.promotionId,
                  revokedAt: iso(row.revokedAt),
                  revokeReason: row.revokeReason,
                }
              : null,
          };
        }
      }
    });

    return {
      user,
      at: iso(explanation.at),
      expectedMode: explanation.expectedMode,
      plan: explanation.plan,
      sources,
      winningSource: explanation.winningSource,
      openAnomalies: openAnomalies.map(toAnomalySummaryDTO),
      permissions: adminPermissions(context),
    };
  }

  private async authorize(actor: StrictAuthorizationActor): Promise<PlatformContext> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    return context;
  }
}
