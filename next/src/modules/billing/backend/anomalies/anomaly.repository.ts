/**
 * Billing — Anomalies
 *
 * Situations that need a human, never corrected automatically at the provider
 * (SB-RC-10): multiple open subscriptions, an unmatched provider subscription,
 * conflicting notes, an unmapped plan, a mode mismatch, a missing provider
 * subscription, a terminal state contradicted.
 *
 * **Raising is an upsert on the open row.** A partial unique index allows one
 * open anomaly per `(type, subjectKey)`, so detecting the same thing again
 * bumps `lastSeenAt` and `occurrences` instead of piling up rows, atomically
 * under concurrency. `opened` says whether this call created the row: the
 * alert fires once, when an anomaly opens, not on every repeat.
 *
 * Two ways to resolve. An observation resolves only what it proves stale
 * (IB-24 item 6), through `resolveOpen`. A person resolves one anomaly by id
 * through `resolveById` (Phase VIII): a conditional update on the open row, so
 * two concurrent resolutions record exactly one. Resolving is an operational
 * acknowledgement and touches no other table; if the situation is still true,
 * the next detection opens a new anomaly (the partial unique index only covers
 * open rows).
 *
 * Takes a database client so it runs inside the transaction that detected the
 * anomaly.
 */
import {
  BillingAnomalyType as BillingAnomalyTypeEnum,
  ProviderMode as ProviderModeEnum,
  Prisma,
  type BillingAnomaly,
  type BillingAnomalyType,
  type PrismaClient,
  type ProviderMode,
} from "@/generated/prisma";

import { enumLiteral, newRowId, utc } from "../sql";

type Db = PrismaClient | Prisma.TransactionClient;

/** The subject keys anomalies are deduplicated on. One format per kind of subject. */
export const AnomalySubject = {
  user: (userId: string) => `user:${userId}`,
  providerSubscription: (providerSubscriptionId: string) => `psub:${providerSubscriptionId}`,
  subscription: (subscriptionId: string) => `sub:${subscriptionId}`,
} as const;

export interface AnomalyInput {
  readonly type: BillingAnomalyType;
  readonly providerMode: ProviderMode;
  readonly subjectKey: string;
  readonly userId?: string | null;
  readonly subscriptionIds?: readonly string[];
  readonly providerSubscriptionId?: string | null;
  /** Diagnosis for a human. Identifiers only: never a payload, a secret or personal data. */
  readonly details: Readonly<Record<string, unknown>>;
}

export interface RaisedAnomaly {
  readonly id: string;
  /** This call opened it (as opposed to seeing an open one again). */
  readonly opened: boolean;
  readonly occurrences: number;
}

export class BillingAnomalyRepository {
  static async raise(db: Db, input: AnomalyInput, now: Date): Promise<RaisedAnomaly> {
    const subscriptionIds = [...new Set(input.subscriptionIds ?? [])];

    const [row] = await db.$queryRaw<{ id: string; occurrences: number; opened: boolean }[]>(Prisma.sql`
      INSERT INTO "public"."billing_anomaly" (
        "id", "type", "providerMode", "userId", "subscriptionIds", "providerSubscriptionId",
        "subjectKey", "details", "firstSeenAt", "lastSeenAt", "occurrences"
      ) VALUES (
        ${newRowId()},
        ${enumLiteral(input.type, BillingAnomalyTypeEnum, "BillingAnomalyType")},
        ${enumLiteral(input.providerMode, ProviderModeEnum, "ProviderMode")},
        ${input.userId ?? null},
        ${subscriptionIds}::text[],
        ${input.providerSubscriptionId ?? null},
        ${input.subjectKey},
        ${JSON.stringify(input.details)}::jsonb,
        ${utc(now)},
        ${utc(now)},
        1
      )
      ON CONFLICT ("type", "subjectKey") WHERE "resolvedAt" IS NULL
      DO UPDATE SET
        "lastSeenAt" = EXCLUDED."lastSeenAt",
        "occurrences" = "billing_anomaly"."occurrences" + 1,
        "details" = EXCLUDED."details",
        "userId" = COALESCE("billing_anomaly"."userId", EXCLUDED."userId"),
        "subscriptionIds" = ARRAY(
          SELECT DISTINCT unnest("billing_anomaly"."subscriptionIds" || EXCLUDED."subscriptionIds")
        )
      RETURNING "id", "occurrences", (xmax = 0) AS "opened"
    `);

    return { id: row.id, opened: row.opened, occurrences: row.occurrences };
  }

  /** Resolves the open anomaly of this type and subject, if any. Returns whether one was open. */
  static async resolveOpen(
    db: Db,
    type: BillingAnomalyType,
    subjectKey: string,
    resolutionReason: string,
    now: Date,
  ): Promise<boolean> {
    const { count } = await db.billingAnomaly.updateMany({
      where: { type, subjectKey, resolvedAt: null },
      data: { resolvedAt: now, resolutionReason },
    });

    return count > 0;
  }

  /**
   * A person resolves one anomaly. One conditional `UPDATE … WHERE id AND
   * resolvedAt IS NULL`: the loser of a race, or a second click, matches no
   * row and gets `false`. Returns whether this call resolved it.
   */
  static async resolveById(
    db: Db,
    id: string,
    resolvedByUserId: string,
    resolutionReason: string,
    now: Date,
  ): Promise<boolean> {
    const { count } = await db.billingAnomaly.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: now, resolvedByUserId, resolutionReason },
    });

    return count > 0;
  }

  static async findById(db: Db, id: string): Promise<BillingAnomaly | null> {
    return db.billingAnomaly.findUnique({ where: { id } });
  }

  /** Open anomalies first, then the most recently seen. */
  static async list(
    db: Db,
    filter: AnomalyListWhere,
    page: { readonly skip: number; readonly take: number },
  ): Promise<{ items: BillingAnomaly[]; total: number }> {
    const where = BillingAnomalyRepository.buildWhere(filter);

    const [items, total] = await Promise.all([
      db.billingAnomaly.findMany({
        where,
        orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      db.billingAnomaly.count({ where }),
    ]);

    return { items, total };
  }

  static buildWhere(filter: AnomalyListWhere): Prisma.BillingAnomalyWhereInput {
    return {
      ...(filter.status === "OPEN" && { resolvedAt: null }),
      ...(filter.status === "RESOLVED" && { resolvedAt: { not: null } }),
      ...(filter.type && { type: filter.type }),
      ...(filter.userId && { userId: filter.userId }),
    };
  }
}

export interface AnomalyListWhere {
  readonly status: "OPEN" | "RESOLVED" | "ALL";
  readonly type?: BillingAnomalyType;
  readonly userId?: string;
}
