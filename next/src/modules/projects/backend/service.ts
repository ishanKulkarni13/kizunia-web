/**
 * Projects Module - Service
 *
 * Responsible for all business rules:
 * - Duplicate detection
 * - Transactions
 * - Workflows
 * - Permission checks
 * - Business validation
 */

import {
  AuthorizationActor,
  AuthorizationCode,
  StrictAuthorizationActor,
} from "@/authorization";
import { AuthorizationError } from "@/lib/errors";
import {
  ProjectAuthorizer,
  ProjectContextResolver,
  ProjectPermissionResolver,
} from "./authorization";
import {
  ProjectNotFoundError,
} from "./errors/index";
import { ProjectMapper } from "./mapper/project.mapper";
import { ProjectRepository, ProjectDetailsEntity } from "./repository";
import { ProjectDetailsDto, ProjectPublicDetailsDto, ProjectSummaryDto, ProjectMineSummaryDto } from "./dto/output";
import { ProjectMineQueryDto } from "../search";
import { projectSearchDefinition } from "../search/definition";
import { buildPaginationMeta, buildSearchQuery, parsePagination } from "@/lib/search";
import type { RawSearchParams, SearchResult } from "@/lib/search/types";
import prisma from "@/lib/prisma";
import {
  CreateProjectDto,
  UpdateProjectContentDto,
  UpdateProjectProfileDto,
} from "./dto/input";
import { AssetPurpose, ProjectRole, ProjectStatus, ProjectVisibility } from "@/generated/prisma";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import { ProjectDuplicateSlugError } from "@/modules/projects/backend/errors/index";
import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";
import type { ProjectAssetSlot } from "../types/asset-slot";

const SLOT_PURPOSE: Record<ProjectAssetSlot, AssetPurpose> = {
  logo: AssetPurpose.PROJECT_LOGO,
  cover: AssetPurpose.PROJECT_COVER,
};

export class ProjectService {
  private readonly repository = new ProjectRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async findBySlug({
    slug,
    actor,
  }: {
    slug: string;
    actor: AuthorizationActor;
  }): Promise<ProjectDetailsDto> {
    const project = await this.repository.findBySlug({
      slug,
    });

    if (!project) {
      throw new ProjectNotFoundError();
    }

    const membership = actor.id
      ? await this.repository.findMembership({
          projectId: project.id,
          userId: actor.id,
        })
      : null;

    const context = ProjectContextResolver.fromData({
      actor,

      project,

      membership,
    });

    ProjectAuthorizer.read(context);

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(project, permissions);
  }

  /**
   * Loads a project for the public `/projects/[slug]` view page.
   *
   * Enforces `ProjectPolicy.canView` exactly like `findBySlug`, then maps
   * to the narrower `ProjectPublicDetailsDto` instead of the full
   * editor-grade `ProjectDetailsDto`. Kept as a separate method (rather
   * than a mode flag on `findBySlug`) so the authenticated editor/API
   * contract behind `findBySlug` is never at risk of an accidental shape
   * change.
   */
  async findPublicBySlug({
    slug,
    actor,
  }: {
    slug: string;
    actor: AuthorizationActor;
  }): Promise<ProjectPublicDetailsDto> {
    const project = await this.repository.findBySlug({
      slug,
    });

    if (!project) {
      throw new ProjectNotFoundError();
    }

    const membership = actor.id
      ? await this.repository.findMembership({
          projectId: project.id,
          userId: actor.id,
        })
      : null;

    const context = ProjectContextResolver.fromData({
      actor,

      project,

      membership,
    });

    ProjectAuthorizer.read(context);

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toPublicDetailsDto(
      project,
      permissions,
      context.membership !== null,
    );
  }

  /**
   * Loads a project for the editor. Requires VIEW access (any project
   * member), not EDIT — the returned `permissions` field tells the caller
   * what the actor is actually allowed to change.
   */
  async findById({
    id,
    actor,
  }: {
    id: string;
    actor: StrictAuthorizationActor;
  }): Promise<ProjectDetailsDto> {
    const project = await this.repository.findById({
      id,
    });

    if (!project) {
      throw new ProjectNotFoundError();
    }

    const membership = await this.repository.findMembership({
      projectId: project.id,
      userId: actor.id,
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership,
    });

    ProjectAuthorizer.read(context);

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(project, permissions);
  }

  /**
   * The public `/projects` discovery listing.
   *
   * `params` are raw, unvalidated URL search params — the same shape every
   * other search-core-backed module's public listing takes (see
   * `CompetitionService.search`). Validation, filter decoding and the
   * `visibility`/`status` scope guard all happen inside
   * `buildSearchQuery(... scope: "public")`, not here: this method never
   * builds a `where` clause of its own, so there is no second place that
   * rule could be weakened or forgotten.
   *
   * Builds exactly one query object and hands it to both `findMany` and
   * `count`, so the reported total can never disagree with the rows —
   * see the note on `CompetitionSearchPlan` for why that matters once a
   * search has more than one query behind it.
   */
  async search(
    params: RawSearchParams,
    actor: AuthorizationActor,
  ): Promise<SearchResult<ProjectSummaryDto>> {
    PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_PUBLIC_PROJECTS);

    const query = buildSearchQuery({
      definition: projectSearchDefinition,
      params,
      scope: "public",
      context: {},
    });

    const [projects, total] = await Promise.all([
      this.repository.findMany(query),
      this.repository.countMany(query),
    ]);

    const items = ProjectMapper.toSummaryDtos(projects);

    // Re-derives page and limit from the same raw parameters the query was
    // built from, through the engine's own clamping, so the reported
    // values always match what was actually queried.
    return {
      items,
      pagination: buildPaginationMeta(parsePagination(params), total),
    };
  }

  /**
   * Projects the actor is a `ProjectMember` of — every visibility, since
   * membership (not visibility) is the scope. No `PlatformAuthorizer` gate:
   * listing your own memberships requires only being authenticated, not a
   * platform-level permission.
   */
  async findMine({
    actor,
    query,
  }: {
    actor: StrictAuthorizationActor;
    query: ProjectMineQueryDto;
  }): Promise<SearchResult<ProjectMineSummaryDto>> {
    const [projects, total] = await Promise.all([
      this.repository.findManyForMember({
        userId: actor.id,
        query,
      }),

      this.repository.countForMember({
        userId: actor.id,
        query,
      }),
    ]);

    const items = ProjectMapper.toMineSummaryDtos(projects, actor);

    return {
      items,

      pagination: buildPaginationMeta(
        {
          page: query.page,
          limit: query.pageSize,
        },
        total,
      ),
    };
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async create({
    actor,
    dto,
  }: {
    actor: AuthorizationActor;
    dto: CreateProjectDto;
  }): Promise<ProjectDetailsDto> {
    await this.ensureSlugAvailable({
      slug: dto.slug,
    });

    if (!actor.id) {
      throw new AuthorizationError({
        code: AuthorizationCode.UNAUTHORIZED,
        message: "Authentication is required.",
        status: 401,
      });
    }

    const actorId = actor.id;

    PlatformAuthorizer.can({ actor }, PlatformAction.CREATE_PROJECT);

    const project = await prisma.$transaction(async (tx) => {
      const repository = new ProjectRepository(tx);

      const project = await repository.create({
        data: {
          ...ProjectMapper.toCreateInput(dto),

          status: ProjectStatus.DRAFT,

          visibility: ProjectVisibility.PRIVATE,

          createdBy: {
            connect: {
              id: actorId,
            },
          },

          updatedBy: {
            connect: {
              id: actorId,
            },
          },
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: actorId,
          role: ProjectRole.OWNER,
        },
      });

      return project;
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership: {
        role: ProjectRole.OWNER,
      },
    });

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(project, permissions);
  }

  // ===========================================================================
  // Update
  // ===========================================================================

  /**
   * @deprecated Use `updateProfile()` for title/slug/shortDescription/status/
   * visibility, or `updateContent()` for the project's Markdown content.
   */
  async update() {
    throw new Error("Not implemented.");
  }

  async updateProfile({
    id,
    actor,
    dto,
  }: {
    id: string;
    actor: StrictAuthorizationActor;
    dto: UpdateProjectProfileDto;
  }): Promise<ProjectDetailsDto> {
    const project = await this.getProjectOrThrow({
      id,
    });

    const membership = await this.repository.findMembership({
      projectId: project.id,
      userId: actor.id,
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership,
    });

    ProjectAuthorizer.edit(context);

    if (dto.slug !== undefined) {
      await this.ensureSlugAvailableForUpdate({
        slug: dto.slug,
        projectId: project.id,
      });
    }

    const updatedProject = await prisma.$transaction(async (tx) => {
      const repository = new ProjectRepository(tx);

      return repository.updateProfile({
        id: project.id,
        data: {
          ...dto,

          updatedBy: {
            connect: {
              id: actor.id,
            },
          },
        },
      });
    });

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(updatedProject, permissions);
  }

  async setAsset({
    id,
    actor,
    slot,
    assetId,
  }: {
    id: string;
    actor: StrictAuthorizationActor;
    slot: ProjectAssetSlot;
    assetId: string | null;
  }): Promise<ProjectDetailsDto> {
    const project = await this.getProjectOrThrow({ id });

    const membership = await this.repository.findMembership({
      projectId: project.id,
      userId: actor.id,
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership,
    });

    ProjectAuthorizer.edit(context);

    // Target-domain authorization (above) only establishes that this actor
    // may edit this project. It does not establish that the specific Asset
    // being attached is actually usable as a project logo/cover — a shared
    // Asset is not automatically valid just because the actor can edit this
    // project. See docs/architecture/domain/assets/overview.md.
    // A null assetId clears the slot and has nothing to validate.
    if (assetId !== null) {
      await assertAssetReferenceAllowed({
        assetId,
        purpose: SLOT_PURPOSE[slot],
      });
    }

    const previousAssetId =
      slot === "logo" ? project.logoAssetId : project.coverAssetId;

    const updatedProject = await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      await assetService.prepareAssetAttach(tx, {
        assetId,
        previousAssetId,
        purpose: SLOT_PURPOSE[slot],
      });

      const repository = new ProjectRepository(tx);

      const updated = await repository.setAsset({ id, slot, assetId });

      if (previousAssetId && previousAssetId !== assetId) {
        await assetService.detachIfUnreferenced(tx, previousAssetId);
      }

      return updated;
    });

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(updatedProject, permissions);
  }

  async updateContent({
    id,
    actor,
    dto,
  }: {
    id: string;
    actor: StrictAuthorizationActor;
    dto: UpdateProjectContentDto;
  }): Promise<ProjectDetailsDto> {
    const project = await this.getProjectOrThrow({
      id,
    });

    const membership = await this.repository.findMembership({
      projectId: project.id,
      userId: actor.id,
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership,
    });

    ProjectAuthorizer.manageContent(context);

    const updatedProject = await prisma.$transaction(async (tx) => {
      const repository = new ProjectRepository(tx);

      const projectContent = await repository.findContent({
        projectId: project.id,
      });

      if (!projectContent) {
        throw new ProjectNotFoundError();
      }

      if (projectContent.contentId) {
        await repository.updateContent({
          contentId: projectContent.contentId,
          data: {
            content: dto.content,
            version: {
              increment: 1,
            },
          },
        });
      } else {
        await repository.createContent({
          projectId: project.id,
          data: {
            content: dto.content,
          },
        });
      }

      const updatedProject = await repository.findById({
        id: project.id,
      });

      if (!updatedProject) {
        throw new ProjectNotFoundError();
      }

      return updatedProject;
    });

    const permissions = ProjectPermissionResolver.resolve(context);

    return ProjectMapper.toDetailsDto(updatedProject, permissions);
  }

  // ===========================================================================
  // Delete
  // ===========================================================================

  async delete({
    id,
    actor,
  }: {
    id: string;
    actor: StrictAuthorizationActor;
  }): Promise<void> {
    const project = await this.getProjectOrThrow({
      id,
    });

    const membership = await this.repository.findMembership({
      projectId: project.id,
      userId: actor.id,
    });

    const context = ProjectContextResolver.fromData({
      actor,
      project,
      membership,
    });

    ProjectAuthorizer.delete(context);

    await this.repository.softDelete({
      id,
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async getProjectOrThrow({
    id,
  }: {
    id: string;
  }): Promise<ProjectDetailsEntity> {
    const project = await this.repository.findById({
      id,
    });

    if (!project) {
      throw new ProjectNotFoundError();
    }

    return project;
  }

  private async ensureSlugAvailable({ slug }: { slug: string }): Promise<void> {
    const exists = await this.repository.existsBySlug({
      slug,
    });

    if (exists) {
      throw new ProjectDuplicateSlugError(slug);
    }
  }

  private async ensureSlugAvailableForUpdate({
    slug,
    projectId,
  }: {
    slug: string;
    projectId: string;
  }): Promise<void> {
    const exists = await this.repository.existsBySlugExceptProject({
      slug,
      projectId,
    });

    if (exists) {
      throw new ProjectDuplicateSlugError(slug);
    }
  }
}

export const projectService = new ProjectService();
