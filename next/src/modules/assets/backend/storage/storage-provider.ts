/**
 * Storage Provider Contract
 *
 * Provider-neutral boundary between the Asset application layer and whatever
 * actually stores the bytes (Cloudinary today). Nothing outside
 * `storage/cloudinary.provider.ts` may import the `cloudinary` SDK or
 * reference Cloudinary-specific concepts (public_id semantics, resource
 * types, transformation syntax, etc).
 *
 * See docs/architecture/domain/assets/storage.md.
 */

import type { AssetCategory } from "@/generated/prisma";

export interface StorageUploadAuthorization {
  /** Which provider this authorization is for. Informational only. */
  provider: "CLOUDINARY";

  /** Where the client must submit the upload directly. */
  uploadUrl: string;

  /**
   * The exact, server-decided parameters the client must submit unmodified.
   * The client cannot choose its own public id, folder, or resource type —
   * these are fixed by the provider adapter for this one authorized upload.
   */
  params: Record<string, string | number>;
}

export interface StorageAuthorizeUploadInput {
  /**
   * Server-generated identifier for this upload attempt. Used as the
   * provider-side object identifier so the eventual result can be securely
   * correlated back to the UploadIntent that authorized it.
   */
  correlationId: string;

  category: AssetCategory;

  /**
   * The policy-validated MIME type this upload was authorized for.
   *
   * The provider needs it because some providers derive part of the stored
   * object's identity from the file kind, so the identifier must be built
   * the same way at authorize time and at confirm time. Always one of the
   * purpose policy's allowed types — never a raw client value.
   */
  declaredMimeType: string;

  /** Policy-enforced ceiling communicated to the provider where supported. */
  maxBytes: number;
}

export interface StorageConfirmUploadInput {
  correlationId: string;
  category: AssetCategory;
  /** Must match the value given to `authorizeUpload` for this correlation id. */
  declaredMimeType: string;
}

/**
 * Authoritative metadata read back from the provider — never trusted from
 * the client. See docs/architecture/domain/assets/security.md.
 */
export interface StorageConfirmedObject {
  providerObjectId: string;
  secureUrl: string;
  format: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  checksum: string | null;
}

export interface StorageProvider {
  /** Prepares a scoped, single-use authorization for one upload attempt. */
  authorizeUpload(
    input: StorageAuthorizeUploadInput,
  ): Promise<StorageUploadAuthorization>;

  /**
   * Confirms a completed upload by asking the provider directly what it
   * actually holds for this correlation id — never the client's own report.
   *
   * Throws `ProviderObjectNotFoundError` (see ../errors) if the provider has
   * confirmed there is no matching object — a real, expected answer, not a
   * failure to reach the provider. Any other failure (network, auth,
   * transient outage) throws `ExternalServiceError` instead. Callers that
   * need to tell "confirmed absent" apart from "could not confirm" must
   * distinguish on the error type, not treat every throw identically.
   */
  confirmUpload(
    input: StorageConfirmUploadInput,
  ): Promise<StorageConfirmedObject>;

  /** Physically removes the stored object. Idempotent: a missing object is not an error. */
  deleteObject(providerObjectId: string, category: AssetCategory): Promise<void>;

  /**
   * Derives a URL the browser can open to *view* the object inline.
   *
   * This exists because a stored `secureUrl` is not universally openable:
   * a provider may serve some categories over a public CDN and gate others
   * behind an access-controlled endpoint, in which case the persisted URL
   * is correct-but-undeliverable and must be exchanged for a usable one.
   * Which categories those are is entirely provider-specific, so callers
   * must always render this rather than `secureUrl` directly.
   *
   * `secureUrl` is passed in so a provider can return it unchanged for the
   * categories where it already works — never for string surgery.
   */
  buildViewUrl(input: {
    publicId: string;
    category: AssetCategory;
    secureUrl: string;
  }): string;

  /**
   * Derives a URL that causes the browser to save the file rather than
   * render it inline. Pure (no network call), but provider-specific
   * delivery/security settings can mean it must be cryptographically signed
   * rather than merely string-built — that's an implementation detail of
   * the provider, not of this contract.
   *
   * `publicId` is the provider's own object identifier (never derived from
   * `secureUrl` by string surgery), and the returned URL must resolve to the
   * exact same object.
   *
   * Plain `<a download>` does not force a download for a cross-origin URL
   * (the attribute is ignored), so a real "Download" action needs the
   * disposition encoded in the URL itself — how that's done is entirely
   * provider-specific.
   */
  buildDownloadUrl(input: {
    publicId: string;
    category: AssetCategory;
    format?: string | null;
    filename?: string | null;
  }): string;

  /**
   * A durable, non-expiring URL safe to place in a list/preview payload —
   * or `null` when this category can only be delivered via a signed,
   * temporary URL, in which case the caller must use the authorized
   * download flow instead (see AssetAdminService.getDownloadTarget /
   * docs/architecture/domain/assets/lifecycle.md).
   *
   * This exists so admin list/detail/reconciliation-preview DTOs never need
   * to know which categories are safe to cache or persist a URL for — that
   * is provider knowledge, not application knowledge. `secureUrl` is passed
   * in so a provider can return it unchanged for the categories where it
   * already works, exactly like `buildViewUrl` — never for string surgery.
   */
  buildDurableViewUrl(input: {
    publicId: string;
    category: AssetCategory;
    secureUrl: string;
  }): string | null;
}
