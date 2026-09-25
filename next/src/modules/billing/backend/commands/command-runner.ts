/**
 * Billing — The Command Runner
 *
 * The one implementation of the billing command lifecycle
 * (docs/architecture/subscription/implementation/command-model.md). Every
 * mutation Kizunia asks the provider for goes through here, in this order:
 *
 *   1 authorize      the session user only (userId never from the body);
 *                    billing disabled -> 503 BILLING_UNAVAILABLE, nothing written
 *   2 idempotency    (userId, key) exists: SUCCEEDED/REJECTED/NOT_APPLIED -> the recorded result;
 *                    IN_FLIGHT/OUTCOME_UNKNOWN -> "in progress" with the operation id
 *   3 tx A           expire this user's lapsed root (self-heal); refuse on a young
 *                    OUTCOME_UNKNOWN (409) or an open multiple-subscriptions anomaly;
 *                    INSERT the root IN_FLIGHT (the per-user slot: a unique violation is 409);
 *                    preconditions (refused -> the root is REJECTED in the same tx;
 *                    answered from local state -> rolled back, nothing persisted);
 *                    command-specific rows (a create's PROVISIONING Subscription); COMMIT
 *   4 budget + call  through the budgeted provider at priority 1, with NO transaction held
 *   5 classify       SUCCESS | REJECTED | OUTCOME_UNKNOWN (policy/command-outcome.ts)
 *   6 tx B           the operation settled and the command's own writes, through the
 *                    Phase IV apply path, in one transaction
 *   7 respond        from local state after tx B, never an optimistic guess
 *
 * Composed commands (IB-6): children run sequentially under their root's slot
 * (`runChild`), each recorded; "confirmed by sync" is one targeted priority-1
 * sync inside the request (`confirmTerminal`). If it is not visible yet the
 * command answers `CONFIRMING` and the user's next request re-evaluates. No
 * background process ever continues a command (SB-RC-10).
 *
 * An exception after a request left is deliberately **not** turned into a
 * status write: the operation stays IN_FLIGHT, its lease lapses, and it becomes
 * OUTCOME_UNKNOWN — resolved by observation, never by resending (SB-CM-03).
 */
import { randomUUID } from "node:crypto";

import {
  Prisma,
  type BillingOperation,
  type BillingOperationKind,
  type ProviderMode,
  type Subscription,
  type SubscriptionPhase,
} from "@/generated/prisma";
import type { AppError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { COMMAND_CONFIG } from "../../config/billing-config";
import type { PlanCatalog } from "../../config/plan-catalog";
import {
  BillingBusyError,
  BillingConfirmingError,
  BillingContactSupportError,
  BillingOperationInProgressError,
  BillingUnavailableError,
  IdempotencyKeyRequiredError,
} from "../../errors";
import { logBillingEvent } from "../../observability/log";
import { classifyMutationOutcome, type ClassifiedOutcome } from "../../policy/command-outcome";
import type { NextDueSettings } from "../../policy/next-due";
import { isTerminalPhase } from "../../policy/state-mapping";
import { getBillingProvider } from "../../provider/provider-factory";
import { assertBillingProviderEnabled, getProviderMode, type ResolvedProviderMode } from "../../provider/provider-mode";
import { ProviderPriority, type BillingProvider, type Outcome } from "../../provider/types";
import { emitEffects, newEffects, type Effects } from "../sync/apply";
import { SyncService } from "../sync/sync.service";
import { BillingOperationRepository, type OperationSettlement } from "./operation.repository";

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/** 8–128 of `[A-Za-z0-9_-]`; the client sends a UUID (IB-6 left the format to implementation). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Reads and validates an `Idempotency-Key` header value. */
export function parseIdempotencyKey(value: string | null | undefined): string {
  const key = value?.trim() ?? "";

  if (!IDEMPOTENCY_KEY.test(key)) throw new IdempotencyKeyRequiredError();

  return key;
}

// ---------------------------------------------------------------------------
// The command contract
// ---------------------------------------------------------------------------

/** Who is acting and on whose billing. `userId` always comes from the session. */
export interface CommandActor {
  readonly userId: string;
  readonly actorKind: "USER" | "ADMIN";
  readonly actorUserId: string;
}

export interface CommandInvocation {
  readonly actor: CommandActor;
  readonly idempotencyKey: string;
}

/** What a command sees while it runs. */
export interface CommandScope {
  readonly actor: CommandActor;
  readonly mode: ProviderMode;
  readonly runner: CommandRunner;
  readonly now: () => Date;
}

export type Preparation<TResult, TPlan> =
  /** Preconditions hold: commit tx A and execute. */
  | { readonly kind: "PROCEED"; readonly plan: TPlan }
  /** Answered from local state with nothing to mutate: tx A is rolled back and no operation is kept. */
  | { readonly kind: "RESPOND"; readonly result: TResult }
  /** Refused: the root is recorded REJECTED (nothing sent) and the error is returned. */
  | { readonly kind: "REFUSE"; readonly error: AppError };

export interface BillingCommand<TResult, TPlan> {
  readonly kind: BillingOperationKind;
  /** The normalized intent stored on the root operation. */
  readonly request: Prisma.InputJsonValue;
  /** Customer commands are refused while a multiple-subscriptions anomaly is open (SB-UQ-05). */
  readonly customerCommand: boolean;
  /** Tx A, after the root holds the user's slot. */
  prepare(tx: Prisma.TransactionClient, scope: CommandScope, root: BillingOperation): Promise<Preparation<TResult, TPlan>>;
  /** Everything after tx A. May call `scope.runner.mutate`, `runChild`, `confirmTerminal`. */
  execute(scope: CommandScope, root: BillingOperation, plan: TPlan): Promise<TResult>;
  /** The recorded result of a finished root, for a same-key retry. Never re-executes. */
  replay(scope: CommandScope, root: BillingOperation): Promise<TResult>;
  /** The answer while the root is still in flight or unresolved. */
  inProgress(root: BillingOperation): TResult;
}

export interface SettleContext {
  /** The operation being settled. */
  readonly operation: BillingOperation;
  /** `false` when another path (a webhook or orphan scan) closed the operation first. */
  readonly settled: boolean;
  /** Logs and alerts, emitted after tx B commits. */
  readonly effects: Effects;
  readonly now: Date;
}

/** One provider mutation and how its outcome is written. */
export interface MutationSpec<T> {
  /** `operation` is the one this call is recorded as (a child's own id goes into a create's `notes.kz_op`). */
  call(provider: BillingProvider, operation: BillingOperation): Promise<Outcome<T>>;
  /** Command-specific writes in tx B, after the operation itself is settled. */
  settle(tx: Prisma.TransactionClient, classified: ClassifiedOutcome<T>, context: SettleContext): Promise<void>;
}

export interface ChildSpec<T> extends MutationSpec<T> {
  readonly kind: BillingOperationKind;
  readonly subscriptionId: string;
  readonly request: Prisma.InputJsonValue;
}

export interface CommandRunnerDeps {
  readonly providerFor?: (priority: ProviderPriority) => BillingProvider;
  readonly resolvedMode?: () => ResolvedProviderMode;
  readonly assertEnabled?: () => void;
  readonly now?: () => Date;
  readonly catalog?: PlanCatalog;
  readonly schedule?: NextDueSettings;
  readonly sync?: SyncService;
  readonly leaseSeconds?: number;
  readonly outcomeUnknownWindowSeconds?: number;
  /**
   * Runs between the provider call and tx B. Tests use it to model a process
   * that dies there (it throws), which must leave the operation IN_FLIGHT.
   */
  readonly beforeSettle?: (operation: BillingOperation) => Promise<void>;
}

/** Thrown inside tx A to roll it back when the answer needs no persisted operation. */
class RespondWithoutOperation<TResult> {
  constructor(readonly result: TResult) {}
}

export class CommandRunner {
  readonly catalog: PlanCatalog | undefined;
  readonly schedule: NextDueSettings | undefined;

  private readonly providerFor: (priority: ProviderPriority) => BillingProvider;
  private readonly resolvedMode: () => ResolvedProviderMode;
  private readonly assertEnabled: () => void;
  private readonly now: () => Date;
  private readonly sync: SyncService;
  private readonly leaseSeconds: number;
  private readonly outcomeUnknownWindowSeconds: number;
  private readonly beforeSettle: ((operation: BillingOperation) => Promise<void>) | undefined;

  constructor(deps: CommandRunnerDeps = {}) {
    this.providerFor = deps.providerFor ?? getBillingProvider;
    this.resolvedMode = deps.resolvedMode ?? getProviderMode;
    this.assertEnabled = deps.assertEnabled ?? assertBillingProviderEnabled;
    this.now = deps.now ?? (() => new Date());
    this.catalog = deps.catalog;
    this.schedule = deps.schedule;
    this.leaseSeconds = deps.leaseSeconds ?? COMMAND_CONFIG.operationLeaseSeconds;
    this.outcomeUnknownWindowSeconds = deps.outcomeUnknownWindowSeconds ?? COMMAND_CONFIG.outcomeUnknownResolutionSeconds;
    this.beforeSettle = deps.beforeSettle;
    this.sync =
      deps.sync ??
      new SyncService({
        providerFor: this.providerFor,
        resolvedMode: this.resolvedMode,
        now: this.now,
        catalog: deps.catalog,
        schedule: deps.schedule,
      });
  }

  async run<TResult, TPlan>(command: BillingCommand<TResult, TPlan>, invocation: CommandInvocation): Promise<TResult> {
    // 1. Billing disabled: 503 before anything is read or written.
    this.assertEnabled();

    const mode = this.resolvedMode();

    if (mode === "DISABLED") throw new BillingUnavailableError();

    const { actor } = invocation;
    const idempotencyKey = parseIdempotencyKey(invocation.idempotencyKey);
    const scope: CommandScope = { actor, mode, runner: this, now: this.now };

    // 2. Idempotency.
    const existing = await BillingOperationRepository.findByKey(actor.userId, idempotencyKey);

    if (existing) return this.answerExisting(command, scope, existing);

    // 3. Tx A.
    let root: BillingOperation;
    let plan: TPlan;

    try {
      const prepared = await prisma.$transaction(async (tx) => {
        const now = this.now();

        await BillingOperationRepository.expireLapsed(tx, { mode, userId: actor.userId, now });

        const since = new Date(now.getTime() - this.outcomeUnknownWindowSeconds * 1000);

        // Refused before the slot is taken, but *returned*, not thrown: the
        // self-heal above must commit even when the command is refused.
        if (await BillingOperationRepository.hasYoungUnknown(tx, actor.userId, mode, since)) {
          return { kind: "BLOCKED", error: new BillingConfirmingError() } as const;
        }

        if (command.customerCommand && (await BillingOperationRepository.hasOpenMultipleSubscriptionsAnomaly(tx, actor.userId, mode))) {
          return { kind: "BLOCKED", error: new BillingContactSupportError() } as const;
        }

        const inserted = await BillingOperationRepository.insert(tx, {
          userId: actor.userId,
          kind: command.kind,
          providerMode: mode,
          actorKind: actor.actorKind,
          actorUserId: actor.actorUserId,
          idempotencyKey,
          request: command.request,
          leaseUntil: this.leaseUntil(now),
          createdAt: now,
        });

        const preparation = await command.prepare(tx, scope, inserted);

        switch (preparation.kind) {
          case "RESPOND":
            throw new RespondWithoutOperation(preparation.result);
          case "REFUSE":
            await BillingOperationRepository.settle(
              tx,
              inserted.id,
              { status: "REJECTED", failureClass: null, requestSentAt: null },
              now,
            );

            return { kind: "REFUSED", error: preparation.error, root: inserted } as const;
          default: {
            const current = await tx.billingOperation.findUniqueOrThrow({ where: { id: inserted.id } });

            return { kind: "PROCEED", root: current, plan: preparation.plan } as const;
          }
        }
      });

      if (prepared.kind === "BLOCKED") {
        logBillingEvent("command.rejected", { userId: actor.userId, kind: command.kind, reason: prepared.error.code, by: "state" });

        throw prepared.error;
      }

      if (prepared.kind === "REFUSED") {
        logBillingEvent("command.rejected", {
          ...this.logFields(prepared.root),
          reason: prepared.error.code,
          by: "precondition",
        });

        throw prepared.error;
      }

      root = prepared.root;
      plan = prepared.plan;
    } catch (error) {
      if (error instanceof RespondWithoutOperation) return error.result as TResult;

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.answerSlotConflict(command, scope, actor.userId, idempotencyKey);
      }

      throw error;
    }

    logBillingEvent("command.started", this.logFields(root));

    return command.execute(scope, root, plan);
  }

  /**
   * Sends one provider mutation for `operation` (no transaction held), classifies
   * it, and settles it in tx B together with the command's own writes.
   */
  async mutate<T>(operation: BillingOperation, spec: MutationSpec<T>): Promise<ClassifiedOutcome<T>> {
    const outcome = await spec.call(this.providerFor(ProviderPriority.COMMAND), operation);
    const classified = classifyMutationOutcome(outcome);

    // A crash here leaves the operation IN_FLIGHT until its lease lapses.
    await this.beforeSettle?.(operation);

    const settlement = settlementFor(classified);
    const effects = newEffects();
    const now = this.now();

    await prisma.$transaction(async (tx) => {
      const settled = await BillingOperationRepository.settle(tx, operation.id, settlement, now);

      await spec.settle(tx, classified, { operation, settled, effects, now });
    });

    emitEffects(effects);
    logBillingEvent(eventFor(settlement.status), {
      ...this.logFields(operation),
      status: settlement.status,
      failureClass: "failureClass" in settlement ? settlement.failureClass : null,
      requestSentAt: settlement.requestSentAt,
    });

    if (classified.kind === "DISABLED") throw new BillingUnavailableError();

    return classified;
  }

  /** Records a child operation under `root`'s slot and runs its mutation. A failed child stops the root. */
  async runChild<T>(root: BillingOperation, spec: ChildSpec<T>): Promise<{ child: BillingOperation; outcome: ClassifiedOutcome<T> }> {
    const child = await prisma.$transaction((tx) => this.insertChild(tx, root, spec));

    return { child, outcome: await this.mutate(child, spec) };
  }

  /**
   * Records a child in the caller's transaction, to be sent later with
   * `mutate`. A create's child is written in the same transaction as the
   * `PROVISIONING` record it will create, so a crash can never leave a record
   * without the operation that resolves it (a lapsed lease, then orphan
   * discovery).
   */
  async insertChild(
    tx: Prisma.TransactionClient,
    root: BillingOperation,
    spec: Pick<ChildSpec<unknown>, "kind" | "subscriptionId" | "request">,
  ): Promise<BillingOperation> {
    const now = this.now();
    const child = await BillingOperationRepository.insert(tx, {
      userId: root.userId!,
      kind: spec.kind,
      providerMode: root.providerMode,
      actorKind: root.actorKind,
      actorUserId: root.actorUserId,
      // Generated for a system-composed step (operation-model.md), unique per user.
      idempotencyKey: `${root.idempotencyKey}:${spec.kind}:${randomUUID().slice(0, 8)}`,
      request: spec.request,
      subscriptionId: spec.subscriptionId,
      parentOperationId: root.id,
      leaseUntil: this.leaseUntil(now),
      createdAt: now,
    });

    logBillingEvent("command.started", { ...this.logFields(child), parentOperationId: root.id });

    return child;
  }

  /**
   * "Confirmed by sync" (IB-6): one targeted, priority-1 fetch-and-apply. The
   * answer is the phase an authoritative fetch shows, never a command's own
   * response. `null` when nothing could be observed right now.
   */
  async confirmTerminal(subscriptionId: string): Promise<{ confirmed: boolean; phase: SubscriptionPhase | null }> {
    const { subscription } = await this.confirmBySync(subscriptionId);
    const phase = subscription?.phase ?? null;

    return { confirmed: phase !== null && isTerminalPhase(phase), phase };
  }

  /**
   * The same targeted priority-1 sync, answering with the row as that fetch
   * left it: for steps confirmed by something other than a terminal phase (a
   * cleared scheduled change, a phase still on hold). `subscription` is `null`
   * when nothing could be observed right now (a failed fetch, a row another
   * worker holds): the local row is then not evidence of anything.
   *
   * A fetch discarded as stale counts as observed: the row already holds an
   * observation whose request was sent *after* this one (a webhook's fetch
   * that overtook it), which is fresher evidence, not less.
   */
  async confirmBySync(subscriptionId: string): Promise<{ subscription: Subscription | null }> {
    const result = await this.sync.syncTargeted(subscriptionId, ProviderPriority.COMMAND, { trigger: "COMMAND_CONFIRM" });
    const observed = result.outcome === "APPLIED" || result.outcome === "NO_CHANGE" || result.outcome === "STALE_DISCARDED";

    if (!observed) return { subscription: null };

    return { subscription: await prisma.subscription.findUnique({ where: { id: subscriptionId } }) };
  }

  /** A fresh lease end, from now. */
  leaseUntil(now: Date = this.now()): Date {
    return new Date(now.getTime() + this.leaseSeconds * 1000);
  }

  /** The runner's clock. */
  clock(): Date {
    return this.now();
  }

  // -- Internals ------------------------------------------------------------

  private async answerExisting<TResult, TPlan>(
    command: BillingCommand<TResult, TPlan>,
    scope: CommandScope,
    existing: BillingOperation,
  ): Promise<TResult> {
    logBillingEvent("command.replayed", { ...this.logFields(existing), status: existing.status });

    if (existing.status === "IN_FLIGHT" || existing.status === "OUTCOME_UNKNOWN") return command.inProgress(existing);

    return command.replay(scope, existing);
  }

  /**
   * A unique violation in tx A: either a racing request with the same key won
   * (answer as a retry of it), or another root holds the user's slot (409).
   */
  private async answerSlotConflict<TResult, TPlan>(
    command: BillingCommand<TResult, TPlan>,
    scope: CommandScope,
    userId: string,
    idempotencyKey: string,
  ): Promise<TResult> {
    const sameKey = await BillingOperationRepository.findByKey(userId, idempotencyKey);

    if (sameKey) return this.answerExisting(command, scope, sameKey);

    const holder = await BillingOperationRepository.findInFlightRoot(userId);

    logBillingEvent("command.rejected", { userId, kind: command.kind, reason: "OPERATION_IN_PROGRESS", by: "slot" });

    throw new BillingOperationInProgressError(holder ? { operationId: holder.id } : undefined);
  }

  private logFields(operation: BillingOperation) {
    return {
      operationId: operation.id,
      kind: operation.kind,
      userId: operation.userId,
      subscriptionId: operation.subscriptionId,
      actorKind: operation.actorKind,
      mode: operation.providerMode,
    };
  }
}

function settlementFor<T>(classified: ClassifiedOutcome<T>): OperationSettlement {
  switch (classified.kind) {
    case "SUCCESS":
      return { status: "SUCCEEDED", requestSentAt: classified.requestSentAt };
    case "OUTCOME_UNKNOWN":
      return {
        status: "OUTCOME_UNKNOWN",
        failureClass: classified.failureClass,
        requestSentAt: classified.requestSentAt,
        providerErrorCode: classified.providerErrorCode,
        providerErrorDescription: classified.providerErrorDescription,
      };
    case "REJECTED":
      return {
        status: "REJECTED",
        failureClass: classified.failureClass,
        requestSentAt: classified.requestSentAt,
        providerErrorCode: classified.providerErrorCode,
        providerErrorDescription: classified.providerErrorDescription,
      };
    default:
      // Disabled between tx A and the call: nothing was sent.
      return { status: "REJECTED", failureClass: null, requestSentAt: null };
  }
}

function eventFor(status: OperationSettlement["status"]): string {
  switch (status) {
    case "SUCCEEDED":
      return "command.settled";
    case "OUTCOME_UNKNOWN":
      return "command.outcome_unknown";
    default:
      return "command.rejected";
  }
}

/** The error a provider refusal of a command becomes (never the raw provider message). */
export function errorForRejection(failureClass: string | null): AppError | null {
  if (failureClass === "BUDGET_EXHAUSTED" || failureClass === "RATE_LIMITED" || failureClass === "CONCURRENT_OPERATION") {
    return new BillingBusyError();
  }

  return null;
}
