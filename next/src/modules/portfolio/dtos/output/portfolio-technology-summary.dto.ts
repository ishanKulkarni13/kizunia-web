import type { TechnologyType } from "@/generated/prisma";

/**
 * A technology as the Portfolio *editor* sees it — a deliberate, hand-mapped
 * contract, never a raw entity/Prisma passthrough. Unlike
 * `PortfolioProjectSummaryDto`, this is Portfolio-owned relationship data:
 * the owner explicitly chose to add it, complete with its own
 * relationship-specific metadata (`startedUsingAt`, `description`) and
 * ordering — it is never derived from `ProjectTechnology`.
 *
 * Never exposed: raw Technology internals (`description` — the catalog
 * entry's own description, distinct from this relationship's `description`
 * — `deletedAt`, `createdAt`, `updatedAt`), or `portfolioId` (implicit —
 * always the acting user's own portfolio).
 */
export interface PortfolioTechnologySummaryDto {
  /**
   * Half of the relationship's composite key, and the address used by every
   * mutation. The other half is always derived from the session, so there
   * is no relationship id a client could guess.
   */
  technologyId: string;

  name: string;

  slug: string;

  type: TechnologyType;

  icon: PortfolioTechnologyAssetDto | null;

  /** When the owner started using this technology. Relationship metadata,
   * not a property of the Technology itself. */
  startedUsingAt: string | null;

  /** The owner's own note about this technology. Relationship metadata,
   * not the catalog entry's `description`. */
  description: string | null;

  displayOrder: number;
}

export interface PortfolioTechnologyAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}
