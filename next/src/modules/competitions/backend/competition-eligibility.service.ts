import { Prisma, type EligibilityType } from "@/generated/prisma";

import { CompetitionEligibilityNotFoundError } from "../errors";
import type { CompetitionEligibilityDTO } from "../types/competition-eligibility.dto";
import { competitionEligibilityMapper } from "./competition-eligibility.mapper";
import { CompetitionEligibilityRepository } from "./competition-eligibility.repository";

export class CompetitionEligibilityService {
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
   * `CompetitionEligibility` means who the competition is open to. Unlike
   * `CompetitionTechnology`, there is no external catalog to re-validate
   * against — `type` is already constrained to the `EligibilityType` enum
   * by `AttachCompetitionEligibilitySchema`, so attach/detach is all there
   * is.
   */
  static async list(
    competitionId: string,
  ): Promise<CompetitionEligibilityDTO[]> {
    const eligibilities =
      await CompetitionEligibilityRepository.findManyByCompetition(competitionId);

    return competitionEligibilityMapper.toDTOs(eligibilities);
  }

  /**
   * Attaches an eligibility value to a competition.
   *
   * Idempotent: attaching an already-attached value succeeds without error,
   * since a double-click or a race between two admins should not surface as
   * a failure.
   */
  static async attach(
    competitionId: string,
    type: EligibilityType,
  ): Promise<CompetitionEligibilityDTO[]> {
    const existing = await CompetitionEligibilityRepository.findOne(
      competitionId,
      type,
    );

    if (!existing) {
      try {
        await CompetitionEligibilityRepository.create(competitionId, type);
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
   * Detaches an eligibility value from a competition.
   */
  static async detach(
    competitionId: string,
    type: EligibilityType,
  ): Promise<CompetitionEligibilityDTO[]> {
    const deleted = await CompetitionEligibilityRepository.deleteMany(
      competitionId,
      type,
    );

    if (deleted === 0) {
      throw new CompetitionEligibilityNotFoundError();
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
