/**
 * Portfolio Module - Mapper
 *
 * Responsible for mapping between entities and DTOs.
 */

import type { CreatePortfolioDto, PortfolioEditorDto } from "../../dtos";
import type { PortfolioPublicDto } from "../../dtos";
import type { PortfolioSummaryDto } from "../../dtos";

import type { PortfolioProjectSummaryDto } from "../../dtos";
import type { PortfolioTestimonialSummaryDto } from "../../dtos";
import type { PortfolioTechnologySummaryDto } from "../../dtos";

import type {
  PortfolioEditorEntity,
  PortfolioPublicDetailsEntity,
  PortfolioSummaryEntity,
} from "../repository";

import type { PortfolioProjectSummaryEntity } from "../portfolio-project.repository";
import type { PortfolioTestimonialEntity } from "../portfolio-testimonial.repository";
import type { PortfolioTechnologyEntity } from "../portfolio-technology.repository";

function toPublicAssetDto(
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

export class PortfolioMapper {
  // ===========================================================================
  // Read
  // ===========================================================================

  /**
   * Maps to the public API contract. Every field is picked explicitly —
   * this must never become an entity passthrough, since the entity carries
   * internal fields (userId, deletedAt, visibility, user.id, user.name,
   * raw foreign keys) that are not part of the public contract.
   */
  static toPublicDto(
    portfolio: PortfolioPublicDetailsEntity,
  ): PortfolioPublicDto {
    if (!portfolio.user.username) {
      // Structurally unreachable: the repository's public lookup always
      // filters by a non-null username. Guarded here so the DTO's
      // `user.username: string` contract is never silently violated.
      throw new Error(
        "Cannot map a portfolio to PortfolioPublicDto without an owner username.",
      );
    }

    return {
      id: portfolio.id,

      displayName: portfolio.displayName,
      headline: portfolio.headline,
      bio: portfolio.bio,

      publicContactEmail: portfolio.publicContactEmail,
      phone: portfolio.phone,
      location: portfolio.location,

      createdAt: portfolio.createdAt.toISOString(),

      user: {
        username: portfolio.user.username,
        avatar: toPublicAssetDto(portfolio.user.avatarAsset),
        cover: toPublicAssetDto(portfolio.user.coverAsset),
      },

      settings: portfolio.settings
        ? {
            theme: portfolio.settings.theme,
            accentColor: portfolio.settings.accentColor,
            sectionOrder: portfolio.settings.sectionOrder,
            hiddenSections: portfolio.settings.hiddenSections,
          }
        : null,

      resumeAsset: toPublicAssetDto(portfolio.resumeAsset),

      links: portfolio.links.map((link) => ({
        id: link.id,
        url: link.url,
        title: link.title,
        type: link.type,
        order: link.order,
      })),

      technologies: portfolio.technologies.map((entry) => ({
        technology: {
          id: entry.technology.id,
          name: entry.technology.name,
          slug: entry.technology.slug,
        },
        startedUsingAt: entry.startedUsingAt?.toISOString() ?? null,
        description: entry.description,
        displayOrder: entry.displayOrder,
      })),

      education: portfolio.education.map((entry) => ({
        id: entry.id,
        institution: entry.institution,
        degree: entry.degree,
        fieldOfStudy: entry.fieldOfStudy,
        grade: entry.grade,
        description: entry.description,
        startDate: entry.startDate?.toISOString() ?? null,
        endDate: entry.endDate?.toISOString() ?? null,
        currentlyStudying: entry.currentlyStudying,
        institutionLogo: toPublicAssetDto(entry.institutionLogoAsset),
        displayOrder: entry.displayOrder,
      })),

      experience: portfolio.experience.map((entry) => ({
        id: entry.id,
        company: entry.company,
        position: entry.position,
        employmentType: entry.employmentType,
        location: entry.location,
        description: entry.description,
        startDate: entry.startDate?.toISOString() ?? null,
        endDate: entry.endDate?.toISOString() ?? null,
        currentlyWorking: entry.currentlyWorking,
        companyLogo: toPublicAssetDto(entry.companyLogoAsset),
        displayOrder: entry.displayOrder,
      })),

      achievements: portfolio.achievements.map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        achievedAt: entry.achievedAt?.toISOString() ?? null,
        asset: toPublicAssetDto(entry.asset),
        displayOrder: entry.displayOrder,
      })),

      certifications: portfolio.certifications.map((entry) => ({
        id: entry.id,
        title: entry.title,
        issuer: entry.issuer,
        issueDate: entry.issueDate?.toISOString() ?? null,
        expiryDate: entry.expiryDate?.toISOString() ?? null,
        credentialId: entry.credentialId,
        credentialUrl: entry.credentialUrl,
        asset: toPublicAssetDto(entry.asset),
        displayOrder: entry.displayOrder,
      })),

      testimonials: portfolio.testimonials.map((entry) => ({
        id: entry.id,
        name: entry.name,
        position: entry.position,
        company: entry.company,
        message: entry.message,
        rating: entry.rating,
        displayOrder: entry.displayOrder,
        image: toPublicAssetDto(entry.imageAsset),
      })),

      projects: portfolio.projects.map((entry) => ({
        featured: entry.featured,
        displayOrder: entry.displayOrder,
        project: {
          id: entry.project.id,
          title: entry.project.title,
          slug: entry.project.slug,
          shortDescription: entry.project.shortDescription,
          logo: toPublicAssetDto(entry.project.logoAsset),
          cover: toPublicAssetDto(entry.project.coverAsset),
          technologies: entry.project.technologies.map((tech) => ({
            id: tech.technology.id,
            name: tech.technology.name,
            slug: tech.technology.slug,
          })),
          categories: entry.project.categories.map((cat) => ({
            id: cat.category.id,
            name: cat.category.name,
            slug: cat.category.slug,
          })),
        },
      })),
    };
  }

  static toEditorDto(portfolio: PortfolioEditorEntity): PortfolioEditorDto {
    return portfolio;
  }

  // ===========================================================================
  // Portfolio Projects
  // ===========================================================================

  /**
   * Editor-side relationship view. Explicit field-by-field, so widening the
   * repository's select can never widen the wire contract by accident.
   */
  static toProjectSummaryDto(
    entry: PortfolioProjectSummaryEntity,
  ): PortfolioProjectSummaryDto {
    const membership = entry.project.members[0];

    if (!membership) {
      // The query filters to rows where the portfolio owner is still a
      // member, so a row without one means the filter was dropped.
      throw new Error(
        "Portfolio project membership was not loaded for a row returned by the membership-scoped query.",
      );
    }

    return {
      projectId: entry.projectId,

      title: entry.project.title,

      slug: entry.project.slug,

      shortDescription: entry.project.shortDescription,

      logo: toPublicAssetDto(entry.project.logoAsset),

      status: entry.project.status,

      visibility: entry.project.visibility,

      myRole: membership.role,

      featured: entry.featured,

      displayOrder: entry.displayOrder,

      createdAt: entry.createdAt,
    };
  }

  static toProjectSummaryDtos(
    entries: PortfolioProjectSummaryEntity[],
  ): PortfolioProjectSummaryDto[] {
    return entries.map((entry) => this.toProjectSummaryDto(entry));
  }

  static toTestimonialSummaryDto(
    entry: PortfolioTestimonialEntity,
  ): PortfolioTestimonialSummaryDto {
    return {
      id: entry.id,

      name: entry.name,

      position: entry.position,

      company: entry.company,

      message: entry.message,

      rating: entry.rating,

      displayOrder: entry.displayOrder,

      image: toPublicAssetDto(entry.imageAsset),

      createdAt: entry.createdAt,
    };
  }

  static toTestimonialSummaryDtos(
    entries: PortfolioTestimonialEntity[],
  ): PortfolioTestimonialSummaryDto[] {
    return entries.map((entry) => this.toTestimonialSummaryDto(entry));
  }

  static toTechnologySummaryDto(
    entry: PortfolioTechnologyEntity,
  ): PortfolioTechnologySummaryDto {
    return {
      technologyId: entry.technologyId,

      name: entry.technology.name,

      slug: entry.technology.slug,

      type: entry.technology.type,

      icon: toPublicAssetDto(entry.technology.iconAsset),

      startedUsingAt: entry.startedUsingAt?.toISOString() ?? null,

      description: entry.description,

      displayOrder: entry.displayOrder,
    };
  }

  static toTechnologySummaryDtos(
    entries: PortfolioTechnologyEntity[],
  ): PortfolioTechnologySummaryDto[] {
    return entries.map((entry) => this.toTechnologySummaryDto(entry));
  }

  static toSummaryDto(portfolio: PortfolioSummaryEntity): PortfolioSummaryDto {
    return portfolio;
  }

  static toSummaryDtos(
    portfolios: PortfolioSummaryEntity[],
  ): PortfolioSummaryDto[] {
    return portfolios.map(this.toSummaryDto);
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  /**
   * Maps only the data supplied by the client.
   *
   * This intentionally does NOT return a PrismaCreateInput.
   * Relations (user, assets, etc.) are attached by the service.
   */
  static toCreateData(dto: CreatePortfolioDto) {
    return {
      displayName: dto.displayName,

      headline: dto.headline,

      bio: dto.bio,

      phone: dto.phone,

      publicContactEmail: dto.publicContactEmail,

      location: dto.location,
    };
  }
}
