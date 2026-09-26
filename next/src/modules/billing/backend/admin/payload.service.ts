/**
 * Billing — Admin Raw Payload View (Phase VIII)
 *
 * One webhook's raw provider payload, for a SUPER_ADMIN only (IB-15, IB-28
 * item 4): it may carry customer contact details. `VIEW_BILLING` does not
 * imply it, and no other admin response ever includes a payload.
 *
 * The view is logged with the actor and the event id, never the content
 * (docs/architecture/subscription/cross-cutting/observability.md). After the
 * retention horizon the payload is gone (`billing:payload-prune`); the
 * response then says so and when.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import prisma from "@/lib/prisma";

import { BillingEventNotFoundError } from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { BillingAuthorizer } from "../authorization/authorizer";
import type { RawPayloadDTO } from "./admin-billing.dto";
import { iso } from "./admin-mappers";

export class AdminPayloadService {
  async rawPayload(actor: StrictAuthorizationActor, billingEventId: string): Promise<RawPayloadDTO> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewRawPayloads(context);

    const event = await prisma.billingEvent.findUnique({
      where: { id: billingEventId },
      select: { id: true, rawPayload: true, payloadPrunedAt: true },
    });

    if (!event) throw new BillingEventNotFoundError();

    const pruned = event.rawPayload === null;

    logBillingEvent("admin.payload_viewed", { actorUserId: actor.id, billingEventId: event.id, pruned });

    return pruned
      ? { billingEventId: event.id, pruned: true, prunedAt: iso(event.payloadPrunedAt) }
      : { billingEventId: event.id, pruned: false, payload: event.rawPayload };
  }
}
