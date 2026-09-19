/**
 * Assets Module - Service
 *
 * Owns Asset business operations: finalizing an upload into an ACTIVE Asset,
 * and the lifecycle transitions that follow (detach/deleting/deleted). See
 * docs/architecture/domain/assets/lifecycle.md.
 */

import {
  Asset,
  AssetCategory,
  AssetProvider,
  AssetPurpose,
  AssetStatus,
  Prisma,
} from "@/generated/prisma";

import { AssetMapper } from "../mapper/asset.mapper";
import type { AssetDTO } from "../dto/asset.dto";
import { AssetReferenceChecker } from "./reference-checker";
import { AssetRepository } from "./repository";
import { validateAssetForPurpose } from "./reference-policy";
import type { StorageConfirmedObject } from "./storage/storage-provider";

const assetMapper = new AssetMapper();

export class AssetService {
  private readonly repository = new AssetRepository();

  /**
   * Creates the Asset directly in ACTIVE from an authoritative,
   * provider-confirmed result. There is no intermediate Asset row for an
   * upload in progress — see lifecycle.md.
   */
  async finalize({
    tx,
    confirmed,
    category,
    uploadedById,
  }: {
    tx: Prisma.TransactionClient;
    confirmed: StorageConfirmedObject;
    category: AssetCategory;
    uploadedById: string;
  }): Promise<AssetDTO> {
    const repository = new AssetRepository(tx);

    const asset = await repository.createActive({
      provider: AssetProvider.CLOUDINARY,
      publicId: confirmed.providerObjectId,
      secureUrl: confirmed.secureUrl,
      format: confirmed.format,
      mimeType: confirmed.mimeType,
      width: confirmed.width,
      height: confirmed.height,
      bytes: confirmed.bytes,
      checksum: confirmed.checksum,
      originalFilename: null,
      category,
      uploadedById,
    });

    return assetMapper.toDTO(asset);
  }

  /**
   * Locks every Asset row an attach operation touches — the Asset being
   * attached and, if different, the one it is replacing — in a fixed
   * ascending-id order (never "new, then old" or vice versa), before either
   * is written to. A concurrent transaction doing the reverse swap (e.g.
   * two entities trading the same two Assets in opposite directions at the
   * same time) would otherwise be free to lock the same two rows in the
   * opposite order and deadlock against this one; a single fixed global
   * lock order makes that impossible. See
   * docs/architecture/domain/assets/lifecycle.md#concurrency.
   *
   * This is the authoritative, race-safe half of "is this Asset usable for
   * this purpose". Most callers also run `assertAssetReferenceAllowed`
   * before opening a transaction — that is a fast-fail UX check only, not a
   * guarantee: without re-validating again under this lock, a concurrent
   * reconciliation sweep could detach the Asset between that pre-check and
   * this transaction's commit, and the FK write that follows would go on to
   * reference an Asset already headed for deletion.
   *
   * Must be called before the FK write and before `detachIfUnreferenced`,
   * inside the same transaction as both. Pass `assetId: null` when the
   * caller is only clearing a slot (nothing to validate, but
   * `previousAssetId` — if any — is still locked here, ahead of the
   * `detachIfUnreferenced` call that follows).
   */
  async prepareAssetAttach(
    tx: Prisma.TransactionClient,
    {
      assetId,
      previousAssetId,
      purpose,
    }: {
      assetId: string | null;
      previousAssetId: string | null;
      purpose: AssetPurpose;
    },
  ): Promise<Asset | null> {
    const repository = new AssetRepository(tx);

    const ids = Array.from(
      new Set([assetId, previousAssetId].filter((id): id is string => !!id)),
    ).sort();

    const locked = new Map<string, Asset>();

    for (const id of ids) {
      const asset = await repository.lockForUpdate(id);

      if (asset) {
        locked.set(id, asset);
      }
    }

    if (assetId === null) {
      return null;
    }

    const asset = locked.get(assetId) ?? null;

    validateAssetForPurpose(asset, purpose);

    return asset;
  }

  /**
   * Transitions an Asset to DETACHED, but only if nothing still references
   * it. Assets may be shared (docs/architecture/domain/assets/overview.md),
   * so removing one reference must not detach an Asset another entity still
   * depends on. Callers invoke this AFTER already clearing/reassigning their
   * own reference, inside the same transaction, so the reference count seen
   * here reflects that change.
   *
   * Locks the Asset row before counting references — the same lock
   * `prepareAssetAttach` takes before writing a NEW reference to this
   * Asset. Whichever transaction reaches this row first (this detach, or a
   * concurrent attach) fully commits before the other proceeds past its own
   * lock acquisition, so the reference count read here can never go stale
   * before `markDetached` runs below. Without this lock, a concurrent
   * attach could write its reference after the count was read here but
   * before the DETACHED transition committed, leaving a live reference
   * pointing at an Asset that is now DETACHED (and, eventually, deleted).
   * See docs/architecture/domain/assets/lifecycle.md#concurrency.
   *
   * Returns whether this call actually performed the transition — `false`
   * if the Asset was still referenced, or was not `ACTIVE` to begin with
   * (already detached by a concurrent call, or never existed). Callers that
   * only care about the side effect can ignore the return value; it exists
   * for reconciliation, which needs to count how many candidates it
   * actually detached.
   */
  async detachIfUnreferenced(
    tx: Prisma.TransactionClient,
    assetId: string,
  ): Promise<boolean> {
    const repository = new AssetRepository(tx);

    const asset = await repository.lockForUpdate(assetId);

    if (!asset || asset.status !== AssetStatus.ACTIVE) {
      return false;
    }

    const remaining = await AssetReferenceChecker.countReferences(tx, assetId);

    if (remaining > 0) {
      return false;
    }

    await repository.markDetached(assetId);

    return true;
  }

  async findById(id: string) {
    return this.repository.findById({ id });
  }
}

export const assetService = new AssetService();
