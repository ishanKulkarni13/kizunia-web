/**
 * Project Testimonials - Repository
 *
 * Responsible only for database access on the `Testimonial` model, scoped to
 * a single project. Repositories should never contain business rules.
 */

import { Prisma, PrismaClient, Testimonial } from "@/generated/prisma";
import prisma from "@/lib/prisma";

import { ProjectTestimonialNotFoundError } from "./errors";

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

export type ProjectTestimonialEntity = Prisma.TestimonialGetPayload<
  typeof testimonialWithImage
>;

export class ProjectTestimonialRepository {
  constructor(
    private readonly db: PrismaClient | Prisma.TransactionClient = prisma,
  ) {}

  // =============================================================================
  // Read
  // =============================================================================

  async findManyByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectTestimonialEntity[]> {
    return this.db.testimonial.findMany({
      where: {
        projectId,
      },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
      ...testimonialWithImage,
    });
  }

  /**
   * Ids owned by a project, for validating a reorder request covers exactly
   * that project's testimonials.
   */
  async findIdsByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const rows = await this.db.testimonial.findMany({
      where: {
        projectId,
      },
      select: {
        id: true,
      },
    });

    return rows.map((row) => row.id);
  }

  async findByIdForProject({
    projectId,
    testimonialId,
  }: {
    projectId: string;
    testimonialId: string;
  }): Promise<Testimonial | null> {
    return this.db.testimonial.findFirst({
      where: {
        id: testimonialId,

        // Scoped by project so an id from another project (or a
        // Portfolio-owned testimonial) cannot be read or mutated through
        // this project's endpoints.
        projectId,
      },
    });
  }

  async findByIdForProjectOrThrow({
    projectId,
    testimonialId,
  }: {
    projectId: string;
    testimonialId: string;
  }): Promise<Testimonial> {
    const testimonial = await this.findByIdForProject({
      projectId,
      testimonialId,
    });

    if (!testimonial) {
      throw new ProjectTestimonialNotFoundError();
    }

    return testimonial;
  }

  /**
   * Display order for a testimonial appended to the end of a project's list.
   *
   * Returns the schema default (100) for the first testimonial. Callers must
   * hold a transaction, since two concurrent appends reading the same
   * maximum would collide.
   */
  async nextDisplayOrder({
    projectId,
  }: {
    projectId: string;
  }): Promise<number> {
    const last = await this.db.testimonial.aggregate({
      where: {
        projectId,
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
    projectId,
    data,
  }: {
    projectId: string;
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
        projectId,
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
