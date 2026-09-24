/**
 * Portfolio Module - Service
 *
 * Responsible for all business rules:
 *
 * - Duplicate detection
 * - Transactions
 * - Workflows
 * - Permission checks
 * * - Business validation
 */

import {
  AuthorizationCode,
  StrictAuthorizationActor,
} from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformAuthorizer } from "@/authorization/platform/authorizer";
import { AuthorizationError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import { AssetPurpose } from "@/generated/prisma";
import { assertAssetReferenceAllowed } from "@/modules/assets/backend/reference-policy";
import { assetService } from "@/modules/assets/backend/service";

import {
  PortfolioAction,
  PortfolioAuthorizer,
  PortfolioContextResolver,
  PortfolioPolicy,
} from "./authorization";
import type { PortfolioContext } from "./authorization";

import { PortfolioProfileUpdateData, PortfolioRepository } from "./repository";
import type { PortfolioAuthorizationEntity } from "./repository";
import { PortfolioEditorDto, PortfolioPublicDto } from "../dtos";
import {
  PortfolioAlreadyExistsError,
  PortfolioDeletedError,
  PortfolioNotDeletedError,
  PortfolioNotFoundError,
} from "../errors";
import { PortfolioMapper } from "./mapper/mapper";
import { UpdatePortfolioProfileDto } from "../dtos/input/update.dto";
import type { ChangePortfolioVisibilityInput } from "../schemas/portfolio-visibility.schema";

export class PortfolioService {
  private readonly repository = new PortfolioRepository();

  // ===========================================================================
  // Read
  // ===========================================================================

  async findPublicByUsername({
    username,
  }: {
    username: string;
  }): Promise<PortfolioPublicDto> {
    // PortfolioPolicy is the authoritative decision here. The repository's
    // SQL pre-filter on findPublicByUsername (visibility PUBLIC / deletedAt
    // null / owner not banned) is retained as defence-in-depth and as a
    // data-scoping optimisation — the same pattern as
    // publiclyListableProjectWhere for Projects — but it cannot express the
    // public-display eligibility axis, which is a runtime value (see
    // authorization/public-eligibility.ts). So the policy runs first, and is
    // what actually decides.
    const authorizationRow = await this.repository.findForAuthorizationByUsername({
      username,
    });

    if (!authorizationRow) {
      throw new PortfolioNotFoundError();
    }

    const context = PortfolioContextResolver.forPublicRead({
      portfolio: authorizationRow,
    });

    // Deliberately `.can(...).allowed` rather than PortfolioAuthorizer.read:
    // this is an unauthenticated endpoint, so every denial reason — private,
    // owner banned, soft-deleted, or not publicly eligible — must be
    // indistinguishable from "no such portfolio". A 403 here would leak the
    // existence of a private or plan-gated portfolio that a 404 does not.
    if (!PortfolioPolicy.can(context, PortfolioAction.VIEW).allowed) {
      throw new PortfolioNotFoundError();
    }

    const portfolio = await this.repository.findPublicByUsernameOrThrow({
      username,
    });

    return PortfolioMapper.toPublicDto(portfolio);
  }

  async findMine({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioEditorDto | null> {
    const portfolio = await this.repository.findEditorByUserId({
      userId: actor.id,
    });

    if (!portfolio) {
      return null;
    }

    // A soft-deleted portfolio is refused here (403 RESOURCE_DELETED) rather
    // than returned or reported as missing: the owner's editor keys on that
    // code to offer a restore, and it stays distinguishable from "you have no
    // portfolio yet" (404), which offers creation.
    PortfolioAuthorizer.read(this.ownerContext({ actor, portfolio }));

    return PortfolioMapper.toEditorDto(portfolio);
  }

  // ===========================================================================
  // Create
  // ===========================================================================

  async create({
    actor,
    // dto,
  }: {
    actor: StrictAuthorizationActor;
    // dto: CreatePortfolioDto;
  }): Promise<PortfolioEditorDto> {
    if (!actor.id) {
      throw new AuthorizationError({
        code: AuthorizationCode.UNAUTHORIZED,
        status: 401,
        message: "Authentication is required.",
      });
    }

    // Platform-level entitlement seam. Every authenticated role is granted
    // this today (no subscription/plan system exists yet), but routing
    // creation through PlatformAuthorizer means a future plan/entitlement
    // system can restrict it by changing PlatformPermissionSet alone,
    // without touching this service. See permission-set.ts.
    PlatformAuthorizer.can({ actor }, PlatformAction.CREATE_PORTFOLIO);

    const context = PortfolioContextResolver.forCreate({
      actor,
    });

    PortfolioAuthorizer.create(context);

    await this.ensurePortfolioDoesNotExist({
      userId: actor.id,
    });

    // const createData = PortfolioMapper.toCreateData(dto);

    const user = await this.repository.findUserForCreation({
      userId: actor.id,
    });

    if (!user) {
      throw new AuthorizationError({
        code: AuthorizationCode.UNAUTHORIZED,
        status: 401,
        message: "Authenticated user could not be found.",
      });
    }

    const displayName: string = user.name;

    // `visibility` is deliberately not set: the column default (PRIVATE) is
    // the single source of truth for what a new portfolio starts as.
    const portfolio = await prisma.$transaction(async (tx) => {
      const repository = new PortfolioRepository(tx);

      return repository.create({
        data: {
          displayName: displayName,

          user: {
            connect: {
              id: actor.id,
            },
          },

          // ...(dto.resumeAssetId && {
          //   resumeAsset: {
          //     connect: {
          //       id: dto.resumeAssetId,
          //     },
          //   },
          // }),
        },
      });
    });

    return PortfolioMapper.toEditorDto(portfolio);
  }
  // ===========================================================================
  // Profile
  // ===========================================================================

  async updateProfile({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: UpdatePortfolioProfileDto;
  }): Promise<PortfolioEditorDto> {
    // Only what authorizing the edit and driving the resume swap needs —
    // never the portfolio's content.
    const portfolio =
      await this.repository.findForProfileUpdateByUserIdOrThrow({
        userId: actor.id,
      });

    PortfolioAuthorizer.edit(this.ownerContext({ actor, portfolio }));

    // Target-domain authorization (above) only establishes that this actor
    // may edit this portfolio. It says nothing about whether the specific
    // Asset being attached as a resume is actually usable for that purpose
    // — a shared Asset is not automatically valid here just because the
    // actor is allowed to edit their own portfolio. See
    // docs/architecture/domain/assets/overview.md and reference-policy.ts.
    if (dto.resumeAssetId) {
      await assertAssetReferenceAllowed({
        assetId: dto.resumeAssetId,
        purpose: AssetPurpose.PORTFOLIO_RESUME,
      });
    }

    const updateData: PortfolioProfileUpdateData = {
      displayName: dto.displayName,
      headline: dto.headline,
      bio: dto.bio,
      phone: dto.phone,
      publicContactEmail: dto.publicContactEmail,
      location: dto.location,
      resumeAssetId: dto.resumeAssetId,
    };

    const previousResumeAssetId = portfolio.resumeAssetId;

    const updatedPortfolio = await prisma.$transaction(async (tx) => {
      // Authoritative, race-safe re-validation under lock — see
      // AssetService.prepareAssetAttach. The pre-transaction
      // assertAssetReferenceAllowed call above is a fast-fail check only.
      if (dto.resumeAssetId !== undefined) {
        await assetService.prepareAssetAttach(tx, {
          assetId: dto.resumeAssetId,
          previousAssetId: previousResumeAssetId,
          purpose: AssetPurpose.PORTFOLIO_RESUME,
        });
      }

      const repository = new PortfolioRepository(tx);

      const updated = await repository.updateProfile({
        id: portfolio.id,
        data: updateData,
      });

      if (
        dto.resumeAssetId !== undefined &&
        previousResumeAssetId &&
        previousResumeAssetId !== dto.resumeAssetId
      ) {
        await assetService.detachIfUnreferenced(tx, previousResumeAssetId);
      }

      return updated;
    });

    return PortfolioMapper.toEditorDto(updatedPortfolio);
  }

  // ===========================================================================
  // Visibility & lifecycle
  //
  // Stored visibility is the owner's preference (PUBLIC | PRIVATE). It is a
  // different axis from public-display eligibility (an entitlement, computed
  // at read time and never written here) and from deletion, which overrides
  // visibility for everyone but the owner. Nothing below touches the
  // portfolio's child rows or Asset references, so none of it needs a
  // transaction: each operation is a single write.
  // ===========================================================================

  async changeVisibility({
    actor,
    dto,
  }: {
    actor: StrictAuthorizationActor;
    dto: ChangePortfolioVisibilityInput;
  }): Promise<PortfolioEditorDto> {
    const portfolio =
      await this.repository.findForAuthorizationByUserIdOrThrow({
        userId: actor.id,
      });

    PortfolioAuthorizer.changeVisibility(
      this.ownerContext({ actor, portfolio }),
    );

    const updated = await this.repository.updateVisibility({
      id: portfolio.id,
      visibility: dto.visibility,
    });

    return PortfolioMapper.toEditorDto(updated);
  }

  async delete({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<void> {
    const portfolio =
      await this.repository.findForAuthorizationByUserIdOrThrow({
        userId: actor.id,
      });

    // Refuses an already-deleted portfolio (RESOURCE_DELETED), like every
    // other owner action.
    PortfolioAuthorizer.delete(this.ownerContext({ actor, portfolio }));

    await this.repository.softDelete({ id: portfolio.id });
  }

  async restore({
    actor,
  }: {
    actor: StrictAuthorizationActor;
  }): Promise<PortfolioEditorDto> {
    const portfolio =
      await this.repository.findForAuthorizationByUserIdOrThrow({
        userId: actor.id,
      });

    PortfolioAuthorizer.restore(this.ownerContext({ actor, portfolio }));

    if (!portfolio.deletedAt) {
      throw new PortfolioNotDeletedError();
    }

    const restored = await this.repository.restore({ id: portfolio.id });

    return PortfolioMapper.toEditorDto(restored);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * The authorization context for the actor's OWN portfolio.
   *
   * The actor IS the owner here (the row was looked up by their own userId),
   * so their ban state — already known from the session — is what
   * PortfolioContextResolver.fromData uses for `ownerBanned`; no extra fetch
   * of `user.banned` is needed for these owner-only paths.
   */
  private ownerContext({
    actor,
    portfolio,
  }: {
    actor: StrictAuthorizationActor;
    portfolio: Pick<
      PortfolioAuthorizationEntity,
      "id" | "userId" | "visibility" | "deletedAt"
    >;
  }): PortfolioContext {
    return PortfolioContextResolver.fromData({
      actor,
      portfolio: {
        id: portfolio.id,
        userId: portfolio.userId,
        visibility: portfolio.visibility,
        deletedAt: portfolio.deletedAt,
        user: { banned: actor.banned },
      },
    });
  }

  private async ensurePortfolioDoesNotExist({
    userId,
  }: {
    userId: string;
  }): Promise<void> {
    const existing = await this.repository.findForAuthorizationByUserId({
      userId,
    });

    if (!existing) {
      return;
    }

    // `Portfolio.userId` is unique and nothing is hard-deleted, so a
    // soft-deleted portfolio still occupies the user's one slot. Say so,
    // rather than a generic "already exists" the owner cannot act on.
    if (existing.deletedAt) {
      throw new PortfolioDeletedError();
    }

    throw new PortfolioAlreadyExistsError();
  }
}

export const portfolioService = new PortfolioService();
