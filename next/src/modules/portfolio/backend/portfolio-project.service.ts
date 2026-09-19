/**
 * Portfolio Projects - Service
 *
 * Owns the business rules for the Portfolio ↔ Project relationship:
 * authorization, membership eligibility, ordering, and transactions.
 *
 * This is relationship management, not project management. Nothing here ever
 * writes to a Project or a ProjectMember — the portfolio owns whether a
 * project is *shown* and whether that showing is *featured*, and nothing else.
 *
 * Authorization is two independent checks, both derived from trusted
 * server-side state:
 *
 *   A. Portfolio ownership — the portfolio is resolved from the session, so
 *      there is no id for a client to tamper with.
 *   B. Project membership — the actor must hold a ProjectMember row. Any role
 *      qualifies. Deliberately NOT a ProjectAction: CONTRIBUTOR holds only
 *      ProjectAction.VIEW, yet must be able to showcase a project they work
 *      on. See `PortfolioAction.MANAGE_PROJECTS`.
 *
 * Mutations return the portfolio's full, server-ordered project list so the
 * editor always reflects server-assigned ordering rather than guessing at it
 * locally — mirroring Project Links.
 */

import type { StrictAuthorizationActor } from "@/authorization";
import type { Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { isExactCover } from "@/modules/links";

import { PortfolioAuthorizer, PortfolioContextResolver } from "./authorization";
import { PortfolioMapper } from "./mapper/mapper";
import { PortfolioProjectRepository } from "./portfolio-project.repository";
import { PortfolioRepository } from "./repository";
import type { PortfolioAuthorizationEntity } from "./repository";
import type { PortfolioProjectSummaryDto } from "../dtos";
import {
  PortfolioProjectMembershipRequiredError,
  PortfolioProjectNotFoundError,
  PortfolioProjectReorderMismatchError,
} from "../errors";
import type {
  AddPortfolioProjectInput,
  ReorderPortfolioProjectsInput,
  UpdatePortfolioProjectInput,
} from "../schemas/portfolio-project.schema";

export class PortfolioProjectService {
  private readonly repository = new PortfolioProjectRepository();

  private readonly portfolioRepository = new PortfolioRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    return this.getOrderedProjects({ portfolio });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async add({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: AddPortfolioProjectInput;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await this.assertMembership({ projectId: dto.projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioProjectRepository(tx);

      const displayOrder = await repository.nextDisplayOrder({
        portfolioId: portfolio.id,
      });

      await repository.create({
        portfolioId: portfolio.id,
        projectId: dto.projectId,
        displayOrder,
      });
    });

    return this.getOrderedProjects({ portfolio });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  /**
   * Featuring is a claim about a project the actor participates in, so it
   * requires live membership — unlike removal.
   */
  async setFeatured({
    actor,
    projectId,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    projectId: string;
    dto: UpdatePortfolioProjectInput;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await this.assertMembership({ projectId, actor });

    const updated = await this.repository.updateFeatured({
      portfolioId: portfolio.id,
      projectId,
      featured: dto.featured,
    });

    // Scoped by both key halves, so zero rows means the relationship is not
    // in *this* portfolio — whether it never existed or belongs to another.
    if (updated === 0) {
      throw new PortfolioProjectNotFoundError();
    }

    return this.getOrderedProjects({ portfolio });
  }

  /**
   * Rewrites presentation order from a full list of project ids. The request
   * must name every manageable relationship exactly once — a partial list
   * would leave the remainder at stale positions.
   */
  async reorder({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: ReorderPortfolioProjectsInput;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    await prisma.$transaction(async (tx) => {
      const repository = new PortfolioProjectRepository(tx);

      const owned = await repository.findManageableProjectIds({
        portfolioId: portfolio.id,
        ownerUserId: portfolio.userId,
      });

      // Rejects duplicates, unknown ids, missing ids, and ids belonging to
      // another portfolio in one check — the owned set is already scoped to
      // this portfolio and to live memberships.
      if (!isExactCover(owned, dto.projectIds)) {
        throw new PortfolioProjectReorderMismatchError();
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, projectId] of dto.projectIds.entries()) {
        await repository.updateDisplayOrder({
          portfolioId: portfolio.id,
          projectId,
          displayOrder: index,
        });
      }
    });

    return this.getOrderedProjects({ portfolio });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  /**
   * Detaches the project from the portfolio. The Project itself, its
   * membership and all of its content are untouched.
   *
   * Deliberately does NOT require current membership: a user removed from a
   * project must still be able to clear the stale relationship from their own
   * portfolio.
   */
  async remove({
    actor,
    projectId,
  }: {
    actor: StrictAuthorizationActor;
    projectId: string;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const portfolio = await this.authorizeManage({ actor });

    const deleted = await this.repository.delete({
      portfolioId: portfolio.id,
      projectId,
    });

    if (deleted === 0) {
      throw new PortfolioProjectNotFoundError();
    }

    return this.getOrderedProjects({ portfolio });
  }

  /**
   * Cleanup seam for a future ProjectMember removal workflow.
   *
   * Takes a transaction client so membership removal and relationship cleanup
   * commit together. There is no ProjectMember removal workflow in this
   * repository yet, so nothing calls this — the invariant is currently
   * upheld at query time instead (see the repository header), which is why
   * correctness does not depend on this being wired up. When member
   * management is built, call this inside its transaction to stop stale rows
   * accumulating.
   */
  async removeForMembershipEnd({
    tx,
    projectId,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    projectId: string;
    userId: string;
  }): Promise<number> {
    const repository = new PortfolioProjectRepository(tx);

    return repository.deleteByProjectAndOwner({ projectId, userId });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Check A — resolves the acting user's own portfolio and asserts they may
   * manage its projects.
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

    PortfolioAuthorizer.manageProjects(context);

    return portfolio;
  }

  /**
   * Check B — the actor must hold a membership row for a live project.
   *
   * Never trusts a role, membership or eligibility flag sent by the client;
   * the picker UI is a convenience, not an authorization boundary.
   */
  private async assertMembership({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
  }): Promise<void> {
    const project = await this.repository.findEligibleProject({
      projectId,
      userId: actor.id,
    });

    if (!project) {
      throw new PortfolioProjectMembershipRequiredError();
    }
  }

  private async getOrderedProjects({
    portfolio,
  }: {
    portfolio: PortfolioAuthorizationEntity;
  }): Promise<PortfolioProjectSummaryDto[]> {
    const entries = await this.repository.findManyByPortfolio({
      portfolioId: portfolio.id,
      ownerUserId: portfolio.userId,
    });

    return PortfolioMapper.toProjectSummaryDtos(entries);
  }
}

export const portfolioProjectService = new PortfolioProjectService();
