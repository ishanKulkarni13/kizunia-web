/**
 * Project Technologies - Service
 *
 * Owns authorization, project ownership scoping, ordering correctness, and
 * repository orchestration for a project's Technologies (the stack actually
 * used in the project's implementation — not to be confused with
 * Competition or Portfolio's own Technology relationships). Mutations
 * return the project's full, server-ordered technology list so the editor
 * always reflects server-assigned ordering rather than guessing at it
 * locally — mirroring Project Links/Testimonials.
 */

import { HttpStatus, ValidationError } from "@/lib/errors";
import { isExactCover } from "@/modules/links";
import prisma from "@/lib/prisma";
import { TechnologyRepository } from "@/modules/technologies/backend/repository";

import type { AuthorizationActor, StrictAuthorizationActor } from "@/authorization";
import { ProjectAction, ProjectAuthorizer, ProjectContextResolver } from "./authorization";
import { ProjectErrorCode } from "./errors/error-code";
import { ProjectTechnologyNotFoundError } from "./errors";
import { ProjectMapper } from "./mapper/project.mapper";
import { ProjectTechnologyRepository } from "./project-technology.repository";
import type { ProjectTechnologyDto } from "./dto/output";
import type { ReorderProjectTechnologiesInput } from "../schemas/project-technology.schema";

export class ProjectTechnologyService {
  private readonly repository = new ProjectTechnologyRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<ProjectTechnologyDto[]> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.read(context);

    return this.getOrderedTechnologies({ projectId });
  }

  // ===========================================================================
  // Attach
  // ===========================================================================

  async attach({
    projectId,
    actor,
    technologyId,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    technologyId: string;
  }): Promise<ProjectTechnologyDto[]> {
    await this.authorizeManage({ projectId, actor });

    // The catalog picker only ever offers active technologies, but a stale
    // client could still submit a deleted (or nonexistent) id — re-validate
    // independently here rather than trusting the request.
    const technology = await TechnologyRepository.findActiveById(technologyId);

    if (!technology) {
      throw new ProjectTechnologyNotFoundError();
    }

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectTechnologyRepository(tx);

      const displayOrder = await repository.nextDisplayOrder({ projectId });

      await repository.create({
        projectId,
        technologyId,
        displayOrder,
      });
    });

    return this.getOrderedTechnologies({ projectId });
  }

  // ===========================================================================
  // Detach
  // ===========================================================================

  /**
   * Detaches a technology from the project. Unconditional with respect to
   * the Technology's own state — cleanup of a stale reference to a
   * since-deleted Technology must always be possible, so this never
   * re-checks `deletedAt`. Only the relationship row's existence matters.
   */
  async detach({
    projectId,
    actor,
    technologyId,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    technologyId: string;
  }): Promise<ProjectTechnologyDto[]> {
    await this.authorizeManage({ projectId, actor });

    const deleted = await this.repository.delete({ projectId, technologyId });

    if (deleted === 0) {
      throw new ProjectTechnologyNotFoundError();
    }

    return this.getOrderedTechnologies({ projectId });
  }

  // ===========================================================================
  // Reorder
  // ===========================================================================

  /**
   * Rewrites presentation order from a full list of technology ids. The
   * request must name every attached technology exactly once — a partial
   * list would leave the remainder at stale positions.
   */
  async reorder({
    projectId,
    actor,
    dto,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    dto: ReorderProjectTechnologiesInput;
  }): Promise<ProjectTechnologyDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectTechnologyRepository(tx);

      const owned = await repository.findIdsByProject({ projectId });

      if (!isExactCover(owned, dto.ids)) {
        throw new ValidationError({
          code: ProjectErrorCode.TECHNOLOGY_REORDER_MISMATCH,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message:
            "Reorder must list every technology of this project exactly once.",
        });
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, id] of dto.ids.entries()) {
        await repository.updateDisplayOrder({
          projectId,
          technologyId: id,
          displayOrder: index,
        });
      }
    });

    return this.getOrderedTechnologies({ projectId });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async getOrderedTechnologies({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectTechnologyDto[]> {
    const technologies = await this.repository.findManyByProject({
      projectId,
    });

    return technologies.map((entry) => ProjectMapper.toTechnologyDto(entry));
  }

  private async authorizeManage({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<void> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.can(context, ProjectAction.MANAGE_TECHNOLOGIES);
  }
}

export const projectTechnologyService = new ProjectTechnologyService();
