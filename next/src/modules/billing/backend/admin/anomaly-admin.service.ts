/**
 * Billing — Admin Anomalies (Phase VIII)
 *
 * List and inspect anomalies (`VIEW_BILLING`: ADMIN, SUPER_ADMIN), and resolve
 * one with a mandatory reason (`MANAGE_BILLING`: SUPER_ADMIN only).
 *
 * **Resolving is an acknowledgement, not a fix.** It records who decided what
 * and why, on the anomaly row, and changes no subscription, operation, grant or
 * provider state (SB-RC-10: anomalies are never corrected automatically).
 * Fixing the underlying situation is done with the tools built for it
 * (immediate cancel, sync now, a configuration change) *before* resolving.
 * If the situation is still true, the next detection opens a **new** anomaly;
 * the partial unique index only constrains open rows.
 *
 * **Concurrency.** Resolution is one conditional `UPDATE … WHERE id AND
 * resolvedAt IS NULL`. Two concurrent resolutions record exactly one; the other
 * finds it already resolved and gets `409`. An anomaly that an observation
 * already resolved (`PROVIDER_SUBSCRIPTION_MISSING`, `UNMAPPED_PROVIDER_PLAN`)
 * is refused the same way.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import prisma from "@/lib/prisma";
import { buildPaginationMeta, parsePagination, toSkipTake } from "@/lib/search/pagination";
import type { RawSearchParams } from "@/lib/search/types";

import { BillingAnomalyAlreadyResolvedError, BillingAnomalyNotFoundError } from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { AnomalyListFilterSchema, ResolveAnomalySchema, type ResolveAnomalyInput } from "../../schemas/admin";
import { BillingAnomalyRepository } from "../anomalies/anomaly.repository";
import { BillingAuthorizer } from "../authorization/authorizer";
import type { AnomalyDetailDTO, AnomalyListDTO } from "./admin-billing.dto";
import { adminPermissions, toAnomalySummaryDTO } from "./admin-mappers";

const LIST_PAGINATION = { defaultLimit: 25, maxLimit: 100 } as const;

export interface AnomalyAdminServiceDeps {
  readonly now?: () => Date;
}

export class AnomalyAdminService {
  constructor(private readonly deps: AnomalyAdminServiceDeps = {}) {}

  async list(actor: StrictAuthorizationActor, params: RawSearchParams): Promise<AnomalyListDTO> {
    const context = await this.authorizeView(actor);

    const filter = AnomalyListFilterSchema.parse({
      status: params.status,
      type: params.type,
      userId: params.userId,
    });
    const pagination = parsePagination(params, LIST_PAGINATION);
    const { items, total } = await BillingAnomalyRepository.list(prisma, filter, toSkipTake(pagination));

    return {
      items: items.map(toAnomalySummaryDTO),
      pagination: buildPaginationMeta(pagination, total),
      permissions: adminPermissions(context),
    };
  }

  async detail(actor: StrictAuthorizationActor, anomalyId: string): Promise<AnomalyDetailDTO> {
    const context = await this.authorizeView(actor);

    return this.load(anomalyId, context);
  }

  async resolve(actor: StrictAuthorizationActor, anomalyId: string, input: ResolveAnomalyInput): Promise<AnomalyDetailDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.manageBilling(context);

    // The service enforces the reason itself, so a caller that skips the controller cannot resolve without one.
    const { reason } = ResolveAnomalySchema.parse(input);
    const now = (this.deps.now ?? (() => new Date()))();

    const resolved = await BillingAnomalyRepository.resolveById(prisma, anomalyId, actor.id, reason, now);

    if (!resolved) {
      const existing = await BillingAnomalyRepository.findById(prisma, anomalyId);

      if (!existing) throw new BillingAnomalyNotFoundError();
      throw new BillingAnomalyAlreadyResolvedError();
    }

    const anomaly = await this.load(anomalyId, context);

    logBillingEvent("anomaly.resolved", {
      anomalyId,
      type: anomaly.type,
      subjectKey: anomaly.subjectKey,
      by: "admin",
      actorUserId: actor.id,
      reason,
    });

    return anomaly;
  }

  private async load(anomalyId: string, context: PlatformContext): Promise<AnomalyDetailDTO> {
    const anomaly = await BillingAnomalyRepository.findById(prisma, anomalyId);

    if (!anomaly) throw new BillingAnomalyNotFoundError();

    const resolver = anomaly.resolvedByUserId
      ? await prisma.user.findUnique({ where: { id: anomaly.resolvedByUserId }, select: { id: true, name: true } })
      : null;

    return {
      ...toAnomalySummaryDTO(anomaly),
      providerSubscriptionId: anomaly.providerSubscriptionId,
      details: anomaly.details,
      resolvedBy: anomaly.resolvedByUserId
        ? { id: anomaly.resolvedByUserId, name: resolver?.name ?? null }
        : null,
      resolutionReason: anomaly.resolutionReason,
      permissions: adminPermissions(context),
    };
  }

  private async authorizeView(actor: StrictAuthorizationActor): Promise<PlatformContext> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    return context;
  }
}
