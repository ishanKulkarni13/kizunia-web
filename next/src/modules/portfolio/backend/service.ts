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
  AuthorizationActor,
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

import { PortfolioAuthorizer, PortfolioContextResolver } from "./authorization";

import { PortfolioProfileUpdateData, PortfolioRepository } from "./repository";
import { PortfolioEditorDto, PortfolioPublicDto } from "../dtos";
import { PortfolioAlreadyExistsError } from "../errors";
import { PortfolioMapper } from "./mapper/mapper";
import { UpdatePortfolioProfileDto } from "../dtos/input/update.dto";

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
    // if (!actor.id) {
    //   throw new AuthorizationError({
    //     code: AuthorizationCode.UNAUTHORIZED,
    //     status: 401,
    //     message: "Authentication is required.",
    //   });
    // }

    const portfolio = await this.repository.findEditorByUserId({
      userId: actor.id,
    });

    if (!portfolio) {
      return null;
    }

    PortfolioAuthorizer.read({
      actor,
      portfolio,
      isOwner: portfolio.userId === actor.id,
    });

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
    // if (!actor.id) {
    //   throw new AuthorizationError({
    //     code: AuthorizationCode.UNAUTHORIZED,
    //     status: 401,
    //     message: "Authentication is required.",
    //   });
    // }

    const portfolio = await this.repository.findByUserIdOrThrow({
      userId: actor.id,
    });

    const context = PortfolioContextResolver.fromData({
      actor,
      portfolio: {
        id: portfolio.id,
        userId: portfolio.userId,
        visibility: portfolio.visibility,
        deletedAt: portfolio.deletedAt,
      },
    });

    PortfolioAuthorizer.edit(context);

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
  // Helpers
  // ===========================================================================

  private async ensurePortfolioDoesNotExist({
    userId,
  }: {
    userId: string;
  }): Promise<void> {
    const exists = await this.repository.existsByUserId({
      userId,
    });

    if (exists) {
      throw new PortfolioAlreadyExistsError();
    }
  }
}

export const portfolioService = new PortfolioService();
