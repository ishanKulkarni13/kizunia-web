import type { PortfolioVisibility } from "@/generated/prisma";

/**
 * The Portfolio as the owner's *editor* sees it — a deliberate, hand-mapped
 * contract, never a Prisma entity or payload.
 *
 * Intentionally small: it carries only what the editor chrome and the Profile
 * form read. Projects, testimonials and technologies are NOT part of it —
 * each has its own endpoint, DTO and visibility rules, and this aggregate
 * must not become a second way to fetch them. A future section (education,
 * experience, …) does not belong here either.
 *
 * Never exposed: `userId`, `deletedAt` (a deleted portfolio is refused, not
 * labelled), raw Asset rows (`publicId`, `secureUrl`, provider fields), the
 * owner's account fields, or anything about other users.
 *
 * Carries no date fields. Wherever a DTO does carry one it is an ISO string:
 * this payload crosses a JSON boundary, so a `Date` type would be a lie.
 */
export interface PortfolioEditorDto {
  id: string;

  displayName: string;

  headline: string | null;

  bio: string | null;

  phone: string | null;

  publicContactEmail: string | null;

  location: string | null;

  /** The owner's stored preference. Public display additionally depends on
   * entitlement and ban state, which are never persisted here. */
  visibility: PortfolioVisibility;

  user: {
    username: string | null;
  };

  resumeAsset: PortfolioEditorAssetDto | null;
}

export interface PortfolioEditorAssetDto {
  id: string;

  /**
   * A URL the browser can actually open. For a resume this is a signed,
   * short-lived URL minted for this response (see `buildAssetViewUrl`): it
   * is never stored, and must not be cached or persisted by the client
   * beyond the current editing session.
   */
  url: string;

  format: string | null;

  mimeType: string | null;
}
