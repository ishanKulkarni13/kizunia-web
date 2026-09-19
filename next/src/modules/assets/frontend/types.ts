/**
 * Frontend-only Asset types. Deliberately NOT imported from
 * `@/generated/prisma` — frontend code in this repo does not depend on
 * Prisma-generated types, and these mirror the backend enums exactly.
 */

export type AssetPurpose =
  | "USER_AVATAR"
  | "USER_COVER"
  | "PROJECT_LOGO"
  | "PROJECT_COVER"
  | "COMPETITION_LOGO"
  | "COMPETITION_BANNER"
  | "COMPETITION_COVER"
  | "COMPETITION_SUGGESTION_GALLERY"
  | "PORTFOLIO_RESUME"
  | "PORTFOLIO_EDUCATION_LOGO"
  | "PORTFOLIO_EXPERIENCE_LOGO"
  | "PORTFOLIO_ACHIEVEMENT_ASSET"
  | "PORTFOLIO_CERTIFICATION_ASSET"
  /** @deprecated Use PROJECT_TESTIMONIAL_IMAGE / PORTFOLIO_TESTIMONIAL_IMAGE. */
  | "TESTIMONIAL_IMAGE"
  | "PROJECT_TESTIMONIAL_IMAGE"
  | "PORTFOLIO_TESTIMONIAL_IMAGE"
  | "BADGE_ICON"
  | "TECHNOLOGY_ICON";

export type AssetStatus = "ACTIVE" | "DETACHED" | "DELETING" | "DELETED";

export type AssetCategory = "IMAGE" | "VIDEO" | "DOCUMENT";

/**
 * The finalized Asset as returned by the backend. Provider-neutral — no
 * Cloudinary-specific field ever appears here (see
 * docs/architecture/domain/assets/storage.md).
 */
export interface AssetDTO {
  id: string;
  secureUrl: string;
  publicId: string;
  format: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  originalFilename: string | null;
  status: AssetStatus;
  category: AssetCategory;

  /**
   * The URL a "View" link should open. Prefer this over `secureUrl`
   * wherever it is present: for some categories (documents, today) the
   * stored `secureUrl` is not deliverable and only this one resolves.
   * Falls back to `secureUrl` when a producer does not compute it.
   */
  viewUrl?: string;

  /**
   * A URL that forces a download rather than an inline render. Only
   * populated by endpoints that explicitly compute it (currently
   * Competition Suggestion reads) — not every AssetDTO producer sets this,
   * so treat its absence as "no download link available" rather than a bug.
   */
  downloadUrl?: string;
}
