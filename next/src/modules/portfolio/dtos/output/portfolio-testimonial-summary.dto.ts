/**
 * A testimonial as the Portfolio *editor* sees it — a deliberate,
 * hand-mapped contract, never a raw entity/Prisma passthrough. Testimonials
 * get their own dedicated endpoint and DTO; the editor aggregate
 * (`PortfolioEditorDto`) deliberately does not carry them.
 *
 * Never exposed: raw Asset internals (`publicId`, provider fields),
 * `portfolioId` (implicit — always the acting user's own portfolio),
 * `updatedAt`, or anything about who uploaded the image.
 */
export interface PortfolioTestimonialSummaryDto {
  id: string;

  name: string;

  position: string | null;

  company: string | null;

  message: string;

  rating: number | null;

  displayOrder: number;

  image: PortfolioTestimonialAssetDto | null;

  /** ISO 8601. */
  createdAt: string;
}

export interface PortfolioTestimonialAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}
