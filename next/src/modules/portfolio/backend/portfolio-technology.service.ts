/**
 * Portfolio Technologies - Service
 *
 * Owns the business rules for the Portfolio ↔ Technology relationship:
 * authorization, catalog eligibility, ordering, and transactions.
 *
 * PortfolioTechnology is never auto-derived from a portfolio owner's
 * ProjectTechnology rows — it exists solely to let the owner curate which
 * technologies they want to present as part of their professional profile.
 * Nothing here ever reads or writes ProjectTechnology/CompetitionTechnology.
 *
 * Authorization is a single check, derived from trusted server-side state:
 * the portfolio is resolved from the session, so there is no id for a
 * client to tamper with. Unlike Portfolio Projects there is no membership
 * concept to also enforce — any active, non-deleted Technology from the
 * global catalog is eligible, re-validated independently here regardless of
 * what a client-side picker shows.
 *
 * Mutations return the portfolio's full, server-ordered technology list so
 * the editor always reflects server-assigned ordering rather than guessing
 * at it locally — mirroring Portfolio Projects/Testimonials.
 */

import type { StrictAuthorizationActor } from "@/authorization";
import prisma from "@/lib/prisma";
import { isExactCover } from "@/modules/links";
import { TechnologyRepository } from "@/modules/technologies/backend/repository";
import { TechnologyNotFoundError } from "@/modules/technologies/errors";

import { PortfolioAuthorizer, PortfolioContextResolver } from "./authorization";
import { PortfolioMapper } from "./mapper/mapper";
import { PortfolioTechnologyRepository } from "./portfolio-technology.repository";
import { PortfolioRepository } from "./repository";
import type { PortfolioAuthorizationEntity } from "./repository";
import type { PortfolioTechnologySummaryDto } from "../dtos";
import {
  PortfolioTechnologyNotFoundError,
  PortfolioTechnologyReorderMismatchError,
} from "../errors";
import type {
  AddPortfolioTechnologyInput,
  ReorderPortfolioTechnologiesInput,
  UpdatePortfolioTechnologyInput,
} from "../schemas/portfolio-technology.schema";

export class PortfolioTechnologyService {
  private readonly repository = new PortfolioTechnologyRepository();

  private readonly portfolioRepository = new PortfolioRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    return this.getOrderedTechnologies({ portfolio });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async add({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: AddPortfolioTechnologyInput;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await this.assertEligibleTechnology({ technologyId: dto.technologyId });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioTechnologyRepository(tx);

      const displayOrder = await repository.nextDisplayOrder({
        portfolioId: portfolio.id,
      });

      await repository.create({
        portfolioId: portfolio.id,
        technologyId: dto.technologyId,
        startedUsingAt: dto.startedUsingAt ?? null,
        description: dto.description ?? null,
        displayOrder,
      });
    });

    return this.getOrderedTechnologies({ portfolio });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  async updateMetadata({
    actor,
    technologyId,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    technologyId: string;
    dto: UpdatePortfolioTechnologyInput;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const updated = await this.repository.updateMetadata({
      portfolioId: portfolio.id,
      technologyId,
      data: {
        ...(dto.startedUsingAt !== undefined && {
          startedUsingAt: dto.startedUsingAt,
        }),

        ...(dto.description !== undefined && {
          description: dto.description,
        }),
      },
    });

    // Scoped by both key halves, so zero rows means the relationship is not
    // in *this* portfolio — whether it never existed or belongs to another.
    if (updated === 0) {
      throw new PortfolioTechnologyNotFoundError();
    }

    return this.getOrderedTechnologies({ portfolio });
  }

  /**
   * Rewrites presentation order from a full list of technology ids. The
   * request must name every manageable relationship exactly once — a
   * partial list would leave the remainder at stale positions.
   */
  async reorder({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: ReorderPortfolioTechnologiesInput;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioTechnologyRepository(tx);

      const owned = await repository.findManageableTechnologyIds({
        portfolioId: portfolio.id,
      });

      // Rejects duplicates, unknown ids, missing ids, and ids belonging to
      // another portfolio in one check — the owned set is already scoped to
      // this portfolio.
      if (!isExactCover(owned, dto.technologyIds)) {
        throw new PortfolioTechnologyReorderMismatchError();
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, technologyId] of dto.technologyIds.entries()) {
        await repository.updateDisplayOrder({
          portfolioId: portfolio.id,
          technologyId,
          displayOrder: index,
        });
      }
    });

    return this.getOrderedTechnologies({ portfolio });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  /**
   * Detaches the technology from the portfolio. The Technology catalog entry
   * itself is untouched.
   *
   * Unconditional: stale references to a Technology that has since been
   * soft-deleted from the catalog must always be removable, even though it
   * could never be re-attached.
   */
  async remove({
    actor,
    technologyId,
  }: {
    actor: StrictAuthorizationActor;
    technologyId: string;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const deleted = await this.repository.delete({
      portfolioId: portfolio.id,
      technologyId,
    });

    if (deleted === 0) {
      throw new PortfolioTechnologyNotFoundError();
    }

    return this.getOrderedTechnologies({ portfolio });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Resolves the acting user's own portfolio and asserts they may manage its
   * technologies.
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

    PortfolioAuthorizer.manageTechnologies(context);

    return portfolio;
  }

  /**
   * A Technology is eligible to attach only while it exists and is not
   * soft-deleted. Re-validated independently here on every add — the
   * catalog picker is a convenience, never an authorization boundary, so a
   * client cannot smuggle in a deleted or nonexistent Technology by
   * bypassing it.
   */
  private async assertEligibleTechnology({
    technologyId,
  }: {
    technologyId: string;
  }): Promise<void> {
    const technology = await TechnologyRepository.findActiveById(
      technologyId,
    );

    if (!technology) {
      throw new TechnologyNotFoundError();
    }
  }

  private async getOrderedTechnologies({
    portfolio,
  }: {
    portfolio: PortfolioAuthorizationEntity;
  }): Promise<PortfolioTechnologySummaryDto[]> {
    const entries = await this.repository.findManyByPortfolio({
      portfolioId: portfolio.id,
    });

    return PortfolioMapper.toTechnologySummaryDtos(entries);
  }
}

export const portfolioTechnologyService = new PortfolioTechnologyService();
