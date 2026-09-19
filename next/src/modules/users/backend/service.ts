/**
 * Users Module — Service
 *
 * Owns User business operations. Currently: keeping a User's avatar/cover
 * Asset references correct end-to-end (set, replace, remove).
 *
 * `User.avatarAssetId`/`coverAssetId` are the single authoritative
 * Kizunia-owned reference to a User's avatar/cover Asset — see
 * docs/architecture/domain/assets/overview.md and the note in
 * docs/architecture/domain/assets/lifecycle.md on User asset integration.
 * This service is the only place either field is ever written. It does not
 * read or write Better Auth's own `image` field, which is a separate,
 * pre-existing, auth/OAuth-native concept this work deliberately leaves
 * untouched (see that same doc for why).
 *
 * Mirrors CompetitionAssetService.setAsset / ProjectService.setAsset
 * exactly, adapted for a self-only target: there is no membership/role gate
 * beyond "is this the caller's own row" — a user may only ever set their
 * own avatar/cover.
 */

import prisma from "@/lib/prisma";
import { AssetPurpose } from "@/generated/prisma";
import type { StrictAuthorizationActor } from "@/authorization";

import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import { UserRepository } from "./repository";
import { UserNotFoundError } from "./errors";
import { toUserAssetDTO } from "./mapper";
import type { UserAssetSlot } from "../types/asset-slot";
import type { UserAssetDTO } from "../types";

const SLOT_PURPOSE: Record<UserAssetSlot, AssetPurpose> = {
  avatar: AssetPurpose.USER_AVATAR,
  cover: AssetPurpose.USER_COVER,
};

export class UserService {
  private readonly repository = new UserRepository();

  /**
   * Sets, replaces, or clears (`assetId: null`) the caller's own avatar or
   * cover Asset.
   *
   * - A new Asset is validated with `assertAssetReferenceAllowed` (exists,
   *   ACTIVE, correct category for the slot) before anything is written.
   *   Ownership/`uploadedById` is never checked — a shared Asset is exactly
   *   as valid a reference as one this actor uploaded themselves, per the
   *   rest of the Asset domain's established policy.
   * - The FK swap and the previous Asset's detach happen inside one
   *   transaction, so a failure between them can never leave the User
   *   pointing at a new Asset while the old one is left dangling, or vice
   *   versa.
   * - Resubmitting the Asset that is already set is a safe no-op: the
   *   `previousAssetId !== assetId` guard means the still-current Asset is
   *   never redundantly detached, and no unnecessary Asset lifecycle
   *   transition occurs.
   * - Removing an already-cleared slot is equally a no-op for the same
   *   reason (`previousAssetId` is already null).
   */
  async setAsset({
    actor,
    slot,
    assetId,
  }: {
    actor: StrictAuthorizationActor;
    slot: UserAssetSlot;
    assetId: string | null;
  }): Promise<UserAssetDTO> {
    const user = await this.repository.findById(actor.id);

    if (!user) {
      throw new UserNotFoundError();
    }

    // A null assetId clears the slot and has nothing to validate.
    if (assetId !== null) {
      await assertAssetReferenceAllowed({
        assetId,
        purpose: SLOT_PURPOSE[slot],
      });
    }

    const previousAssetId =
      slot === "avatar" ? user.avatarAssetId : user.coverAssetId;

    const updated = await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      await assetService.prepareAssetAttach(tx, {
        assetId,
        previousAssetId,
        purpose: SLOT_PURPOSE[slot],
      });

      const repository = new UserRepository(tx);

      const updatedUser = await repository.setAsset(actor.id, slot, assetId);

      // Detach the previous asset in this slot, if any, now that nothing in
      // this transaction still points at it (unless it's shared elsewhere —
      // detachIfUnreferenced checks that). Skipped entirely when the "new"
      // asset id equals the old one, so an unchanged slot is never
      // redundantly detached.
      if (previousAssetId && previousAssetId !== assetId) {
        await assetService.detachIfUnreferenced(tx, previousAssetId);
      }

      return updatedUser;
    });

    return toUserAssetDTO(updated, slot);
  }
}

export const userService = new UserService();
