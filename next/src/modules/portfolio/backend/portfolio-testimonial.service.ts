/**
 * Portfolio Testimonials - Service
 *
 * Owns authorization, ordering correctness, image attach/replace/detach
 * orchestration, and repository orchestration for a portfolio's
 * Testimonials. Mutations return the portfolio's full, server-ordered
 * testimonial list — mirroring Portfolio Projects and Project Testimonials.
 *
 * The portfolio is always resolved from the session (`actor.id`), never
 * accepted as a client-supplied id — matching every other Portfolio
 * mutation in this module.
 *
 * Image management is part of testimonial management: there is no separate
 * "manage testimonial image" action. A caller authorized to add/update/
 * remove a testimonial is authorized to attach/replace/remove its image.
 */

import { AssetPurpose } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { isExactCover } from "@/modules/links";
import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import type { StrictAuthorizationActor } from "@/authorization";
import { PortfolioAuthorizer, PortfolioContextResolver } from "./authorization";
import { PortfolioMapper } from "./mapper/mapper";
import { PortfolioTestimonialRepository } from "./portfolio-testimonial.repository";
import { PortfolioRepository } from "./repository";
import type { PortfolioAuthorizationEntity } from "./repository";
import type { PortfolioTestimonialSummaryDto } from "../dtos";
import { PortfolioTestimonialReorderMismatchError } from "../errors";
import type {
  AddPortfolioTestimonialInput,
  ReorderPortfolioTestimonialsInput,
  UpdatePortfolioTestimonialInput,
} from "../schemas/portfolio-testimonial.schema";

export class PortfolioTestimonialService {
  private readonly repository = new PortfolioTestimonialRepository();

  private readonly portfolioRepository = new PortfolioRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    return this.getOrderedTestimonials({ portfolio });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async add({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: AddPortfolioTestimonialInput;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const imageAssetId = dto.imageAssetId ?? null;

    if (imageAssetId !== null) {
      await assertAssetReferenceAllowed({
        assetId: imageAssetId,
        purpose: AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE,
      });
    }

    await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      await assetService.prepareAssetAttach(tx, {
        assetId: imageAssetId,
        previousAssetId: null,
        purpose: AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE,
      });

      const repository = new PortfolioTestimonialRepository(tx);

      const displayOrder = await repository.nextDisplayOrder({
        portfolioId: portfolio.id,
      });

      await repository.create({
        portfolioId: portfolio.id,
        data: {
          name: dto.name,
          position: dto.position ?? null,
          company: dto.company ?? null,
          message: dto.message,
          rating: dto.rating ?? null,
          imageAssetId,
          displayOrder,
        },
      });
    });

    return this.getOrderedTestimonials({ portfolio });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  async update({
    actor,
    testimonialId,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    testimonialId: string;
    dto: UpdatePortfolioTestimonialInput;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const existing = await this.repository.findByIdForPortfolioOrThrow({
      portfolioId: portfolio.id,
      testimonialId,
    });

    const nextImageAssetId =
      dto.imageAssetId === undefined ? existing.imageAssetId : dto.imageAssetId;

    // Same-id replacement (including "no image before, no image now") must be
    // a safe no-op — never re-validate/re-attach/detach an unchanged image.
    const imageChanged = nextImageAssetId !== existing.imageAssetId;

    if (imageChanged && nextImageAssetId !== null) {
      await assertAssetReferenceAllowed({
        assetId: nextImageAssetId,
        purpose: AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE,
      });
    }

    await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      if (imageChanged) {
        await assetService.prepareAssetAttach(tx, {
          assetId: nextImageAssetId,
          previousAssetId: existing.imageAssetId,
          purpose: AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE,
        });
      }

      const repository = new PortfolioTestimonialRepository(tx);

      await repository.findByIdForPortfolioOrThrow({
        portfolioId: portfolio.id,
        testimonialId,
      });

      await repository.update({
        testimonialId,
        data: {
          ...(dto.name !== undefined && { name: dto.name }),

          ...(dto.position !== undefined && { position: dto.position }),

          ...(dto.company !== undefined && { company: dto.company }),

          ...(dto.message !== undefined && { message: dto.message }),

          ...(dto.rating !== undefined && { rating: dto.rating }),

          ...(imageChanged && { imageAssetId: nextImageAssetId }),
        },
      });

      if (imageChanged && existing.imageAssetId) {
        await assetService.detachIfUnreferenced(tx, existing.imageAssetId);
      }
    });

    return this.getOrderedTestimonials({ portfolio });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  async remove({
    actor,
    testimonialId,
  }: {
    actor: StrictAuthorizationActor;
    testimonialId: string;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const existing = await this.repository.findByIdForPortfolioOrThrow({
      portfolioId: portfolio.id,
      testimonialId,
    });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioTestimonialRepository(tx);

      await repository.findByIdForPortfolioOrThrow({
        portfolioId: portfolio.id,
        testimonialId,
      });

      await repository.delete({ testimonialId });

      if (existing.imageAssetId) {
        await assetService.detachIfUnreferenced(tx, existing.imageAssetId);
      }
    });

    return this.getOrderedTestimonials({ portfolio });
  }

  // ===========================================================================
  // Reorder
  // ===========================================================================

  /**
   * Rewrites presentation order from a full list of ids. The request must
   * name every testimonial exactly once — a partial list would leave the
   * remainder at stale positions.
   */
  async reorder({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: ReorderPortfolioTestimonialsInput;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioTestimonialRepository(tx);

      const owned = await repository.findIdsByPortfolio({
        portfolioId: portfolio.id,
      });

      if (!isExactCover(owned, dto.testimonialIds)) {
        throw new PortfolioTestimonialReorderMismatchError();
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, id] of dto.testimonialIds.entries()) {
        await repository.update({
          testimonialId: id,
          data: {
            displayOrder: index,
          },
        });
      }
    });

    return this.getOrderedTestimonials({ portfolio });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Resolves the acting user's own portfolio and asserts they may manage its
   * testimonials.
   *
   * The portfolio is keyed by `actor.id` from the verified session, never by
   * a client-supplied id, so cross-portfolio mutation is structurally
   * impossible rather than merely rejected.
   */
  private async authorizeManage({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioAuthorizationEntity> {
    const portfolio =
      await this.portfolioRepository.findForAuthorizationByUserIdOrThrow({
        userId: actor.id,
      });

    const context = PortfolioContextResolver.fromData({
      actor,
      portfolio,
    });

    PortfolioAuthorizer.manageTestimonials(context);

    return portfolio;
  }

  private async getOrderedTestimonials({
    portfolio,
  }: {
    portfolio: PortfolioAuthorizationEntity;
  }): Promise<PortfolioTestimonialSummaryDto[]> {
    const testimonials = await this.repository.findManyByPortfolio({
      portfolioId: portfolio.id,
    });

    return PortfolioMapper.toTestimonialSummaryDtos(testimonials);
  }
}

export const portfolioTestimonialService = new PortfolioTestimonialService();
