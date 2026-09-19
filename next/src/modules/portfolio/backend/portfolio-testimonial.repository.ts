/**
 * Portfolio Testimonials - Repository
 *
 * Responsible only for database access on the `Testimonial` model, scoped to
 * a single portfolio. Repositories should never contain business rules.
 *
 * Unlike Portfolio Projects, a Testimonial is Portfolio-owned content (not a
 * reference to another domain's source-of-truth entity), so there is no
 * membership/eligibility concept to enforce here — scoping by `portfolioId`
 * is the entire manageability rule.
 */

import { Prisma, PrismaClient, Testimonial } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { PortfolioTestimonialNotFoundError } from "../errors";

const testimonialWithImage = Prisma.validator<Prisma.TestimonialDefaultArgs>()({
  include: {
    imageAsset: {
      select: {
        id: true,
        secureUrl: true,
        width: true,
        height: true,
        format: true,
        mimeType: true,
      },
    },
  },
});

export type PortfolioTestimonialEntity = Prisma.TestimonialGetPayload<
  typeof testimonialWithImage
>;

export class PortfolioTestimonialRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  async findManyByPortfolio({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<PortfolioTestimonialEntity[]> {
    return this.db.testimonial.findMany({
      where: {
        portfolioId,
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      ...testimonialWithImage,
    });
  }

  /**
   * Ids owned by a portfolio, for validating a reorder request covers
   * exactly that portfolio's testimonials.
   */
  async findIdsByPortfolio({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<string[]> {
    const rows = await this.db.testimonial.findMany({
      where: {
        portfolioId,
      },
      select: {
        id: true,
      },
    });

    return rows.map((row) => row.id);
  }

  async findByIdForPortfolio({
    portfolioId,
    testimonialId,
  }: {
    portfolioId: string;
    testimonialId: string;
  }): Promise<Testimonial | null> {
    return this.db.testimonial.findFirst({
      where: {
        id: testimonialId,

        // Scoped by portfolio so an id from another portfolio (or a
        // Project-owned testimonial) cannot be read or mutated through this
        // portfolio's endpoints.
        portfolioId,
      },
    });
  }

  async findByIdForPortfolioOrThrow({
    portfolioId,
    testimonialId,
  }: {
    portfolioId: string;
    testimonialId: string;
  }): Promise<Testimonial> {
    const testimonial = await this.findByIdForPortfolio({
      portfolioId,
      testimonialId,
    });

    if (!testimonial) {
      throw new PortfolioTestimonialNotFoundError();
    }

    return testimonial;
  }

  /**
   * Display order for a testimonial appended to the end of a portfolio's
   * list.
   *
   * Returns the schema default (100) for the first testimonial. Callers must
   * hold a transaction, since two concurrent appends reading the same
   * maximum would collide.
   */
  async nextDisplayOrder({
    portfolioId,
  }: {
    portfolioId: string;
  }): Promise<number> {
    const last = await this.db.testimonial.aggregate({
      where: {
        portfolioId,
      },
      _max: {
        displayOrder: true,
      },
    });

    const highest = last._max.displayOrder;

    return highest === null ? 100 : highest + 1;
  }

  // =============================================================================
  // Create
  // =============================================================================

  async create({
    portfolioId,
    data,
  }: {
    portfolioId: string;
    data: {
      name: string;
      position: string | null;
      company: string | null;
      message: string;
      rating: number | null;
      imageAssetId: string | null;
      displayOrder: number;
    };
  }): Promise<Testimonial> {
    return this.db.testimonial.create({
      data: {
        ...data,
        portfolioId,
      },
    });
  }

  // =============================================================================
  // Update
  // =============================================================================

  async update({
    testimonialId,
    data,
  }: {
    testimonialId: string;
    data: Prisma.TestimonialUpdateInput;
  }): Promise<Testimonial> {
    return this.db.testimonial.update({
      where: {
        id: testimonialId,
      },
      data,
    });
  }

  // =============================================================================
  // Delete
  // =============================================================================

  async delete({ testimonialId }: { testimonialId: string }): Promise<void> {
    await this.db.testimonial.delete({
      where: {
        id: testimonialId,
      },
    });
  }
}
