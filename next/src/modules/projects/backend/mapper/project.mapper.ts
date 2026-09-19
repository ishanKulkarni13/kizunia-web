import { Link, Prisma, Testimonial } from "@/generated/prisma";

import type { StrictAuthorizationActor } from "@/authorization";

import type {
  ProjectDetailsEntity,
  ProjectSummaryEntity,
  ProjectMineSummaryEntity,
} from "../repository";
import type { ProjectTechnologyEntity } from "../project-technology.repository";
import { CreateProjectDto, UpdateProjectDto } from "../dto/input";
import {
  ProjectSummaryDto,
  ProjectMineSummaryDto,
  ProjectDetailsDto,
  ProjectPublicDetailsDto,
  ProjectLinkDto,
  ProjectTestimonialDto,
  ProjectTechnologyDto,
} from "../dto/output";
import type { ProjectPermissionsDTO } from "../authorization/dto";
import { ProjectContextResolver } from "../authorization/context-resolver";
import { ProjectPermissionResolver } from "../authorization/permission-resolver";

export class ProjectMapper {
  // ===========================================================================
  // Helpers
  // ===========================================================================

  private static toAssetDto(
    asset: {
      id: string;
      secureUrl: string;
      width: number | null;
      height: number | null;
      format: string | null;
      mimeType: string | null;
    } | null,
  ) {
    if (!asset) {
      return null;
    }

    return {
      id: asset.id,
      url: asset.secureUrl,
      width: asset.width,
      height: asset.height,
      format: asset.format,
      mimeType: asset.mimeType,
    };
  }

  static toTestimonialDto(
    testimonial: Testimonial & {
      imageAsset: {
        id: string;
        secureUrl: string;
        width: number | null;
        height: number | null;
        format: string | null;
        mimeType: string | null;
      } | null;
    },
  ): ProjectTestimonialDto {
    return {
      id: testimonial.id,

      name: testimonial.name,

      position: testimonial.position,

      company: testimonial.company,

      message: testimonial.message,

      rating: testimonial.rating,

      displayOrder: testimonial.displayOrder,

      image: this.toAssetDto(testimonial.imageAsset),
    };
  }

  static toTechnologyDto(
    entry: ProjectTechnologyEntity,
  ): ProjectTechnologyDto {
    return {
      id: entry.technology.id,

      name: entry.technology.name,

      slug: entry.technology.slug,

      type: entry.technology.type,

      iconAsset: this.toAssetDto(entry.technology.iconAsset),

      displayOrder: entry.displayOrder,
    };
  }

  static toLinkDto(link: Link): ProjectLinkDto {
    return {
      id: link.id,

      title: link.title,

      url: link.url,

      type: link.type,

      order: link.order,
    };
  }

  // ===========================================================================
  // Summary DTO
  // ===========================================================================

  static toSummaryDto(project: ProjectSummaryEntity): ProjectSummaryDto {
    return {
      id: project.id,

      title: project.title,

      slug: project.slug,

      shortDescription: project.shortDescription,

      status: project.status,

      startDate: project.startDate,

      endDate: project.endDate,

      updatedAt: project.updatedAt,

      logo: this.toAssetDto(project.logoAsset),

      categories: project.categories.map(({ category }) => ({
        slug: category.slug,
        name: category.name,
      })),

      technologies: project.technologies.map(({ technology }) => ({
        slug: technology.slug,
        name: technology.name,
      })),
    };
  }

  static toSummaryDtos(projects: ProjectSummaryEntity[]): ProjectSummaryDto[] {
    return projects.map((project) => this.toSummaryDto(project));
  }

  // ===========================================================================
  // My Projects Summary DTO
  // ===========================================================================

  /**
   * Maps one row of the membership-scoped listing, resolving `canEdit`
   * entirely from data the query already loaded — `project` here already
   * carries `deletedAt`/`createdById`/`members` alongside the summary
   * fields, satisfying `ProjectContextResolver.fromData` without a second
   * query. Never call `ProjectContextResolver.resolve()` (the DB-hitting
   * variant) per row here.
   */
  static toMineSummaryDto(
    project: ProjectMineSummaryEntity,
    actor: StrictAuthorizationActor,
  ): ProjectMineSummaryDto {
    const membership = project.members[0];

    if (!membership) {
      throw new Error(
        "Project membership was not loaded for a row returned by the membership-scoped query.",
      );
    }

    const context = ProjectContextResolver.fromData({
      actor,

      project,

      membership: {
        role: membership.role,
      },
    });

    const permissions = ProjectPermissionResolver.resolve(context);

    return {
      id: project.id,

      title: project.title,

      slug: project.slug,

      shortDescription: project.shortDescription,

      visibility: project.visibility,

      status: project.status,

      startDate: project.startDate,

      endDate: project.endDate,

      updatedAt: project.updatedAt,

      logo: this.toAssetDto(project.logoAsset),

      myRole: membership.role,

      canEdit: permissions.canEdit,
    };
  }

  static toMineSummaryDtos(
    projects: ProjectMineSummaryEntity[],
    actor: StrictAuthorizationActor,
  ): ProjectMineSummaryDto[] {
    return projects.map((project) => this.toMineSummaryDto(project, actor));
  }

  // ===========================================================================
  // Prisma
  // ===========================================================================

  static toCreateInput(dto: CreateProjectDto): Prisma.ProjectCreateInput {
    return {
      title: dto.title,

      slug: dto.slug,

      shortDescription: dto.shortDescription,
    };
  }

  static toUpdateInput(dto: UpdateProjectDto): Prisma.ProjectUpdateInput {
    return {
      ...(dto.title !== undefined && {
        title: dto.title,
      }),

      ...(dto.slug !== undefined && {
        slug: dto.slug,
      }),

      ...(dto.shortDescription !== undefined && {
        shortDescription: dto.shortDescription,
      }),

      ...(dto.visibility !== undefined && {
        visibility: dto.visibility,
      }),

      ...(dto.startDate !== undefined && {
        startDate: dto.startDate,
      }),

      ...(dto.endDate !== undefined && {
        endDate: dto.endDate,
      }),
    };
  }

  // ===========================================================================
  // Details DTO
  // ===========================================================================

  static toDetailsDto(
    project: ProjectDetailsEntity,
    permissions: ProjectPermissionsDTO,
  ): ProjectDetailsDto {
    return {
      id: project.id,

      title: project.title,

      slug: project.slug,

      shortDescription: project.shortDescription,

      content: project.content?.content ?? null,

      visibility: project.visibility,

      status: project.status,

      startDate: project.startDate,

      endDate: project.endDate,

      createdAt: project.createdAt,

      updatedAt: project.updatedAt,

      logo: this.toAssetDto(project.logoAsset),

      cover: this.toAssetDto(project.coverAsset),

      members: project.members.map((member) => ({
        role: member.role,

        joinedAt: member.joinedAt,

        user: {
          id: member.user.id,

          name: member.user.name,

          username: member.user.username,

          image: member.user.image,

          avatar: this.toAssetDto(member.user.avatarAsset),
        },
      })),

      categories: project.categories.map(({ category }) => ({
        id: category.id,

        name: category.name,

        slug: category.slug,
      })),

      technologies: project.technologies.map(({ technology }) => ({
        id: technology.id,

        name: technology.name,

        slug: technology.slug,
      })),

      badges: project.badges.map((projectBadge) => ({
        issuedAt: projectBadge.issuedAt,

        badge: {
          id: projectBadge.badge.id,

          name: projectBadge.badge.name,

          description: projectBadge.badge.description,

          icon: this.toAssetDto(projectBadge.badge.iconAsset),
        },
      })),

      links: project.links.map((link) => this.toLinkDto(link)),

      competitions: project.competitions.map((competitionProject) => ({
        submittedAt: competitionProject.submittedAt,

        competition: {
          id: competitionProject.competition.id,

          title: competitionProject.competition.title,

          slug: competitionProject.competition.slug,
        },
      })),

      testimonials: project.testimonials.map((testimonial) =>
        this.toTestimonialDto(testimonial),
      ),

      statistics: {
        memberCount: project.members.length,

        technologyCount: project.technologies.length,

        categoryCount: project.categories.length,

        badgeCount: project.badges.length,

        testimonialCount: project.testimonials.length,

        competitionCount: project.competitions.length,
      },

      permissions,
    };
  }

  // ===========================================================================
  // Public Details DTO
  // ===========================================================================

  /**
   * Maps a project to the shape returned by the public `/projects/[slug]`
   * view page. Callers must have already passed `ProjectAuthorizer.read`
   * for this project. `isMember` is derived from the same `membership`
   * lookup used for authorization, not from `permissions`.
   */
  static toPublicDetailsDto(
    project: ProjectDetailsEntity,
    permissions: ProjectPermissionsDTO,
    isMember: boolean,
  ): ProjectPublicDetailsDto {
    return {
      id: project.id,

      title: project.title,

      slug: project.slug,

      shortDescription: project.shortDescription,

      content: project.content?.content ?? null,

      visibility: project.visibility,

      status: project.status,

      startDate: project.startDate,

      endDate: project.endDate,

      logo: this.toAssetDto(project.logoAsset),

      cover: this.toAssetDto(project.coverAsset),

      members: project.members.map((member) => ({
        role: member.role,

        joinedAt: member.joinedAt,

        user: {
          id: member.user.id,

          name: member.user.name,

          username: member.user.username,

          image: member.user.image,

          avatar: this.toAssetDto(member.user.avatarAsset),
        },
      })),

      categories: project.categories.map(({ category }) => ({
        id: category.id,

        name: category.name,

        slug: category.slug,
      })),

      technologies: project.technologies.map(({ technology }) => ({
        id: technology.id,

        name: technology.name,

        slug: technology.slug,
      })),

      links: project.links.map((link) => this.toLinkDto(link)),

      testimonials: project.testimonials.map((testimonial) =>
        this.toTestimonialDto(testimonial),
      ),

      statistics: {
        memberCount: project.members.length,

        technologyCount: project.technologies.length,

        categoryCount: project.categories.length,

        testimonialCount: project.testimonials.length,
      },

      isMember,

      permissions,
    };
  }
}
