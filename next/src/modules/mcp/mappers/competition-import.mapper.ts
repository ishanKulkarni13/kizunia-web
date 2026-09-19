import { slugify } from "@/utils/utils";
import { CompetitionRepository } from "@/modules/competitions/backend/repository";
import type { CreateCompetitionInput } from "@/modules/competitions/schemas/create-competition";
import type { UpdateCompetitionInput } from "@/modules/competitions/schemas/update-competition";

import type { CompetitionImportInput } from "../schemas/competitions/competition-import.schema";

/**
 * Translates the MCP import contract into the exact input shapes
 * `CompetitionService.create` / `CompetitionService.update` already accept.
 *
 * This is the *only* place that reshapes MCP input into domain input.
 * Nothing downstream of `CompetitionService` ever sees `CompetitionImportInput`
 * — from the service layer inward, an MCP-originated write is indistinguishable
 * from one made through the admin console.
 */
export class CompetitionImportMapper {
  /**
   * Finds a slug for a new competition.
   *
   * The import contract's slug is optional (see
   * `competition-import.schema.ts`); when absent, one is derived from the
   * title and, if that value is already taken, disambiguated with a numeric
   * suffix. `CompetitionService.create` still performs its own
   * `validateCreate` uniqueness check — this loop only makes the *common*
   * case (an agent never supplies a slug) succeed on the first attempt
   * instead of bouncing with `DuplicateSlugError` for a value the caller
   * never chose in the first place.
   */
  static async resolveSlug(input: CompetitionImportInput): Promise<string> {
    if (input.slug) {
      return input.slug;
    }

    const base = slugify(input.title).slice(0, 150) || "competition";

    let candidate = base;
    let suffix = 2;

    // Bounded: this only guards against the derived slug colliding with an
    // existing row, not an adversarial input, so a small, fixed ceiling is
    // enough — beyond it, surfacing `DuplicateSlugError` to the caller (who
    // can then supply an explicit slug) is more honest than looping forever.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const exists = await CompetitionRepository.existsBySlug(candidate);

      if (!exists) {
        return candidate;
      }

      suffix += 1;
      candidate = `${base}-${suffix}`.slice(0, 150);
    }

    return candidate;
  }

  static toCreateInput(
    input: CompetitionImportInput,
    slug: string,
  ): CreateCompetitionInput {
    return {
      title: input.title,
      slug,
      shortDescription: input.shortDescription,
      organizer: input.organizer,
      website: input.website,
      registrationLink: input.registrationLink,
      content: input.content,
    };
  }

  /**
   * `CreateCompetitionSchema` only covers a handful of fields (see the
   * audit) — everything else the import contract carries is applied as a
   * follow-up update in the very same request, through the ordinary
   * `CompetitionService.update` path. This keeps `CompetitionService.create`
   * itself untouched and reuses its existing lifecycle-reconciliation
   * behaviour for the richer fields.
   */
  static toCreateFollowUpUpdate(
    input: CompetitionImportInput,
  ): UpdateCompetitionInput | null {
    const patch = this.toUpdateInput(input);

    return Object.keys(patch).length > 0 ? patch : null;
  }

  /**
   * Builds an `UpdateCompetitionInput` from whichever fields `patch` set.
   * Fields absent from `patch` are simply absent from the result —
   * `UpdateCompetitionSchema`'s "undefined leaves the field alone" contract
   * is preserved because this only ever assigns keys that were present.
   */
  static toUpdateInput(patch: Partial<CompetitionImportInput>): UpdateCompetitionInput {
    const data: UpdateCompetitionInput = {};

    if (patch.title !== undefined) data.title = patch.title;
    if (patch.slug !== undefined) data.slug = patch.slug;
    if (patch.shortDescription !== undefined)
      data.shortDescription = patch.shortDescription;
    if (patch.organizer !== undefined) data.organizer = patch.organizer;
    if (patch.organizerType !== undefined) data.organizerType = patch.organizerType;
    if (patch.website !== undefined) data.website = patch.website;
    if (patch.registrationLink !== undefined)
      data.registrationLink = patch.registrationLink;
    if (patch.registrationPlatform !== undefined)
      data.registrationPlatform = patch.registrationPlatform;
    if (patch.registrationFeeType !== undefined)
      data.registrationFeeType = patch.registrationFeeType;
    if (patch.registrationFee !== undefined)
      data.registrationFee = patch.registrationFee;
    if (patch.prizePool !== undefined) data.prizePool = patch.prizePool;
    if (patch.mode !== undefined) data.mode = patch.mode;
    if (patch.difficulty !== undefined) data.difficulty = patch.difficulty;
    if (patch.certificateType !== undefined)
      data.certificateType = patch.certificateType;
    if (patch.minTeamSize !== undefined) data.minTeamSize = patch.minTeamSize;
    if (patch.maxTeamSize !== undefined) data.maxTeamSize = patch.maxTeamSize;
    if (patch.startDate !== undefined) data.startDate = new Date(patch.startDate);
    if (patch.endDate !== undefined) data.endDate = new Date(patch.endDate);
    if (patch.registrationStartDate !== undefined)
      data.registrationStartDate = new Date(patch.registrationStartDate);
    if (patch.registrationDeadline !== undefined)
      data.registrationDeadline = new Date(patch.registrationDeadline);
    if (patch.content !== undefined) data.content = patch.content;

    return data;
  }
}
