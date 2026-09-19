/**
 * Cloudinary Storage Provider Adapter
 *
 * The ONLY server-side module allowed to import the `cloudinary` SDK or
 * reference Cloudinary-specific concepts. Implements the provider-neutral
 * `StorageProvider` contract — see storage-provider.ts and
 * docs/architecture/domain/assets/storage.md.
 *
 * Upload authorization is fully server-decided: the client receives exactly
 * the params below and cannot choose its own public id, folder, or resource
 * type. Confirmation re-fetches the object from Cloudinary's Admin API
 * rather than trusting anything the client reports.
 */

import { v2 as cloudinary } from "cloudinary";

import { AssetCategory } from "@/generated/prisma";
import { ExternalServiceError } from "@/lib/errors";

import { ProviderObjectNotFoundError } from "../errors";
import type {
  StorageAuthorizeUploadInput,
  StorageConfirmUploadInput,
  StorageConfirmedObject,
  StorageProvider,
  StorageUploadAuthorization,
} from "./storage-provider";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UPLOAD_FOLDER = "kizunia/assets";

/**
 * Cloudinary resource type per Asset category. Isolated here — nothing
 * outside this file should ever need to know these strings.
 */
function resourceTypeFor(category: AssetCategory): "image" | "video" | "raw" {
  switch (category) {
    case AssetCategory.IMAGE:
      return "image";
    case AssetCategory.VIDEO:
      return "video";
    case AssetCategory.DOCUMENT:
      return "raw";
  }
}

/**
 * Cloudinary reports a bare format ("png", "pdf", ...), not a MIME type.
 * Policies are expressed in real MIME types (see policies/upload-policy.ts),
 * so the confirmed result has to be translated here — the one place that's
 * allowed to know Cloudinary's format vocabulary — rather than synthesized
 * from the resource type string, which would produce nonsense like
 * "raw/pdf" instead of "application/pdf".
 */
const FORMAT_TO_MIME_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  mp4: "video/mp4",
};

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
};

function mimeTypeFromFormat(format: string | undefined): string | null {
  if (!format) {
    return null;
  }

  return FORMAT_TO_MIME_TYPE[format.toLowerCase()] ?? null;
}

/**
 * Builds the full, final Cloudinary public id for an upload.
 *
 * This must produce the identical value at authorize time and at confirm
 * time, because it is both what gets signed and what gets looked up.
 *
 * Two Cloudinary behaviours make that non-obvious:
 *
 * 1. Passing a separate `folder` upload param makes Cloudinary store the
 *    object at `{folder}/{public_id}` — so the id it reports back is NOT
 *    the `public_id` that was signed. The folder is therefore baked into
 *    the public id here instead of being sent as its own parameter, which
 *    keeps signed id === stored id === looked-up id.
 *
 * 2. For `raw` resources (documents), Cloudinary makes the file extension
 *    part of the public id. Signing `.../{id}` and then looking up
 *    `.../{id}` fails, because the object is actually stored at
 *    `.../{id}.pdf`. Including the extension up front makes it stable.
 *    Image/video keep the extension in `format`, not in the public id.
 */
function buildObjectId(
  correlationId: string,
  category: AssetCategory,
  declaredMimeType: string,
): string {
  const base = `${UPLOAD_FOLDER}/${correlationId}`;

  if (resourceTypeFor(category) !== "raw") {
    return base;
  }

  const extension = MIME_TYPE_TO_EXTENSION[declaredMimeType.toLowerCase()];

  return extension ? `${base}.${extension}` : base;
}

/**
 * Extracts the useful parts of a Cloudinary SDK error for server-side logs.
 * The SDK nests its real status/message under `error`, so an unwrapped
 * throw reads as an opaque object in logs.
 */
function describeProviderError(error: unknown): {
  httpCode: number | undefined;
  message: string | undefined;
} {
  const candidate = error as
    | { error?: { http_code?: number; message?: string }; message?: string }
    | undefined;

  return {
    httpCode: candidate?.error?.http_code,
    message: candidate?.error?.message ?? candidate?.message,
  };
}

function requireCloudName(): string {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    throw new ExternalServiceError({
      code: "CLOUDINARY_NOT_CONFIGURED",
      message: "Cloudinary cloud name is not configured.",
    });
  }

  return cloudName;
}

function requireApiKey(): string {
  const apiKey = process.env.CLOUDINARY_API_KEY;

  if (!apiKey) {
    throw new ExternalServiceError({
      code: "CLOUDINARY_NOT_CONFIGURED",
      message: "Cloudinary API key is not configured.",
    });
  }

  return apiKey;
}

function requireApiSecret(): string {
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!apiSecret) {
    throw new ExternalServiceError({
      code: "CLOUDINARY_NOT_CONFIGURED",
      message: "Cloudinary API secret is not configured.",
    });
  }

  return apiSecret;
}

export class CloudinaryStorageProvider implements StorageProvider {
  async authorizeUpload(
    input: StorageAuthorizeUploadInput,
  ): Promise<StorageUploadAuthorization> {
    const resourceType = resourceTypeFor(input.category);

    const timestamp = Math.floor(Date.now() / 1_000);

    // Only these parameters are ever signed. The client cannot add,
    // remove, or override any of them — Cloudinary rejects the upload if
    // the submitted params don't match what was signed.
    //
    // The upload folder is part of `public_id` rather than a separate
    // `folder` param on purpose — see buildObjectId().
    const paramsToSign = {
      public_id: buildObjectId(
        input.correlationId,
        input.category,
        input.declaredMimeType,
      ),
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      requireApiSecret(),
    );

    return {
      provider: "CLOUDINARY",

      uploadUrl: `https://api.cloudinary.com/v1_1/${requireCloudName()}/${resourceType}/upload`,

      params: {
        ...paramsToSign,
        api_key: requireApiKey(),
        signature,
      },
    };
  }

  async confirmUpload(
    input: StorageConfirmUploadInput,
  ): Promise<StorageConfirmedObject> {
    const resourceType = resourceTypeFor(input.category);

    const objectId = buildObjectId(
      input.correlationId,
      input.category,
      input.declaredMimeType,
    );

    try {
      const resource = await cloudinary.api.resource(objectId, {
        resource_type: resourceType,
      });

      return {
        providerObjectId: resource.public_id,
        secureUrl: resource.secure_url,
        format: resource.format ?? null,
        mimeType: mimeTypeFromFormat(resource.format),
        width: resource.width ?? null,
        height: resource.height ?? null,
        bytes: resource.bytes ?? null,
        checksum: resource.etag ?? null,
      };
    } catch (error) {
      // Logged server-side so a confirmation failure is diagnosable without
      // a reproduction script. Deliberately not put on the error's
      // `details`, which is serialized to the client — provider internals
      // must not leak past this adapter.
      const provider = describeProviderError(error);

      console.error("Cloudinary confirmUpload failed", {
        objectId,
        resourceType,
        providerStatus: provider.httpCode,
        providerMessage: provider.message,
      });

      // Cloudinary's Admin API reports a missing resource as a 404 — that
      // is a confirmed, expected answer ("no such object"), not a failure
      // to reach the provider. Throwing a distinct error type lets callers
      // (see AssetReconciliationService.sweepAbandonedIntents) tell that
      // apart from a genuinely transient/ambiguous provider failure, which
      // must not be treated the same way.
      if (provider.httpCode === 404) {
        throw new ProviderObjectNotFoundError(
          `No provider object exists for "${objectId}".`,
        );
      }

      throw new ExternalServiceError({
        code: "CLOUDINARY_CONFIRM_FAILED",
        message: "Could not confirm the upload with the storage provider.",
        cause: error,
      });
    }
  }

  async deleteObject(
    providerObjectId: string,
    category: AssetCategory,
  ): Promise<void> {
    const resourceType = resourceTypeFor(category);

    try {
      const result = await cloudinary.uploader.destroy(providerObjectId, {
        resource_type: resourceType,
      });

      // Cloudinary resolves (rather than throws) `destroy` for an object
      // that no longer exists, reporting `result: "not found"` — this
      // adapter's contract (see StorageProvider.deleteObject) requires
      // treating that as success, not failure: a missing object is exactly
      // what "already deleted" looks like on retry. Anything else in
      // `result` is an unexpected outcome worth surfacing as a failure.
      if (result?.result !== "ok" && result?.result !== "not found") {
        throw new ExternalServiceError({
          code: "CLOUDINARY_DELETE_FAILED",
          message: `Cloudinary reported an unexpected delete result: "${result?.result}".`,
        });
      }
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw error;
      }

      throw new ExternalServiceError({
        code: "CLOUDINARY_DELETE_FAILED",
        message: "Could not delete the object from the storage provider.",
        cause: error,
      });
    }
  }

  /**
   * `raw` objects are not deliverable over the CDN on this account.
   *
   * Verified against the live cloud: an untransformed raw delivery URL —
   * the exact `secure_url` Cloudinary itself reports at upload time —
   * answers `401 Unauthorized` with `x-cld-error: deny or ACL failure`.
   * So does the same URL with `fl_attachment`, and so does either one when
   * signed with `sign_url`. Signing is not the missing ingredient: raw
   * delivery is blocked at the account level (Cloudinary restricts the
   * `raw` media type by default), and no URL served from
   * `res.cloudinary.com` will satisfy it. Image and video deliver normally
   * over the CDN, signed or not — the block is specific to `raw`.
   *
   * The provider's supported way to fetch such an object is the
   * authenticated download endpoint (`api.cloudinary.com/.../download`),
   * which the SDK builds and signs via `private_download_url`. That
   * returns `200` with the real bytes and the correct `application/pdf`
   * content type, so it serves both viewing and downloading — `attachment`
   * is what decides the Content-Disposition.
   *
   * Two consequences worth knowing:
   *   - The URL carries a timestamp Cloudinary only honours for about an
   *     hour, so it is generated per request and must not be cached or
   *     persisted. Pages here are server-rendered per request, so each
   *     load hands out a fresh one.
   *   - Cloudinary supplies the original upload filename on the
   *     Content-Disposition itself, which is why no filename is threaded
   *     through this path.
   */
  private buildRawObjectUrl(publicId: string, attachment: boolean): string {
    // The extension is already part of a raw public id (see buildObjectId),
    // so the `format` argument must stay empty or it would be doubled.
    return cloudinary.utils.private_download_url(publicId, "", {
      resource_type: "raw",
      type: "upload",
      attachment,
    });
  }

  buildViewUrl(input: {
    publicId: string;
    category: AssetCategory;
    secureUrl: string;
  }): string {
    if (resourceTypeFor(input.category) !== "raw") {
      // Public, CDN-cached, and already correct — nothing to exchange.
      return input.secureUrl;
    }

    return this.buildRawObjectUrl(input.publicId, false);
  }

  /**
   * Non-`raw` resources (IMAGE, VIDEO) are already served from the public
   * CDN via `secureUrl` — durable and safe to cache/persist in an admin
   * payload. `raw` (DOCUMENT) has no such URL on this account: the only way
   * to fetch it is `buildRawObjectUrl`'s authenticated endpoint, whose
   * timestamp Cloudinary only honours for about an hour (see
   * `buildRawObjectUrl`'s doc comment) — that is never returned here.
   */
  buildDurableViewUrl(input: {
    publicId: string;
    category: AssetCategory;
    secureUrl: string;
  }): string | null {
    if (resourceTypeFor(input.category) === "raw") {
      return null;
    }

    return input.secureUrl;
  }

  /**
   * Forces a download rather than an inline render.
   *
   * Documents go through the authenticated endpoint for the reasons above.
   * Image/video keep the CDN, where the `attachment` delivery flag does the
   * job; that URL is signed so it also holds up on clouds with "Strict
   * transformations" enabled, which would otherwise reject an unsigned
   * transformation.
   *
   * Built from `publicId`, not `secureUrl` — for `image`/`video`, `format`
   * restores the extension that `secureUrl` carries but a bare public id
   * does not.
   */
  buildDownloadUrl(input: {
    publicId: string;
    category: AssetCategory;
    format?: string | null;
    filename?: string | null;
  }): string {
    const resourceType = resourceTypeFor(input.category);

    if (resourceType === "raw") {
      return this.buildRawObjectUrl(input.publicId, true);
    }

    const sanitizedName = input.filename
      ?.replace(/\.[^./]+$/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .slice(0, 100);

    return cloudinary.url(input.publicId, {
      resource_type: resourceType,
      type: "upload",
      secure: true,
      sign_url: true,
      format: input.format ?? undefined,
      flags: sanitizedName ? `attachment:${sanitizedName}` : "attachment",
    });
  }
}
