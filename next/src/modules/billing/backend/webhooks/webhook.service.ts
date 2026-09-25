/**
 * Billing — Webhook Ingestion
 *
 * Turns one Razorpay delivery into durable records, fast, and nothing more
 * (docs/architecture/subscription/implementation/webhooks.md):
 *
 *   disabled                -> 400, fail closed (no secret to verify with)
 *   signature invalid       -> 400 + security log; nothing parsed, nothing written (SB-WH-01)
 *   signed but unreadable   -> 400 + billing.alert (a signed non-JSON body is serious)
 *   account_id not ours     -> 400 + security log
 *   ONE transaction:
 *     the event, deduplicated on x-razorpay-event-id, else sha256(body) (SB-WH-02)
 *       a duplicate only bumps duplicateCount
 *     a subscription event:   its subscription marked sync-due (SB-WH-03), or
 *                             UNMATCHED_PENDING when Kizunia does not know it (SB-WH-06)
 *     a money fact:           recorded append-only, deduplicated on its own ID (SB-WH-04)
 *     anything else:          SKIPPED_UNSUPPORTED
 *   commit failed           -> 500: nothing recorded, so nothing acknowledged; Razorpay retries
 *   -> 200
 *
 * The payload's status is never applied: an event only marks a subscription
 * due, and the authoritative fetch decides. No provider call happens before the
 * response, so Razorpay's 5-second limit is never at risk; the follow-up
 * (`followUp`, run from `after()`) fetches, and the tick drains whatever it
 * does not reach.
 *
 * HTTP-agnostic: it takes bytes and headers and returns a status.
 */
import { createHash } from "node:crypto";

import {
  MoneyFactKind as MoneyFactKindEnum,
  ProviderMode as ProviderModeEnum,
  BillingEventStatus as BillingEventStatusEnum,
  Prisma,
  type BillingEventStatus,
  type ProviderMode,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { PostgresRateLimitStore } from "@/lib/rate-limit/postgres.store";
import type { RateLimitStore } from "@/lib/rate-limit/store";

import { ALERT_CONFIG, SYNC_CONFIG } from "../../config/billing-config";
import { BillingAlertCondition, logBillingAlert, logBillingError, logBillingEvent } from "../../observability/log";
import { getBillingProvider } from "../../provider/provider-factory";
import { getProviderAccountId, getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import {
  ProviderPriority,
  type BillingProvider,
  type ProviderWebhookEvent,
  type WebhookMoneyFact,
} from "../../provider/types";
import { enumLiteral, newRowId, utc, utcOrNull } from "../sql";
import { SyncClaimRepository } from "../sync/claim.repository";
import { SyncService } from "../sync/sync.service";

export interface WebhookDelivery {
  /** The raw request body, exactly as received. Never parsed before it is verified. */
  readonly rawBody: Uint8Array;
  /** `X-Razorpay-Signature`. */
  readonly signature: string | null;
  /** `x-razorpay-event-id`. */
  readonly eventId: string | null;
  readonly receivedAt: Date;
}

export type WebhookRejection = "DISABLED" | "INVALID_SIGNATURE" | "MALFORMED" | "ACCOUNT_MISMATCH";

/** What the request's `after()` does once the response has gone. */
export interface WebhookFollowUp {
  /** Subscriptions this event marked due: synced now, best effort. */
  readonly subscriptionIds: readonly string[];
  /** Provider subscriptions Kizunia does not know yet: resolved through their notes. */
  readonly unmatchedProviderSubscriptionIds: readonly string[];
}

export type WebhookResult =
  | { readonly status: 200; readonly outcome: "RECORDED" | "DUPLICATE"; readonly billingEventId: string; readonly followUp: WebhookFollowUp }
  | { readonly status: 400; readonly outcome: WebhookRejection }
  | { readonly status: 500; readonly outcome: "RECORD_FAILED" };

/** Resolves events for provider subscriptions Kizunia does not know (SB-WH-06). */
export interface UnmatchedResolver {
  resolve(providerSubscriptionId: string, priority: ProviderPriority): Promise<unknown>;
}

export interface WebhookServiceDeps {
  readonly provider?: () => BillingProvider;
  readonly mode?: () => ResolvedProviderMode;
  readonly accountId?: () => string | null;
  readonly counterStore?: RateLimitStore;
  readonly sync?: SyncService;
  readonly unmatched?: UnmatchedResolver;
  /**
   * Test seam: runs inside the recording transaction just before it commits,
   * so a test can prove a failure there leaves nothing recorded.
   */
  readonly beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
}

const NO_FOLLOW_UP: WebhookFollowUp = { subscriptionIds: [], unmatchedProviderSubscriptionIds: [] };

export class WebhookService {
  private readonly provider: () => BillingProvider;
  private readonly mode: () => ResolvedProviderMode;
  private readonly accountId: () => string | null;

  constructor(private readonly deps: WebhookServiceDeps = {}) {
    this.provider = deps.provider ?? (() => getBillingProvider(ProviderPriority.CONFIRMATION));
    this.mode = deps.mode ?? getProviderMode;
    this.accountId = deps.accountId ?? getProviderAccountId;
  }

  async ingest(delivery: WebhookDelivery): Promise<WebhookResult> {
    const mode = this.mode();
    const log = { providerEventId: delivery.eventId, bytes: delivery.rawBody.byteLength };

    if (mode === "DISABLED") {
      logBillingEvent("webhook.rejected_disabled", log);

      return { status: 400, outcome: "DISABLED" };
    }

    const provider = this.provider();
    const match = provider.verifyWebhookSignature(delivery.rawBody, delivery.signature, delivery.receivedAt);

    if (!match.valid) {
      logBillingEvent("webhook.rejected_signature", { ...log, mode, signaturePresent: Boolean(delivery.signature) });
      await this.countSignatureFailure(mode, delivery.receivedAt);

      return { status: 400, outcome: "INVALID_SIGNATURE" };
    }

    const parsed = provider.parseWebhookEvent(delivery.rawBody);

    if (parsed.kind === "MALFORMED") {
      logBillingAlert(BillingAlertCondition.WEBHOOK_SIGNED_NON_JSON, "HIGH", { ...log, mode, reason: parsed.reason });

      return { status: 400, outcome: "MALFORMED" };
    }

    if (parsed.accountId !== this.accountId()) {
      // An identifier, not a secret: logged so a misconfigured RAZORPAY_ACCOUNT_ID can be corrected.
      logBillingEvent("webhook.rejected_account", { ...log, mode, receivedAccountId: parsed.accountId });

      return { status: 400, outcome: "ACCOUNT_MISMATCH" };
    }

    const eventId = delivery.eventId?.trim() || null;
    const dedupe = eventId
      ? { key: eventId, source: "HEADER" as const }
      : { key: createHash("sha256").update(delivery.rawBody).digest("hex"), source: "BODY_SHA256" as const };

    try {
      return await this.record(mode, parsed, dedupe, match.matchedSecret, delivery, log);
    } catch (error) {
      logBillingError("webhook.record_failed", { ...log, mode, eventType: parsed.eventType, error });
      logBillingAlert(BillingAlertCondition.WEBHOOK_RECORD_FAILED, "HIGH", { ...log, mode });

      return { status: 500, outcome: "RECORD_FAILED" };
    }
  }

  /**
   * The work after the response: bind unmatched subscriptions through their
   * notes, then sync the marked ones at priority 2. Best effort and bounded;
   * whatever it does not finish stays due for the tick.
   */
  async followUp(followUp: WebhookFollowUp): Promise<void> {
    let budget = SYNC_CONFIG.afterSyncCap;

    for (const providerSubscriptionId of followUp.unmatchedProviderSubscriptionIds) {
      if (budget <= 0 || !this.deps.unmatched) break;
      budget -= 1;
      await this.safely("webhook.follow_up_failed", { providerSubscriptionId }, () =>
        this.deps.unmatched!.resolve(providerSubscriptionId, ProviderPriority.CONFIRMATION),
      );
    }

    const sync = this.deps.sync ?? new SyncService();

    for (const subscriptionId of followUp.subscriptionIds) {
      if (budget <= 0) break;
      budget -= 1;
      await this.safely("webhook.follow_up_failed", { subscriptionId }, () =>
        sync.syncTargeted(subscriptionId, ProviderPriority.CONFIRMATION, { trigger: "WEBHOOK" }),
      );
    }
  }

  // -- Internals ------------------------------------------------------------

  private async record(
    mode: ProviderMode,
    event: ProviderWebhookEvent,
    dedupe: { key: string; source: "HEADER" | "BODY_SHA256" },
    matchedSecret: "CURRENT" | "PREVIOUS",
    delivery: WebhookDelivery,
    log: Record<string, unknown>,
  ): Promise<WebhookResult> {
    const outcome = await prisma.$transaction(async (tx) => {
      const subscription = event.providerSubscriptionId
        ? await tx.subscription.findUnique({
            where: { providerMode_providerSubscriptionId: { providerMode: mode, providerSubscriptionId: event.providerSubscriptionId } },
            select: { id: true, userId: true, phase: true },
          })
        : null;

      const status: BillingEventStatus =
        event.category === "UNSUPPORTED"
          ? "SKIPPED_UNSUPPORTED"
          : event.category === "SUBSCRIPTION" && subscription === null
            ? "UNMATCHED_PENDING"
            : "RECORDED";

      const [inserted] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO "public"."billing_event" (
          "id", "provider", "providerMode", "dedupeKey", "dedupeSource", "eventType",
          "providerSubscriptionId", "accountId", "providerCreatedAt", "receivedAt",
          "matchedSecret", "status", "subscriptionId", "duplicateCount", "rawPayload"
        ) VALUES (
          ${newRowId()}, 'RAZORPAY'::"public"."BillingProvider",
          ${enumLiteral(mode, ProviderModeEnum, "ProviderMode")},
          ${dedupe.key}, ${dedupe.source}, ${event.eventType},
          ${event.providerSubscriptionId}, ${event.accountId}, ${utcOrNull(event.providerCreatedAt)},
          ${utc(delivery.receivedAt)}, ${matchedSecret},
          ${enumLiteral(status, BillingEventStatusEnum, "BillingEventStatus")},
          ${subscription?.id ?? null}, 0, ${JSON.stringify(event.payload)}::jsonb
        )
        ON CONFLICT ("provider", "dedupeKey") DO NOTHING
        RETURNING "id"`);

      if (!inserted) {
        // Already recorded: a redelivery does nothing twice.
        const [existing] = await tx.$queryRaw<{ id: string; duplicateCount: number }[]>(Prisma.sql`
          UPDATE "public"."billing_event" SET "duplicateCount" = "duplicateCount" + 1
          WHERE "provider" = 'RAZORPAY'::"public"."BillingProvider" AND "dedupeKey" = ${dedupe.key}
          RETURNING "id", "duplicateCount"`);

        await this.deps.beforeCommit?.(tx);

        return { kind: "DUPLICATE" as const, billingEventId: existing.id, duplicateCount: existing.duplicateCount };
      }

      let marked = false;

      if (event.category === "SUBSCRIPTION" && subscription !== null) {
        marked = await SyncClaimRepository.markDue(tx, subscription.id, "WEBHOOK", delivery.receivedAt, {
          eventDriven: true,
          now: delivery.receivedAt,
        });
      }

      const factRecorded = event.moneyFact
        ? await recordMoneyFact(tx, mode, event.moneyFact, inserted.id, subscription)
        : false;

      await this.deps.beforeCommit?.(tx);

      return { kind: "RECORDED" as const, billingEventId: inserted.id, status, subscription, marked, factRecorded };
    });

    const fields = {
      ...log,
      mode,
      eventType: event.eventType,
      billingEventId: outcome.billingEventId,
      dedupeSource: dedupe.source,
      // Which secret verified it (CURRENT / PREVIOUS). Not named "…secret…": the logger redacts such keys.
      signedWith: matchedSecret,
    };

    if (outcome.kind === "DUPLICATE") {
      logBillingEvent("webhook.duplicate", { ...fields, duplicateCount: outcome.duplicateCount });

      return { status: 200, outcome: "DUPLICATE", billingEventId: outcome.billingEventId, followUp: NO_FOLLOW_UP };
    }

    logBillingEvent("webhook.received", {
      ...fields,
      status: outcome.status,
      subscriptionId: outcome.subscription?.id ?? null,
      userId: outcome.subscription?.userId ?? null,
      markedDue: outcome.marked,
      factRecorded: outcome.factRecorded,
    });

    if (outcome.subscription && !outcome.marked) {
      // Terminal (never due again) or unbound: linked, not marked (IB-24 item 5).
      logBillingEvent("webhook.terminal_subscription", { ...fields, subscriptionId: outcome.subscription.id, phase: outcome.subscription.phase });
    }

    if (outcome.status === "UNMATCHED_PENDING") {
      logBillingEvent("webhook.unmatched", { ...fields, providerSubscriptionId: event.providerSubscriptionId });
    }

    if (event.moneyFact?.kind === "DISPUTE" && outcome.factRecorded) {
      logBillingAlert(BillingAlertCondition.DISPUTE_RECORDED, "HIGH", {
        ...fields,
        providerObjectId: event.moneyFact.providerObjectId,
      });
    }

    return {
      status: 200,
      outcome: "RECORDED",
      billingEventId: outcome.billingEventId,
      followUp: {
        subscriptionIds: outcome.marked && outcome.subscription ? [outcome.subscription.id] : [],
        unmatchedProviderSubscriptionIds:
          outcome.status === "UNMATCHED_PENDING" && event.providerSubscriptionId ? [event.providerSubscriptionId] : [],
      },
    };
  }

  /**
   * Counts rejected signatures per mode per hour on the rate-limit store, and
   * alerts once when the count crosses the baseline. Never affects the response.
   */
  private async countSignatureFailure(mode: ProviderMode, at: Date): Promise<void> {
    const hourStart = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);

    try {
      const store = this.deps.counterStore ?? new PostgresRateLimitStore();
      const { count } = await store.increment(
        `billing-webhook-signature:${mode}:${hourStart.toISOString()}`,
        new Date(hourStart.getTime() + 2 * 3_600_000),
      );

      if (count === ALERT_CONFIG.signatureFailuresPerHour) {
        logBillingAlert(BillingAlertCondition.WEBHOOK_SIGNATURE_FAILURES, "HIGH", { mode, count, hourStart });
      }
    } catch (error) {
      logBillingError("webhook.signature_count_failed", { mode, error });
    }
  }

  private async safely(event: string, fields: Record<string, unknown>, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      logBillingError(event, { ...fields, error });
    }
  }
}

/**
 * Records a money fact, once (SB-WH-04). A charge belongs to the event's
 * subscription; a refund or dispute is linked through the charge fact of the
 * payment it concerns, when Kizunia recorded one. Never changes access.
 */
async function recordMoneyFact(
  tx: Prisma.TransactionClient,
  mode: ProviderMode,
  fact: WebhookMoneyFact,
  billingEventId: string,
  subscription: { id: string; userId: string | null } | null,
): Promise<boolean> {
  let owner = subscription;

  if (owner === null && fact.relatedPaymentId !== null) {
    const charge = await tx.billingMoneyFact.findUnique({
      where: { providerMode_kind_providerObjectId: { providerMode: mode, kind: "CHARGE", providerObjectId: fact.relatedPaymentId } },
      select: { subscriptionId: true, userId: true },
    });

    owner = charge?.subscriptionId ? { id: charge.subscriptionId, userId: charge.userId } : null;
  }

  const inserted = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "public"."billing_money_fact" (
      "id", "kind", "providerMode", "providerObjectId", "subscriptionId", "userId", "billingEventId",
      "amountMinor", "currency", "providerInvoiceId", "periodStart", "periodEnd", "occurredAt", "createdAt"
    ) VALUES (
      ${newRowId()},
      ${enumLiteral(fact.kind, MoneyFactKindEnum, "MoneyFactKind")},
      ${enumLiteral(mode, ProviderModeEnum, "ProviderMode")},
      ${fact.providerObjectId}, ${owner?.id ?? null}, ${owner?.userId ?? null}, ${billingEventId},
      ${fact.amountMinor}, ${fact.currency}, ${fact.providerInvoiceId},
      ${utcOrNull(fact.periodStart)}, ${utcOrNull(fact.periodEnd)}, ${utc(fact.occurredAt)}, ${utc(new Date())}
    )
    ON CONFLICT ("providerMode", "kind", "providerObjectId") DO NOTHING`);

  return inserted > 0;
}
