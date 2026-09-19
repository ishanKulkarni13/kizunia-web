import { Prisma } from "@/generated/prisma";
import { HttpStatus, ValidationError } from "@/lib/errors";
import { TechnologyRepository } from "@/modules/technologies/backend/repository";

import { CompetitionErrorCode } from "../errors/error-code";
import { CompetitionTechnologyNotFoundError } from "../errors";
import type { CompetitionTechnologyDTO } from "../types/competition-technology.dto";
import { competitionTechnologyMapper } from "./competition-technology.mapper";
import { CompetitionTechnologyRepository } from "./competition-technology.repository";

export class CompetitionTechnologyService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Business rules
   * ✓ Repository orchestration
   * ✓ Domain validation
   * ✓ Mapping database models
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Authorize users
   * ✗ Query Prisma directly
   * ✗ Return NextResponse
   *
   * `CompetitionTechnology` means technologies *relevant to* the
   * competition — not technologies contestants are required to use. There
   * is no "required" concept, no min/max count validation, and (unlike
   * Project/Portfolio technologies) no ordering: attach/detach is all there
   * is.
   */
  static async list(competitionId: string): Promise<CompetitionTechnologyDTO[]> {
    const technologies =
      await CompetitionTechnologyRepository.findManyByCompetition(competitionId);

    return competitionTechnologyMapper.toDTOs(technologies);
  }

  /**
   * Attaches a Technology from the global catalog to a competition.
   *
   * The Technology's existence and active state are re-validated here,
   * independently of the client — the catalog endpoint the picker reads
   * from already excludes soft-deleted rows, but a stale client payload
   * could still submit one, and attaching a soft-deleted Technology must
   * always be rejected server-side.
   *
   * Idempotent: attaching an already-attached Technology succeeds without
   * error, since a double-click or a race between two admins should not
   * surface as a failure.
   */
  static async attach(
    competitionId: string,
    technologyId: string,
  ): Promise<CompetitionTechnologyDTO[]> {
    const technology = await TechnologyRepository.findActiveById(technologyId);

    if (!technology) {
      throw new ValidationError({
        code: CompetitionErrorCode.TECHNOLOGY_INACTIVE,
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message:
          "This technology is no longer available and cannot be attached.",
      });
    }

    const existing = await CompetitionTechnologyRepository.findOne(
      competitionId,
      technologyId,
    );

    if (!existing) {
      try {
        await CompetitionTechnologyRepository.create(competitionId, technologyId);
      } catch (error) {
        // The composite primary key is the authority on duplicates: two
        // concurrent attaches can both pass the check above before either
        // has written a row. Treat that race as success rather than
        // surfacing a raw constraint violation.
        if (!this.isUniqueConstraintViolation(error)) {
          throw error;
        }
      }
    }

    return this.list(competitionId);
  }

  /**
   * Detaches a Technology from a competition.
   *
   * Unconditional — always allowed, even for a Technology that has since
   * been soft-deleted from the global catalog, since stale-reference
   * cleanup must always be possible regardless of the Technology's current
   * state.
   */
  static async detach(
    competitionId: string,
    technologyId: string,
  ): Promise<CompetitionTechnologyDTO[]> {
    const deleted = await CompetitionTechnologyRepository.deleteMany(
      competitionId,
      technologyId,
    );

    if (deleted === 0) {
      throw new CompetitionTechnologyNotFoundError();
    }

    return this.list(competitionId);
  }

  private static isUniqueConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }
}
