/**
 * UploadIntent Service — the Asset Application Layer.
 *
 * Owns issuing scoped, policy-validated upload authorization (never "sign
 * whatever the client sends") and consuming that authorization once the
 * provider upload completes. See docs/architecture/domain/assets/upload.md.
 */

import crypto from "crypto";

import { AssetCategory, AssetPurpose, UploadIntent } from "@/generated/prisma";
import type { AuthorizationActor } from "@/authorization";
import { UnauthorizedError, ValidationError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import type { AssetDTO } from "../dto/asset.dto";
import {
  UploadIntentActorMismatchError,
  UploadIntentAlreadyConsumedError,
  UploadIntentExpiredError,
  UploadIntentNotFoundError,
  UploadPolicyViolationError,
} from "./errors";
import {
  getUploadPolicy,
  resolveUploadCategory,
  resolveUploadMaxSize,
} from "./policies/upload-policy";
import { assetService } from "./service";
import { getStorageProvider } from "./storage";
import type { StorageUploadAuthorization } from "./storage/storage-provider";
import { authorizeUploadForPurpose } from "./target-authorization";
import { UploadIntentRepository } from "./upload-intent.repository";

/**
 * Not decided anywhere in the architecture docs — marked TBD there. This is
 * a deliberately conservative V1 default, isolated here so it can change
 * without touching calling code.
 */
const UPLOAD_INTENT_TTL_MS = 15 * 60 * 1_000;

export interface CreateUploadIntentInput {
  actorId: string;
  purpose: AssetPurpose;
  category: AssetCategory;
  targetEntityType: string | null;
  targetEntityId: string | null;
  providerCorrelationId: string;
  declaredMimeType: string;
  declaredSize: number;
  expiresAt: Date;
}

export interface CreateUploadIntentResult {
  intentId: string;
  provider: StorageUploadAuthorization["provider"];
  uploadUrl: string;
  params: Record<string, string | number>;
  expiresAt: Date;
}

export interface FinalizeUploadInput {
  actor: AuthorizationActor;
  intentId: string;
}

export class UploadIntentService {
  private readonly repository = new UploadIntentRepository();

  async create({
    actor,
    purpose,
    targetEntityType,
    targetEntityId,
    declaredMimeType,
    declaredSize,
  }: {
    actor: AuthorizationActor;
    purpose: AssetPurpose;
    targetEntityType?: string;
    targetEntityId?: string;
    declaredMimeType: string;
    declaredSize: number;
  }): Promise<CreateUploadIntentResult> {
    if (!actor.id) {
      throw new UnauthorizedError({
        code: "unauthorized",
        message: "Authentication is required to request an upload.",
      });
    }

    const policy = getUploadPolicy(purpose);

    if (policy.requiresTargetEntity && !targetEntityId) {
      throw new ValidationError({
        code: "TARGET_ENTITY_REQUIRED",
        status: 400,
        message: `${purpose} requires a target entity id.`,
      });
    }

    // Target-domain authorization FIRST — an actor unauthorized for the
    // target entity must never receive upload authorization for it.
    await authorizeUploadForPurpose({
      actor,
      purpose,
      targetEntityId,
    });

    // Policy validation of the DECLARED file, before any provider call.
    if (!policy.allowedMimeTypes.includes(declaredMimeType)) {
      throw new UploadPolicyViolationError(
        `${purpose} does not allow files of type "${declaredMimeType}".`,
      );
    }

    const declaredMaxSize = resolveUploadMaxSize(policy, declaredMimeType);

    if (declaredSize > declaredMaxSize) {
      throw new UploadPolicyViolationError(
        `${purpose} allows files up to ${declaredMaxSize} bytes; this file declares ${declaredSize} bytes.`,
      );
    }

    // Server-generated correlation id — never client-supplied. This is what
    // the storage provider uses as the object identifier, so the eventual
    // result can be securely matched back to exactly this intent.
    const correlationId = crypto.randomUUID();

    const resolvedCategory = resolveUploadCategory(policy, declaredMimeType);

    const authorization = await getStorageProvider().authorizeUpload({
      correlationId,
      category: resolvedCategory,
      declaredMimeType,
      maxBytes: declaredMaxSize,
    });

    const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS);

    const intent = await this.repository.create({
      actorId: actor.id,
      purpose,
      category: resolvedCategory,
      targetEntityType: targetEntityType ?? null,
      targetEntityId: targetEntityId ?? null,
      providerCorrelationId: correlationId,
      declaredMimeType,
      declaredSize,
      expiresAt,
    });

    return {
      intentId: intent.id,
      provider: authorization.provider,
      uploadUrl: authorization.uploadUrl,
      params: authorization.params,
      expiresAt,
    };
  }

  /**
   * Confirms the completed provider upload and finalizes the Asset directly
   * into ACTIVE. Single-use and race-safe: `markConsumed` only succeeds
   * against a still-PENDING intent, so a concurrent or repeated finalize
   * call fails rather than double-creating an Asset.
   *
   * If the provider result fails validation after the provider upload
   * already exists, this attempts immediate best-effort provider cleanup —
   * reconciliation is the fallback if that cleanup itself fails.
   */
  async finalize({ actor, intentId }: FinalizeUploadInput): Promise<AssetDTO> {
    const intent = await this.loadPendingIntentForActor({ actor, intentId });

    const storage = getStorageProvider();

    let confirmed;

    try {
      confirmed = await storage.confirmUpload({
        correlationId: intent.providerCorrelationId,
        category: intent.category,
        declaredMimeType: intent.declaredMimeType,
      });
    } catch (error) {
      // Nothing was ever confirmed to exist — there is nothing to clean up.
      throw error;
    }

    const policy = getUploadPolicy(intent.purpose);

    const confirmedMaxSize = resolveUploadMaxSize(
      policy,
      confirmed.mimeType ?? intent.declaredMimeType,
    );

    const violatesPolicy =
      (confirmed.bytes ?? 0) > confirmedMaxSize ||
      (confirmed.mimeType !== null &&
        !policy.allowedMimeTypes.includes(confirmed.mimeType));

    if (violatesPolicy) {
      await this.bestEffortCleanup(intent, confirmed.providerObjectId);

      throw new UploadPolicyViolationError(
        "The uploaded file does not match what was authorized for this purpose.",
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const asset = await assetService.finalize({
          tx,
          confirmed,
          category: intent.category,
          uploadedById: intent.actorId,
        });

        // Scoped to still-PENDING, so a concurrent finalize call racing on
        // the same intent loses here and the whole transaction (including
        // the Asset row just created) rolls back — single-use is enforced
        // atomically, not just checked earlier.
        const consumedCount = await new UploadIntentRepository(tx).markConsumed(
          {
            id: intent.id,
            resultAssetId: asset.id,
          },
        );

        if (consumedCount === 0) {
          throw new UploadIntentAlreadyConsumedError();
        }

        return asset;
      });
    } catch (error) {
      if (error instanceof UploadIntentAlreadyConsumedError) {
        throw error;
      }

      // Provider upload exists but finalization failed after confirmation —
      // attempt immediate best-effort cleanup; reconciliation is the
      // fallback if this itself fails (see reconciliation.service.ts).
      await this.bestEffortCleanup(intent, confirmed.providerObjectId);

      throw error;
    }
  }

  private async loadPendingIntentForActor({
    actor,
    intentId,
  }: {
    actor: AuthorizationActor;
    intentId: string;
  }): Promise<UploadIntent> {
    const intent = await this.repository.findById({ id: intentId });

    if (!intent) {
      throw new UploadIntentNotFoundError();
    }

    if (!actor.id || intent.actorId !== actor.id) {
      throw new UploadIntentActorMismatchError();
    }

    if (intent.status === "CONSUMED") {
      throw new UploadIntentAlreadyConsumedError();
    }

    if (intent.status === "EXPIRED" || intent.expiresAt.getTime() < Date.now()) {
      throw new UploadIntentExpiredError();
    }

    return intent;
  }

  private async bestEffortCleanup(
    intent: Pick<UploadIntent, "category">,
    providerObjectId: string,
  ): Promise<void> {
    try {
      await getStorageProvider().deleteObject(providerObjectId, intent.category);
    } catch {
      // Swallowed deliberately: this is the "immediate best-effort" attempt.
      // Reconciliation sweeps orphaned provider objects independently.
    }
  }
}

export const uploadIntentService = new UploadIntentService();
