/**
 * Project Links - Service
 *
 * Owns authorization, project ownership scoping, ordering correctness, and
 * repository orchestration for a project's Links. Mutations return the
 * project's full, server-ordered link list so the editor always reflects
 * server-assigned ordering rather than guessing at it locally — mirroring
 * Competition Locations.
 */

import { HttpStatus, ValidationError } from "@/lib/errors";
import { isExactCover } from "@/modules/links";
import prisma from "@/lib/prisma";

import type { AuthorizationActor, StrictAuthorizationActor } from "@/authorization";
import { ProjectAction, ProjectAuthorizer, ProjectContextResolver } from "./authorization";
import { ProjectErrorCode } from "./errors/error-code";
import { ProjectMapper } from "./mapper/project.mapper";
import { ProjectLinkRepository } from "./project-link.repository";
import type { ProjectLinkDto } from "./dto/output";
import type {
  CreateProjectLinkInput,
  ReorderProjectLinksInput,
  UpdateProjectLinkInput,
} from "../schemas/project-link.schema";

export class ProjectLinkService {
  private readonly repository = new ProjectLinkRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<ProjectLinkDto[]> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.read(context);

    return this.getOrderedLinks({ projectId });
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async add({
    projectId,
    actor,
    dto,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    dto: CreateProjectLinkInput;
  }): Promise<ProjectLinkDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectLinkRepository(tx);

      const order = await repository.nextOrder({ projectId });

      await repository.create({
        projectId,
        data: {
          title: dto.title,
          url: dto.url,
          type: dto.type,
          order,
        },
      });
    });

    return this.getOrderedLinks({ projectId });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  async update({
    projectId,
    linkId,
    actor,
    dto,
  }: {
    projectId: string;
    linkId: string;
    actor: StrictAuthorizationActor;
    dto: UpdateProjectLinkInput;
  }): Promise<ProjectLinkDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectLinkRepository(tx);

      await repository.findByIdForProjectOrThrow({ projectId, linkId });

      await repository.update({
        linkId,
        data: {
          ...(dto.title !== undefined && { title: dto.title }),

          ...(dto.url !== undefined && { url: dto.url }),

          ...(dto.type !== undefined && { type: dto.type }),
        },
      });
    });

    return this.getOrderedLinks({ projectId });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  async remove({
    projectId,
    linkId,
    actor,
  }: {
    projectId: string;
    linkId: string;
    actor: StrictAuthorizationActor;
  }): Promise<ProjectLinkDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectLinkRepository(tx);

      await repository.findByIdForProjectOrThrow({ projectId, linkId });

      await repository.delete({ linkId });
    });

    return this.getOrderedLinks({ projectId });
  }

  // ===========================================================================
  // Reorder
  // ===========================================================================

  /**
   * Rewrites presentation order from a full list of ids. The request must
   * name every link exactly once — a partial list would leave the remainder
   * at stale positions.
   */
  async reorder({
    projectId,
    actor,
    dto,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    dto: ReorderProjectLinksInput;
  }): Promise<ProjectLinkDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectLinkRepository(tx);

      const owned = await repository.findIdsByProject({ projectId });

      if (!isExactCover(owned, dto.ids)) {
        throw new ValidationError({
          code: ProjectErrorCode.LINK_REORDER_MISMATCH,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message: "Reorder must list every link of this project exactly once.",
        });
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, id] of dto.ids.entries()) {
        await repository.update({
          linkId: id,
          data: {
            order: index,
          },
        });
      }
    });

    return this.getOrderedLinks({ projectId });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async getOrderedLinks({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectLinkDto[]> {
    const links = await this.repository.findManyByProject({ projectId });

    return links.map((link) => ProjectMapper.toLinkDto(link));
  }

  private async authorizeManage({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<void> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.can(context, ProjectAction.MANAGE_LINKS);
  }
}

export const projectLinkService = new ProjectLinkService();
