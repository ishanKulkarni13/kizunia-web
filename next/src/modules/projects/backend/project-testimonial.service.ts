/**
 * Project Testimonials - Service
 *
 * Owns authorization, ordering correctness, image attach/replace/detach
 * orchestration, and repository orchestration for a project's Testimonials.
 * Mutations return the project's full, server-ordered testimonial list so
 * the editor always reflects server-assigned ordering — mirroring Project
 * Links.
 *
 * Image management is part of testimonial management: there is no separate
 * "manage testimonial image" action. A caller authorized to add/update/
 * remove a testimonial is authorized to attach/replace/remove its image.
 */

import { AssetPurpose } from "@/generated/prisma";
import { HttpStatus, ValidationError } from "@/lib/errors";
import { isExactCover } from "@/modules/links";
import prisma from "@/lib/prisma";
import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import type { AuthorizationActor, StrictAuthorizationActor } from "@/authorization";
import { ProjectAction, ProjectAuthorizer, ProjectContextResolver } from "./authorization";
import { ProjectErrorCode } from "./errors/error-code";
import { ProjectMapper } from "./mapper/project.mapper";
import { ProjectTestimonialRepository } from "./project-testimonial.repository";
import type { ProjectTestimonialDto } from "./dto/output";
import type {
  CreateProjectTestimonialInput,
  ReorderProjectTestimonialsInput,
  UpdateProjectTestimonialInput,
} from "../schemas/project-testimonial.schema";

export class ProjectTestimonialService {
  private readonly repository = new ProjectTestimonialRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async list({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<ProjectTestimonialDto[]> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.read(context);

    return this.getOrderedTestimonials({ projectId });
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
    dto: CreateProjectTestimonialInput;
  }): Promise<ProjectTestimonialDto[]> {
    await this.authorizeManage({ projectId, actor });

    const imageAssetId = dto.imageAssetId ?? null;

    if (imageAssetId !== null) {
      await assertAssetReferenceAllowed({
        assetId: imageAssetId,
        purpose: AssetPurpose.PROJECT_TESTIMONIAL_IMAGE,
      });
    }

    await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      await assetService.prepareAssetAttach(tx, {
        assetId: imageAssetId,
        previousAssetId: null,
        purpose: AssetPurpose.PROJECT_TESTIMONIAL_IMAGE,
      });

      const repository = new ProjectTestimonialRepository(tx);

      const displayOrder = await repository.nextDisplayOrder({ projectId });

      await repository.create({
        projectId,
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

    return this.getOrderedTestimonials({ projectId });
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  async update({
    projectId,
    testimonialId,
    actor,
    dto,
  }: {
    projectId: string;
    testimonialId: string;
    actor: StrictAuthorizationActor;
    dto: UpdateProjectTestimonialInput;
  }): Promise<ProjectTestimonialDto[]> {
    await this.authorizeManage({ projectId, actor });

    const existing = await this.repository.findByIdForProjectOrThrow({
      projectId,
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
        purpose: AssetPurpose.PROJECT_TESTIMONIAL_IMAGE,
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
          purpose: AssetPurpose.PROJECT_TESTIMONIAL_IMAGE,
        });
      }

      const repository = new ProjectTestimonialRepository(tx);

      await repository.findByIdForProjectOrThrow({ projectId, testimonialId });

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

    return this.getOrderedTestimonials({ projectId });
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  async remove({
    projectId,
    testimonialId,
    actor,
  }: {
    projectId: string;
    testimonialId: string;
    actor: StrictAuthorizationActor;
  }): Promise<ProjectTestimonialDto[]> {
    await this.authorizeManage({ projectId, actor });

    const existing = await this.repository.findByIdForProjectOrThrow({
      projectId,
      testimonialId,
    });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectTestimonialRepository(tx);

      await repository.findByIdForProjectOrThrow({ projectId, testimonialId });

      await repository.delete({ testimonialId });

      if (existing.imageAssetId) {
        await assetService.detachIfUnreferenced(tx, existing.imageAssetId);
      }
    });

    return this.getOrderedTestimonials({ projectId });
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
    projectId,
    actor,
    dto,
  }: {
    projectId: string;
    actor: StrictAuthorizationActor;
    dto: ReorderProjectTestimonialsInput;
  }): Promise<ProjectTestimonialDto[]> {
    await this.authorizeManage({ projectId, actor });

    await prisma.$transaction(async (tx) => {
      const repository = new ProjectTestimonialRepository(tx);

      const owned = await repository.findIdsByProject({ projectId });

      if (!isExactCover(owned, dto.ids)) {
        throw new ValidationError({
          code: ProjectErrorCode.TESTIMONIAL_REORDER_MISMATCH,
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          message:
            "Reorder must list every testimonial of this project exactly once.",
        });
      }

      // Sequential rather than Promise.all: an interactive transaction runs
      // on a single connection, so parallel queries against `tx` contend
      // for it.
      for (const [index, id] of dto.ids.entries()) {
        await repository.update({
          testimonialId: id,
          data: {
            displayOrder: index,
          },
        });
      }
    });

    return this.getOrderedTestimonials({ projectId });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async getOrderedTestimonials({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectTestimonialDto[]> {
    const testimonials = await this.repository.findManyByProject({
      projectId,
    });

    return testimonials.map((testimonial) =>
      ProjectMapper.toTestimonialDto(testimonial),
    );
  }

  private async authorizeManage({
    projectId,
    actor,
  }: {
    projectId: string;
    actor: AuthorizationActor;
  }): Promise<void> {
    const context = await ProjectContextResolver.resolve({ actor, projectId });

    ProjectAuthorizer.can(context, ProjectAction.MANAGE_TESTIMONIALS);
  }
}

export const projectTestimonialService = new ProjectTestimonialService();
