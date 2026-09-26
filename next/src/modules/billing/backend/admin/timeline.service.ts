/**
 * Billing — Admin Timeline (Phase VIII)
 *
 * "What happened to this subscription?" in one view: history entries (what
 * Kizunia decided), operations (what Kizunia asked the provider), webhook
 * events (what the provider told Kizunia; metadata only) and money facts
 * (charges, refunds, disputes), merged newest first. For one user (every
 * subscription they have had) or for one subscription.
 *
 * The raw provider payload is never part of the timeline, for any role: an
 * event says only whether its payload is still retained. A SUPER_ADMIN reads
 * one payload through `AdminPayloadService` (IB-28 item 4).
 *
 * `VIEW_BILLING` (ADMIN, SUPER_ADMIN). Read-only.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { BillingOperation, Prisma, Subscription } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { BillingUserNotFoundError, SubscriptionNotFoundError } from "../../errors";
import { BillingAuthorizer } from "../authorization/authorizer";
import type {
  BillingTimelineDTO,
  OperationTimelineEntryDTO,
  TimelineEntryDTO,
} from "./admin-billing.dto";
import { adminPermissions, iso } from "./admin-mappers";
import { TimelineRepository, type TimelineScope } from "./timeline.repository";

/** Per source, per request. Enough for years of one user's billing; the response says when it was reached. */
export const TIMELINE_SOURCE_LIMIT = 200;

/**
 * The operation request fields shown to an administrator. Anything else in the
 * recorded request is left out, so a future field is not shown by accident.
 */
const REQUEST_FIELDS = [
  "reason",
  "note",
  "atCycleEnd",
  "plan",
  "cycle",
  "kind",
  "marketingCode",
  "timing",
] as const;

function requestSummary(request: Prisma.JsonValue): OperationTimelineEntryDTO["request"] {
  if (!request || typeof request !== "object" || Array.isArray(request)) return {};

  const summary: Record<string, string | number | boolean | null> = {};

  for (const field of REQUEST_FIELDS) {
    const value = (request as Record<string, unknown>)[field];

    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      summary[field] = value as string | number | boolean | null;
    }
  }

  return summary;
}

function toOperationEntry(operation: BillingOperation): OperationTimelineEntryDTO {
  return {
    kind: "OPERATION",
    id: operation.id,
    at: iso(operation.createdAt),
    subscriptionId: operation.subscriptionId,
    operationKind: operation.kind,
    status: operation.status,
    actorKind: operation.actorKind,
    actorUserId: operation.actorUserId,
    parentOperationId: operation.parentOperationId,
    providerMode: operation.providerMode,
    requestSentAt: iso(operation.requestSentAt),
    resolvedAt: iso(operation.resolvedAt),
    failureClass: operation.failureClass,
    providerErrorCode: operation.providerErrorCode,
    providerErrorDescription: operation.providerErrorDescription,
    request: requestSummary(operation.request),
  };
}

export class AdminTimelineService {
  constructor(private readonly repository = new TimelineRepository()) {}

  async forUser(actor: StrictAuthorizationActor, userId: string): Promise<BillingTimelineDTO> {
    const context = await this.authorize(actor);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BillingUserNotFoundError();

    const subscriptions = await prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });

    return this.build(context, { userId, subscriptionId: null, subscriptions });
  }

  async forSubscription(actor: StrictAuthorizationActor, subscriptionId: string): Promise<BillingTimelineDTO> {
    const context = await this.authorize(actor);

    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!subscription) throw new SubscriptionNotFoundError();

    return this.build(context, { userId: null, subscriptionId, subscriptions: [subscription] });
  }

  private async build(
    context: PlatformContext,
    input: { userId: string | null; subscriptionId: string | null; subscriptions: readonly Subscription[] },
  ): Promise<BillingTimelineDTO> {
    const scope: TimelineScope = {
      userId: input.userId,
      subscriptionIds: input.subscriptions.map((s) => s.id),
      providerSubscriptionIds: input.subscriptions.flatMap((s) =>
        s.providerSubscriptionId ? [s.providerSubscriptionId] : [],
      ),
    };

    const [history, operations, events, moneyFacts] = await Promise.all([
      this.repository.history(scope, TIMELINE_SOURCE_LIMIT),
      this.repository.operations(scope, TIMELINE_SOURCE_LIMIT),
      this.repository.events(scope, TIMELINE_SOURCE_LIMIT),
      this.repository.moneyFacts(scope, TIMELINE_SOURCE_LIMIT),
    ]);

    const entries: TimelineEntryDTO[] = [
      ...history.rows.map(
        (entry): TimelineEntryDTO => ({
          kind: "HISTORY",
          id: entry.id,
          at: iso(entry.recordedAt),
          subscriptionId: entry.subscriptionId,
          change: entry.change,
          fromValue: entry.fromValue,
          toValue: entry.toValue,
          cause: entry.cause,
          trigger: entry.trigger,
          operationId: entry.operationId,
          billingEventId: entry.billingEventId,
          actorUserId: entry.actorUserId,
          observationAt: iso(entry.observationAt),
        }),
      ),
      ...operations.rows.map(toOperationEntry),
      ...events.rows.map(
        (event): TimelineEntryDTO => ({
          kind: "EVENT",
          id: event.id,
          at: iso(event.receivedAt),
          subscriptionId: event.subscriptionId,
          eventType: event.eventType,
          providerMode: event.providerMode,
          status: event.status,
          providerEventId: event.dedupeKey,
          dedupeSource: event.dedupeSource,
          providerSubscriptionId: event.providerSubscriptionId,
          providerCreatedAt: iso(event.providerCreatedAt),
          matchedSecret: event.matchedSecret,
          duplicateCount: event.duplicateCount,
          hasPayload: event.hasPayload,
          payloadPrunedAt: iso(event.payloadPrunedAt),
        }),
      ),
      ...moneyFacts.rows.map(
        (fact): TimelineEntryDTO => ({
          kind: "MONEY_FACT",
          id: fact.id,
          at: iso(fact.occurredAt),
          subscriptionId: fact.subscriptionId,
          factKind: fact.kind,
          providerMode: fact.providerMode,
          providerObjectId: fact.providerObjectId,
          providerInvoiceId: fact.providerInvoiceId,
          amountMinor: fact.amountMinor,
          currency: fact.currency,
          periodStart: iso(fact.periodStart),
          periodEnd: iso(fact.periodEnd),
          billingEventId: fact.billingEventId,
        }),
      ),
    ];

    // Newest first; ties broken by id so the order is stable across requests.
    entries.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

    return {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      subscriptions: input.subscriptions.map((s) => ({
        id: s.id,
        kind: s.kind,
        plan: s.plan,
        cycle: s.cycle,
        phase: s.phase,
        providerMode: s.providerMode,
        createdAt: iso(s.createdAt),
      })),
      entries,
      truncated: history.truncated || operations.truncated || events.truncated || moneyFacts.truncated,
      permissions: adminPermissions(context),
    };
  }

  private async authorize(actor: StrictAuthorizationActor): Promise<PlatformContext> {
    const context = await PlatformContextResolver.resolve(actor);
    BillingAuthorizer.viewBilling(context);

    return context;
  }
}
