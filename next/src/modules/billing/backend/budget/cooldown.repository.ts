/**
 * Billing — Provider State Repository
 *
 * Persistence for the global cooldown and the auth-failure pin: one
 * `billing_provider_state` row per provider mode, shared by every instance.
 *
 * Updates are compare-and-set on `updatedAt`, which acts as the row's version.
 * The health tracker reads the row, computes the next state with the pure
 * policy, and writes it only if nobody else changed the row in between; on a
 * lost race it re-reads and recomputes. Two instances reacting to the same
 * outage therefore cannot overwrite each other with a stale result, and the
 * rule that a cooldown never moves earlier holds across instances, not just
 * within one.
 *
 * A mode with no row yet reads as a clean state; the first write creates it,
 * and a lost race to create is the same conflict as any other.
 */
import { Prisma, type ProviderMode } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { CLEAN_COOLDOWN_STATE, type CooldownState } from "../../policy/cooldown";

export interface LoadedProviderState {
  readonly state: CooldownState;
  /** The row's `updatedAt` when it was read; `null` if the row does not exist yet. */
  readonly version: Date | null;
}

export class CooldownRepository {
  async load(mode: ProviderMode): Promise<LoadedProviderState> {
    const row = await prisma.billingProviderState.findUnique({ where: { providerMode: mode } });

    if (row === null) return { state: CLEAN_COOLDOWN_STATE, version: null };

    return {
      state: {
        cooldownUntil: row.cooldownUntil,
        cooldownLevel: row.cooldownLevel,
        consecutiveFailures: row.consecutiveFailures,
        authFailurePinnedKeyFingerprint: row.authFailurePinnedKeyFingerprint,
      },
      version: row.updatedAt,
    };
  }

  /**
   * Writes `next` only if the row is still as it was when `loaded` was read.
   * Returns `false` on a lost race, so the caller can re-read and try again.
   */
  async compareAndSet(
    mode: ProviderMode,
    loaded: LoadedProviderState,
    next: CooldownState,
  ): Promise<boolean> {
    if (loaded.version === null) {
      try {
        await prisma.billingProviderState.create({ data: { providerMode: mode, ...next } });

        return true;
      } catch (error) {
        // Someone created the row first: a lost race, not a failure.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;

        throw error;
      }
    }

    const { count } = await prisma.billingProviderState.updateMany({
      where: { providerMode: mode, updatedAt: loaded.version },
      data: next,
    });

    return count === 1;
  }
}
