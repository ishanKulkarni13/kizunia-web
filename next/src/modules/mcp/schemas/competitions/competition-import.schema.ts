import { z } from "zod";

import {
  CertificateType,
  CompetitionMode,
  DifficultyLevel,
  OrganizerType,
  RegistrationFeeType,
  RegistrationPlatform,
} from "@/generated/prisma";
import {
  ContentSchema,
  OrganizerSchema,
  ShortDescriptionSchema,
  SlugSchema,
  TitleSchema,
  UrlSchema,
} from "@/lib/validation/index";

/**
 * The MCP competition import contract.
 *
 * =============================================================================
 * Why this exists instead of accepting `Record<string, unknown>`
 * =============================================================================
 *
 * An MCP client extracts competition details from an arbitrary web page and
 * has to hand them to Kizunia somehow. Accepting a free-form object would
 * mean the *shape* of Kizunia's competition model is dictated by whatever
 * ChatGPT happens to send — mass assignment into `CompetitionRepository`,
 * one field at a time, forever. This schema is the actual, audited contract:
 * every field on it maps to a field `CompetitionService`/`CompetitionRepository`
 * already know how to write, nothing more.
 *
 * =============================================================================
 * Why this is not simply `CreateCompetitionSchema` / `UpdateCompetitionSchema`
 * =============================================================================
 *
 * Those two schemas are shaped for a browser form: fields arrive as already
 * region-appropriate strings the admin typed, dates as `Date`-coercible
 * values from a date picker, and `UpdateCompetitionSchema` in particular
 * encodes "explicit `null` clears the field, `undefined` leaves it alone" —
 * a distinction a JSON-RPC caller cannot reliably express the way a form
 * diff can (`undefined` does not round-trip through JSON at all). Reusing
 * them directly would either leak that HTTP-form-specific contract into MCP,
 * or force MCP callers to learn it.
 *
 * This schema instead defines the fields once, mirroring the *validation
 * rules* of `create-competition.ts` / `update-competition.ts` and the
 * underlying `Competition` Prisma model exactly (see the audit in
 * `docs/architecture/mcp/README.md`), and the application layer
 * (`import-competition.usecase.ts`) is the single place that reshapes it
 * into whichever of `CreateCompetitionInput` / `UpdateCompetitionInput` the
 * operation actually needs. A validation rule changing in one of those two
 * schemas is a prompt to check this one, not an automatic sync — the same
 * relationship `UpdateCompetitionSchema` already has with `create-competition.ts`.
 *
 * =============================================================================
 * Fields deliberately not included
 * =============================================================================
 *
 * - `registrationType` — present on the `Competition` model and in search
 *   filters, but not yet wired into `UpdateCompetitionSchema` or
 *   `CompetitionRepository.update`. Adding MCP support for a field the
 *   admin UI itself cannot write would make MCP a wider write surface than
 *   Kizunia's own console, so it is left out until that gap is closed
 *   web-side.
 * - Locations, categories, technologies, eligibilities, media assets — each
 *   already has its own attach/detach service and its own authorization
 *   action (`MANAGE_TECHNOLOGIES`, `MANAGE_ELIGIBILITY`, …) distinct from
 *   `EDIT`. Folding them into one giant import payload would blur that
 *   boundary; a second wave of MCP tools (`attach_technology`,
 *   `set_competition_location`, …) is the natural extension point instead.
 * - Any source/provenance field. The `Competition` model has none — see the
 *   audit — so `organizer`, `website` and `registrationLink` are the only
 *   places provenance can currently live, and only when the source really
 *   is the organizer's own site or registration page.
 */
export const CompetitionImportSchema = z.object({
  title: TitleSchema,

  /**
   * Optional on import, unlike `CreateCompetitionSchema`. When omitted,
   * `deriveSlug` in the application layer generates one from the title —
   * an agent extracting a competition from a web page has no natural slug
   * to offer and should not have to invent one that then has to be
   * unique.
   */
  slug: SlugSchema.optional(),

  shortDescription: ShortDescriptionSchema.optional(),

  organizer: OrganizerSchema.optional(),

  organizerType: z.nativeEnum(OrganizerType).optional(),

  /** The organizer's own site — also the only provenance Kizunia can record today. */
  website: UrlSchema.optional(),

  registrationLink: UrlSchema.optional(),

  registrationPlatform: z.nativeEnum(RegistrationPlatform).optional(),

  registrationFeeType: z.nativeEnum(RegistrationFeeType).optional(),

  registrationFee: z.string().trim().max(50).optional(),

  prizePool: z.string().trim().max(50).optional(),

  mode: z.nativeEnum(CompetitionMode).optional(),

  difficulty: z.nativeEnum(DifficultyLevel).optional(),

  certificateType: z.nativeEnum(CertificateType).optional(),

  minTeamSize: z.number().int().positive().optional(),

  maxTeamSize: z.number().int().positive().optional(),

  /**
   * ISO 8601 date-time strings, not `Date` — the value crosses a JSON-RPC
   * boundary, where a real `Date` cannot appear on the wire at all.
   * `z.coerce.date()` used by `UpdateCompetitionSchema` still applies to
   * whatever this parses to once the application layer hands it onward.
   */
  startDate: z.iso.datetime({ offset: true }).optional(),
  endDate: z.iso.datetime({ offset: true }).optional(),
  registrationStartDate: z.iso.datetime({ offset: true }).optional(),
  registrationDeadline: z.iso.datetime({ offset: true }).optional(),

  /** Full documentation body (Markdown/MDX, matching `ContentSchema`). */
  content: ContentSchema.optional(),
});

export type CompetitionImportInput = z.infer<typeof CompetitionImportSchema>;
