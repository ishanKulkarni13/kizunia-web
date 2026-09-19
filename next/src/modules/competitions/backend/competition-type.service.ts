import { Prisma, type CompetitionType } from "@/generated/prisma";

import { CompetitionTypeNotFoundError } from "../errors";
import type { CompetitionTypeDTO } from "../types/competition-type.dto";
import { competitionTypeMapper } from "./competition-type.mapper";
import { CompetitionTypeRepository } from "./competition-type.repository";

export class CompetitionTypeService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * - Business rules
   * - Repository orchestration
   * - Domain validation
   * - Mapping database models
   *
   * Does NOT
   * ----------------
   * - Parse HTTP requests
   * - Authenticate users
   * - Authorize users
   * - Query Prisma directly
   * - Return NextResponse
   *
   * `CompetitionType` describes the fundamental nature of the competition
   * (Hackathon, CTF, Quiz, etc.). Like `CompetitionEligibility`, there is no
   * external catalog to re-validate against -- `type` is already constrained
   * to the `CompetitionType` enum by `AttachCompetitionTypeSchema`, so
   * attach/detach is all there is.
   */
  static async list(
    competitionId: string,
  ): Promise<CompetitionTypeDTO[]> {
    const types =
      await CompetitionTypeRepository.findManyByCompetition(competitionId);

    return competitionTypeMapper.toDTOs(types);
  }

  /**
   * Attaches a type value to a competition.
   *
   * Idempotent: attaching an already-attached type succeeds without error,
   * since a double-click or a race between two admins should not surface as
   * a failure.
   */
  static async attach(
    competitionId: string,
    type: CompetitionType,
  ): Promise<CompetitionTypeDTO[]> {
    const existing = await CompetitionTypeRepository.findOne(
      competitionId,
      type,
    );

    if (!existing) {
      try {
        await CompetitionTypeRepository.create(competitionId, type);
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
   * Detaches a type value from a competition.
   */
  static async detach(
    competitionId: string,
    type: CompetitionType,
  ): Promise<CompetitionTypeDTO[]> {
    const deleted = await CompetitionTypeRepository.deleteMany(
      competitionId,
      type,
    );

    if (deleted === 0) {
      throw new CompetitionTypeNotFoundError();
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
