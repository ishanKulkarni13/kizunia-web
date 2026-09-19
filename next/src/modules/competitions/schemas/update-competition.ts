import { z } from "zod";

import {
  CertificateType,
  DifficultyLevel,
  CompetitionMode,
  CompetitionStatus,
  CompetitionVisibility,
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

export const UpdateCompetitionSchema = z
  .object({
    // ---------------------------------------------------------------------
    // Basic Information
    // ---------------------------------------------------------------------

    title: TitleSchema.optional(),
    slug: SlugSchema.optional(),
    shortDescription: ShortDescriptionSchema.nullable().optional(),
    organizer: OrganizerSchema.nullable().optional(),

    visibility: z.nativeEnum(CompetitionVisibility).optional(),

    // Nullable here even though the shared `ContentSchema` is not: `null`
    // means "clear documentation" (see `CompetitionRepository.update`), a
    // capability specific to competitions. `ContentSchema` is also used by
    // `UpdateProjectContentSchema`, where a project's documentation is
    // always required, so `.nullable()` is applied at this call site only.
    content: ContentSchema.nullable().optional(),

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    website: UrlSchema.nullable().optional(),
    // Locations are not part of this payload — they are managed through
    // /admin/competitions/[id]/locations, which owns their ordering and dates.
    registrationLink: UrlSchema.nullable().optional(),
    prizePool: z
      .string()
      .trim()
      .max(50, "Prize Pool cannot exceed 150 characters.")
      .nullable()
      .optional(),
    registrationPlatform: z
      .nativeEnum(RegistrationPlatform)
      .nullable()
      .optional(),
    registrationFeeType: z
      .nativeEnum(RegistrationFeeType)
      .nullable()
      .optional(),

    organizerType: z.nativeEnum(OrganizerType).nullable().optional(),

    difficulty: z.nativeEnum(DifficultyLevel).nullable().optional(),

    certificateType: z.nativeEnum(CertificateType).nullable().optional(),

    registrationFee: z
      .string()
      .trim()
      .max(50, "registrationFee cannot exceed 150 characters.")
      .nullable()
      .optional(),
    // ---------------------------------------------------------------------
    // Schedule
    // ---------------------------------------------------------------------

    startDate: z.coerce.date().nullable().optional(),

    endDate: z.coerce.date().nullable().optional(),

    registrationDeadline: z.coerce.date().nullable().optional(),

    registrationStartDate: z.coerce.date().nullable().optional(),

    // ---------------------------------------------------------------------
    // Lifecycle automation
    // ---------------------------------------------------------------------

    // Opt-out from automatic lifecycle management. Manual status changes
    // (the `status` field below) always remain allowed regardless of this
    // flag — it disables automation only, never explicit admin intent.
    automaticStatusUpdatesDisabled: z.boolean().optional(),

    // ---------------------------------------------------------------------
    // Team
    // ---------------------------------------------------------------------

    minTeamSize: z.coerce.number().int().positive().nullable().optional(),

    maxTeamSize: z.coerce.number().int().positive().nullable().optional(),

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------

    mode: z.nativeEnum(CompetitionMode).nullable().optional(),

    status: z.nativeEnum(CompetitionStatus).nullable().optional(),
  })

  // -------------------------------------------------------------------------
  // At least one field must be provided
  // -------------------------------------------------------------------------

  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  })

  // -------------------------------------------------------------------------
  // Cross-field validation
  // -------------------------------------------------------------------------

  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.startDate > data.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be after the start date.",
      });
    }

    // Deliberately NOT enforcing `registrationDeadline <= startDate` here.
    // A deadline after the start date is valid — it's what keeps a
    // competition that has already started in REGISTRATION_OPEN rather than
    // ONGOING (late registration). See the lifecycle resolver's precedence
    // rules in `src/modules/competitions/lifecycle/resolver.ts`.

    if (
      data.registrationStartDate &&
      data.registrationDeadline &&
      data.registrationStartDate > data.registrationDeadline
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationDeadline"],
        message: "Registration deadline must be after registration opens.",
      });
    }

    if (
      data.minTeamSize &&
      data.maxTeamSize &&
      data.minTeamSize > data.maxTeamSize
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTeamSize"],
        message:
          "Maximum team size must be greater than or equal to the minimum team size.",
      });
    }
  });

export type UpdateCompetitionInput = z.infer<typeof UpdateCompetitionSchema>;
