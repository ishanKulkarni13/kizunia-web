/**
 * Dispatches "is this actor authorized to upload for this purpose/entity?"
 * to the relevant domain module's own authorizer.
 *
 * This is intentionally a direct, explicit switch over the known purposes —
 * not a generic plugin/registry system. There are a small, fixed number of
 * purposes, each already owned by an existing domain authorizer; a registry
 * would be speculative abstraction for a list that rarely changes. See
 * docs/architecture/domain/assets/upload.md.
 */

import { AssetPurpose } from "@/generated/prisma";
import type { AuthorizationActor } from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import { UnauthorizedError, ValidationError } from "@/lib/errors";

import { ProjectAuthorizer } from "@/modules/projects/backend/authorization/authorizer";
import { ProjectContextResolver } from "@/modules/projects/backend/authorization/context-resolver";

import { CompetitionAuthorizer } from "@/modules/competitions/backend/authorization/authorizer";
import { CompetitionContextResolver } from "@/modules/competitions/backend/authorization/context-resolver";
import { CompetitionSuggestionAuthorizer } from "@/modules/competitions/backend/suggestion/authorization/authorizer";
import { CompetitionSuggestionContextResolver } from "@/modules/competitions/backend/suggestion/authorization/resolver";

import { PortfolioAction } from "@/modules/portfolio/backend/authorization/actions";
import { PortfolioAuthorizer } from "@/modules/portfolio/backend/authorization/authorizer";
import { PortfolioContextResolver } from "@/modules/portfolio/backend/authorization/context-resolver";
import { PortfolioRepository } from "@/modules/portfolio/backend/repository";

import { ProjectAction } from "@/modules/projects/backend/authorization/actions";

function requireTargetEntityId(
  purpose: AssetPurpose,
  targetEntityId: string | null | undefined,
): string {
  if (!targetEntityId) {
    throw new ValidationError({
      code: "TARGET_ENTITY_REQUIRED",
      status: 400,
      message: `${purpose} requires a target entity id.`,
    });
  }

  return targetEntityId;
}

function requireActorId(actor: AuthorizationActor): string {
  if (!actor.id) {
    throw new UnauthorizedError({
      code: "unauthorized",
      message: "Authentication is required.",
    });
  }

  return actor.id;
}

export async function authorizeUploadForPurpose({
  actor,
  purpose,
  targetEntityId,
}: {
  actor: AuthorizationActor;
  purpose: AssetPurpose;
  targetEntityId?: string | null;
}): Promise<void> {
  switch (purpose) {
    case AssetPurpose.USER_AVATAR:
    case AssetPurpose.USER_COVER: {
      // Self-only: an actor may only upload their own avatar/cover. There is
      // no separate target entity to resolve — the actor IS the target.
      requireActorId(actor);
      return;
    }

    case AssetPurpose.PROJECT_LOGO:
    case AssetPurpose.PROJECT_COVER: {
      const projectId = requireTargetEntityId(purpose, targetEntityId);

      const context = await ProjectContextResolver.resolve({
        actor,
        projectId,
      });

      ProjectAuthorizer.edit(context);
      return;
    }

    case AssetPurpose.COMPETITION_LOGO:
    case AssetPurpose.COMPETITION_BANNER:
    case AssetPurpose.COMPETITION_COVER: {
      const competitionId = requireTargetEntityId(purpose, targetEntityId);

      const context = await CompetitionContextResolver.resolve({
        actor,
        competitionId,
      });

      CompetitionAuthorizer.edit(context);
      return;
    }

    case AssetPurpose.COMPETITION_SUGGESTION_GALLERY: {
      const suggestionId = requireTargetEntityId(purpose, targetEntityId);

      const context = await CompetitionSuggestionContextResolver.resolve({
        actor,
        suggestionId,
      });

      CompetitionSuggestionAuthorizer.edit(context);
      return;
    }

    case AssetPurpose.PORTFOLIO_RESUME:
    case AssetPurpose.PORTFOLIO_EDUCATION_LOGO:
    case AssetPurpose.PORTFOLIO_EXPERIENCE_LOGO:
    case AssetPurpose.PORTFOLIO_ACHIEVEMENT_ASSET:
    case AssetPurpose.PORTFOLIO_CERTIFICATION_ASSET: {
      // Always the actor's own portfolio — there is exactly one per user, so
      // no client-supplied target entity is needed or trusted here.
      const actorId = requireActorId(actor);

      const portfolioRepository = new PortfolioRepository();

      const portfolio = await portfolioRepository.findByUserIdOrThrow({
        userId: actorId,
      });

      const context = await PortfolioContextResolver.resolve({
        actor,
        portfolioId: portfolio.id,
      });

      PortfolioAuthorizer.edit(context);
      return;
    }

    case AssetPurpose.PROJECT_TESTIMONIAL_IMAGE: {
      // Image management is part of testimonial management — reuse
      // MANAGE_TESTIMONIALS rather than a separate image action.
      const projectId = requireTargetEntityId(purpose, targetEntityId);

      const context = await ProjectContextResolver.resolve({
        actor,
        projectId,
      });

      ProjectAuthorizer.can(context, ProjectAction.MANAGE_TESTIMONIALS);
      return;
    }

    case AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE: {
      // Always the actor's own portfolio — there is exactly one per user.
      // targetEntityId is not used to resolve authorization (unlike
      // PROJECT_TESTIMONIAL_IMAGE); it is only present to satisfy the
      // upload policy's requiresTargetEntity bookkeeping, matching the
      // PORTFOLIO_RESUME-style purposes above. Image management is part of
      // testimonial management — reuse MANAGE_TESTIMONIALS rather than a
      // separate image action.
      const actorId = requireActorId(actor);

      const portfolioRepository = new PortfolioRepository();

      const portfolio = await portfolioRepository.findByUserIdOrThrow({
        userId: actorId,
      });

      const context = await PortfolioContextResolver.resolve({
        actor,
        portfolioId: portfolio.id,
      });

      PortfolioAuthorizer.can(context, PortfolioAction.MANAGE_TESTIMONIALS);
      return;
    }

    // @deprecated Superseded by PROJECT_TESTIMONIAL_IMAGE /
    // PORTFOLIO_TESTIMONIAL_IMAGE. Never issued by application code; kept
    // only so the enum member (which cannot be safely dropped from
    // Postgres) has a defined, conservative fallback.
    case AssetPurpose.TESTIMONIAL_IMAGE:
    case AssetPurpose.BADGE_ICON: {
      // No per-instance authorizer exists yet for these. Conservatively
      // gate behind the existing platform-level media-management action
      // rather than leaving them unauthorized.
      PlatformAuthorizer.can({ actor }, PlatformAction.MANAGE_MEDIA);
      return;
    }

    case AssetPurpose.TECHNOLOGY_ICON: {
      // Technology is a global catalog with no per-instance ownership — the
      // actor authorized to manage the catalog is the actor authorized to
      // manage every Technology's icon. There is no separate
      // MANAGE_TECHNOLOGY_ICON action; the icon is attached to a specific
      // Technology only via TechnologyService.setIcon, which independently
      // re-checks this same permission — a client-supplied assetId alone is
      // never sufficient.
      PlatformAuthorizer.can({ actor }, PlatformAction.MANAGE_TECHNOLOGIES);
      return;
    }
  }
}
