/**
 * Billing — Timeline Reads (Phase VIII)
 *
 * The four durable records of what happened to a user's billing, read for the
 * admin timeline: history entries, operations, webhook events and money facts.
 * Read-only, and bounded: each source returns at most `limit` rows, newest
 * first, plus whether more exist.
 *
 * **The raw payload is never read here.** Events are selected column by
 * column, with `"rawPayload" IS NOT NULL` computed in the database, so a
 * payload never enters this process on the timeline path (IB-28 item 4).
 *
 * `BillingEvent` has no `userId`: a user's events are those linked to one of
 * their subscriptions, or carrying one of their provider subscription ids
 * (an event recorded before its subscription was matched).
 */
import {
  Prisma,
  type BillingEventStatus,
  type PrismaClient,
  type ProviderMode,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/** Whom the timeline is for: one user (all their subscriptions), or one subscription. */
export interface TimelineScope {
  readonly userId: string | null;
  readonly subscriptionIds: readonly string[];
  readonly providerSubscriptionIds: readonly string[];
}

export interface EventMetadataRow {
  readonly id: string;
  readonly providerMode: ProviderMode;
  readonly dedupeKey: string;
  readonly dedupeSource: string;
  readonly eventType: string;
  readonly providerSubscriptionId: string | null;
  readonly providerCreatedAt: Date | null;
  readonly receivedAt: Date;
  readonly matchedSecret: string;
  readonly status: BillingEventStatus;
  readonly subscriptionId: string | null;
  readonly duplicateCount: number;
  readonly hasPayload: boolean;
  readonly payloadPrunedAt: Date | null;
}

export interface Bounded<T> {
  readonly rows: T[];
  readonly truncated: boolean;
}

function bounded<T>(rows: T[], limit: number): Bounded<T> {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

/** Rows that belong to the user, or to one of the scoped subscriptions. */
function ownedBy(scope: TimelineScope) {
  const clauses: { userId?: string; subscriptionId?: { in: string[] } }[] = [];

  if (scope.userId) clauses.push({ userId: scope.userId });
  if (scope.subscriptionIds.length > 0) clauses.push({ subscriptionId: { in: [...scope.subscriptionIds] } });

  return clauses;
}

export class TimelineRepository {
  constructor(private readonly db: Db = prisma) {}

  async history(scope: TimelineScope, limit: number) {
    const or = ownedBy(scope);
    if (or.length === 0) return bounded([], limit);

    const rows = await this.db.subscriptionHistoryEntry.findMany({
      where: { OR: or },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return bounded(rows, limit);
  }

  async operations(scope: TimelineScope, limit: number) {
    const or = ownedBy(scope);
    if (or.length === 0) return bounded([], limit);

    const rows = await this.db.billingOperation.findMany({
      where: { OR: or },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return bounded(rows, limit);
  }

  async moneyFacts(scope: TimelineScope, limit: number) {
    const or = ownedBy(scope);
    if (or.length === 0) return bounded([], limit);

    const rows = await this.db.billingMoneyFact.findMany({
      where: { OR: or },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    return bounded(rows, limit);
  }

  /** Event metadata only; `hasPayload` is computed in SQL so the payload is never loaded. */
  async events(scope: TimelineScope, limit: number): Promise<Bounded<EventMetadataRow>> {
    const subscriptionIds = [...scope.subscriptionIds];
    const providerSubscriptionIds = [...scope.providerSubscriptionIds];

    if (subscriptionIds.length === 0 && providerSubscriptionIds.length === 0) return bounded([], limit);

    const rows = await this.db.$queryRaw<EventMetadataRow[]>(Prisma.sql`
      SELECT e."id", e."providerMode"::text AS "providerMode", e."dedupeKey", e."dedupeSource", e."eventType",
             e."providerSubscriptionId", e."providerCreatedAt", e."receivedAt", e."matchedSecret",
             e."status"::text AS "status", e."subscriptionId", e."duplicateCount",
             (e."rawPayload" IS NOT NULL) AS "hasPayload", e."payloadPrunedAt"
      FROM "public"."billing_event" AS e
      WHERE e."subscriptionId" = ANY(${subscriptionIds}::text[])
         OR e."providerSubscriptionId" = ANY(${providerSubscriptionIds}::text[])
      ORDER BY e."receivedAt" DESC, e."id" DESC
      LIMIT ${limit + 1}`);

    return bounded(rows, limit);
  }
}
