import type { CompetitionEditDTOWithPermissions } from "../types/edit-dto";
import type { UpdateCompetitionRequestDTO } from "../types/update-request-dto";
import { isEquivalent } from "./field-status";

/**
 * Every scalar key `UpdateCompetitionSchema` accepts. Deliberately explicit
 * rather than derived from `Object.keys` on either DTO: those also carry
 * `id`, `role`, `updatedAt`, `permissions`, `locations`, `technologies`, and
 * `categories`, none of which belong in a PATCH body (the relations are
 * managed by their own endpoints; `updatedAt`/`role`/`permissions` are
 * server-computed). Keeping this list explicit means a new editable field
 * must be added here deliberately, and `field-metadata.test.ts` checks it
 * against the schema so the two cannot silently drift apart.
 */
export const EDITABLE_SCALAR_KEYS = [
  "title",
  "slug",
  "shortDescription",
  "organizer",
  "visibility",
  "content",
  "website",
  "registrationLink",
  "prizePool",
  "registrationPlatform",
  "registrationFeeType",
  "organizerType",
  "difficulty",
  "certificateType",
  "registrationFee",
  "startDate",
  "endDate",
  "registrationDeadline",
  "registrationStartDate",
  "automaticStatusUpdatesDisabled",
  "minTeamSize",
  "maxTeamSize",
  "mode",
  "status",
] as const satisfies readonly (keyof CompetitionEditDTOWithPermissions)[];

export type EditableScalarKey = (typeof EDITABLE_SCALAR_KEYS)[number];

/**
 * Builds the PATCH payload as a true diff between the editor's current
 * value and the last-persisted snapshot: a key appears only when its value
 * changed, so `undefined` (key absent) means "not modified" and an explicit
 * `null` means "clear this field" — exactly the semantics
 * `CompetitionRepository.update` already implements by spreading the body
 * straight into Prisma.
 *
 * A field the admin edited and then edited back to its saved value is
 * omitted, same as if it had never been touched — this is what makes
 * `dirty` (an empty payload) a correct derived value instead of a flag that
 * has to be tracked separately.
 */
export function buildUpdateCompetitionPayload(
  current: CompetitionEditDTOWithPermissions,
  original: CompetitionEditDTOWithPermissions,
): UpdateCompetitionRequestDTO {
  const payload: Record<string, unknown> = {};

  for (const key of EDITABLE_SCALAR_KEYS) {
    if (!isEquivalent(current[key], original[key])) {
      payload[key] = current[key];
    }
  }

  return payload as UpdateCompetitionRequestDTO;
}
