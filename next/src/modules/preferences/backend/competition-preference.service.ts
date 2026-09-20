import {
  CertificateType,
  CompetitionMode,
  CompetitionPreferenceDimension,
  CompetitionStatus,
  DifficultyLevel,
  EligibilityType,
  OrganizerType,
  RegistrationFeeType,
  RegistrationPlatform,
  RegistrationType,
} from "@/generated/prisma";
import prisma from "@/lib/prisma";
import { HttpStatus, ValidationError } from "@/lib/errors";
import { DimensionId } from "@/modules/recommendations";

import { CompetitionPreferenceRepository } from "./competition-preference.repository";
import type { CompetitionPreferenceEntryDTO } from "../types/competition-preference.dto";
import type { UpdateCompetitionPreferencesInput } from "../schemas/competition-preference";

type PreferenceEntryInput = UpdateCompetitionPreferencesInput["preferences"][number];

/**
 * Dimensions whose values are drawn from a fixed, existing Prisma enum.
 * Reuses the generated enums as the single source of truth for "what values
 * are valid here" — never a separately maintained literal list that could
 * drift from the actual competition domain.
 */
const ENUM_BACKED_DIMENSIONS: Partial<Record<DimensionId, readonly string[]>> = {
  [DimensionId.MODE]: Object.values(CompetitionMode),
  [DimensionId.REGISTRATION_PLATFORM]: Object.values(RegistrationPlatform),
  [DimensionId.REGISTRATION_TYPE]: Object.values(RegistrationType),
  [DimensionId.REGISTRATION_FEE_TYPE]: Object.values(RegistrationFeeType),
  [DimensionId.ORGANIZER_TYPE]: Object.values(OrganizerType),
  [DimensionId.DIFFICULTY]: Object.values(DifficultyLevel),
  [DimensionId.CERTIFICATE_TYPE]: Object.values(CertificateType),
  [DimensionId.STATUS]: Object.values(CompetitionStatus),
  [DimensionId.ELIGIBILITIES]: Object.values(EligibilityType),
};

/** `teamSize` isn't backed by an enum or another table — any positive integer string is valid. */
const POSITIVE_INTEGER = /^[1-9]\d*$/;

function invalidPreferenceError(message: string, details?: unknown): ValidationError {
  return new ValidationError({
    code: "INVALID_COMPETITION_PREFERENCE",
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message,
    details,
  });
}

export class CompetitionPreferenceService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Validate dimension/value/weight combinations before they ever reach
   *   the database
   * ✓ Repository orchestration (transactional full-replace)
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate or authorize users
   * ✗ Interpret weight semantics (soft vs. hard) — that is the
   *   recommendation engine's job (`engine/profile.ts`), not this service's
   */

  static async getForUser(userId: string): Promise<CompetitionPreferenceEntryDTO[]> {
    const rows = await CompetitionPreferenceRepository.findByUser(userId);

    return rows.map((row) => ({
      dimension: row.dimension as DimensionId,
      value: row.value,
      weight: row.weight,
    }));
  }

  /**
   * Validates then replaces the user's entire competition preference
   * profile. Validation runs to completion before any write, so an invalid
   * payload never partially lands.
   */
  static async replaceForUser(
    userId: string,
    input: UpdateCompetitionPreferencesInput,
  ): Promise<CompetitionPreferenceEntryDTO[]> {
    this.assertNoDuplicates(input.preferences);
    await this.assertValidValues(input.preferences);

    await CompetitionPreferenceRepository.replaceForUser(
      userId,
      input.preferences.map((entry) => ({
        dimension: entry.dimension as CompetitionPreferenceDimension,
        value: entry.value,
        weight: entry.weight,
      })),
    );

    return input.preferences;
  }

  /**
   * A duplicate `(dimension, value)` pair within one payload would
   * otherwise surface as an opaque unique-constraint violation from the
   * database — caught here first for a clear, actionable error instead.
   */
  private static assertNoDuplicates(preferences: readonly PreferenceEntryInput[]): void {
    const seen = new Set<string>();

    for (const entry of preferences) {
      const key = `${entry.dimension}:${entry.value}`;

      if (seen.has(key)) {
        throw invalidPreferenceError(
          `Duplicate preference for dimension "${entry.dimension}" and value "${entry.value}".`,
          { dimension: entry.dimension, value: entry.value },
        );
      }

      seen.add(key);
    }
  }

  private static async assertValidValues(
    preferences: readonly PreferenceEntryInput[],
  ): Promise<void> {
    const categoryValues = uniqueValuesFor(preferences, DimensionId.CATEGORIES);
    const technologyValues = uniqueValuesFor(preferences, DimensionId.TECHNOLOGIES);
    const locationValues = uniqueValuesFor(preferences, DimensionId.LOCATION);

    const [validCategories, validTechnologies, validSearchAreas] = await Promise.all([
      categoryValues.length
        ? prisma.category.findMany({
            where: { slug: { in: categoryValues } },
            select: { slug: true },
          })
        : Promise.resolve([]),
      technologyValues.length
        ? prisma.technology.findMany({
            where: { slug: { in: technologyValues } },
            select: { slug: true },
          })
        : Promise.resolve([]),
      locationValues.length
        ? prisma.searchArea.findMany({
            where: { id: { in: locationValues } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const validCategorySlugs = new Set(validCategories.map((c) => c.slug));
    const validTechnologySlugs = new Set(validTechnologies.map((t) => t.slug));
    const validSearchAreaIds = new Set(validSearchAreas.map((s) => s.id));

    for (const entry of preferences) {
      const dimension = entry.dimension as DimensionId;
      const enumValues = ENUM_BACKED_DIMENSIONS[dimension];

      if (enumValues) {
        if (!enumValues.includes(entry.value)) {
          throw invalidPreferenceError(
            `"${entry.value}" is not a valid value for dimension "${dimension}".`,
            { dimension, value: entry.value },
          );
        }
        continue;
      }

      if (dimension === DimensionId.CATEGORIES && !validCategorySlugs.has(entry.value)) {
        throw invalidPreferenceError(`Unknown category "${entry.value}".`, {
          dimension,
          value: entry.value,
        });
      }

      if (dimension === DimensionId.TECHNOLOGIES && !validTechnologySlugs.has(entry.value)) {
        throw invalidPreferenceError(`Unknown technology "${entry.value}".`, {
          dimension,
          value: entry.value,
        });
      }

      if (dimension === DimensionId.LOCATION && !validSearchAreaIds.has(entry.value)) {
        throw invalidPreferenceError(`Unknown location "${entry.value}".`, {
          dimension,
          value: entry.value,
        });
      }

      if (dimension === DimensionId.TEAM_SIZE && !POSITIVE_INTEGER.test(entry.value)) {
        throw invalidPreferenceError(`"${entry.value}" is not a valid team size.`, {
          dimension,
          value: entry.value,
        });
      }
    }
  }
}

function uniqueValuesFor(
  preferences: readonly PreferenceEntryInput[],
  dimension: DimensionId,
): string[] {
  return [...new Set(preferences.filter((e) => e.dimension === dimension).map((e) => e.value))];
}
