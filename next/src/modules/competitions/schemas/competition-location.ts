import { z } from "zod";

import { LocationInputSchema } from "@/modules/locations";

const LabelSchema = z
  .string()
  .trim()
  .max(100, "Label cannot exceed 100 characters.");

const VenueNameSchema = z
  .string()
  .trim()
  .max(200, "Venue name cannot exceed 200 characters.");

const AddressSchema = z
  .string()
  .trim()
  .max(500, "Address cannot exceed 500 characters.");

/**
 * Location-specific dates are optional in both directions — a qualifier may
 * have exact dates while the final is still unannounced — but a pair that is
 * present must be ordered.
 */
function refineDateRange(
  data: {
    startDate?: Date | null;
    endDate?: Date | null;
  },
  ctx: z.RefinementCtx,
) {
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date must be after the start date.",
    });
  }
}

/**
 * Exactly one of `providerPlaceId` and `location` must be present.
 *
 * Modelled as two optional fields plus a check rather than a discriminated
 * union, so a request supplying both — or neither — gets one clear message
 * instead of two parallel branch failures.
 */
function refineSource(
  data: {
    providerPlaceId?: string;
    location?: unknown;
  },
  ctx: z.RefinementCtx,
) {
  const hasPlace = Boolean(data.providerPlaceId);

  const hasManual = data.location !== undefined;

  if (hasPlace === hasManual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerPlaceId"],
      message: hasPlace
        ? "Provide either a selected place or a manual location, not both."
        : "Either a selected place or a manual location is required.",
    });
  }
}

export const CreateCompetitionLocationSchema = z
  .object({
    /**
     * A place chosen from provider autocomplete. The server resolves it,
     * which is what yields the verified containment behind discovery.
     */
    providerPlaceId: z.string().trim().min(1).max(300).optional(),

    /**
     * Manual entry, used when no provider is configured or the place cannot be
     * found. Saves normally but yields only its own search area — with no
     * provider evidence there is no verified containment, and inventing one is
     * exactly what this architecture forbids.
     */
    location: LocationInputSchema.optional(),

    label: LabelSchema.nullable().optional(),

    venueName: VenueNameSchema.nullable().optional(),

    address: AddressSchema.nullable().optional(),

    startDate: z.coerce.date().nullable().optional(),

    endDate: z.coerce.date().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    refineSource(data, ctx);
    refineDateRange(data, ctx);
  });

export type CreateCompetitionLocationInput = z.infer<
  typeof CreateCompetitionLocationSchema
>;

export const UpdateCompetitionLocationSchema = z
  .object({
    /**
     * Replaces the underlying place. Because locations are private to a single
     * competition, this rewrites the existing row rather than repointing at a
     * shared one — and re-derives its search areas, so a location moved from
     * Pune to Mumbai stops being discoverable through Pune.
     */
    providerPlaceId: z.string().trim().min(1).max(300).optional(),

    location: LocationInputSchema.optional(),

    label: LabelSchema.nullable().optional(),

    venueName: VenueNameSchema.nullable().optional(),

    address: AddressSchema.nullable().optional(),

    startDate: z.coerce.date().nullable().optional(),

    endDate: z.coerce.date().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided.",
  })
  .superRefine(refineDateRange);

export type UpdateCompetitionLocationInput = z.infer<
  typeof UpdateCompetitionLocationSchema
>;

/**
 * Full reordering by identity: position in the array becomes `order`.
 *
 * Sending the whole list rather than individual positions keeps the result
 * deterministic — there is no intermediate state where two locations share an
 * order or a gap appears mid-list.
 */
export const ReorderCompetitionLocationsSchema = z.object({
  ids: z
    .array(z.string().trim().min(1))
    .min(1, "At least one location id must be provided."),
});

export type ReorderCompetitionLocationsInput = z.infer<
  typeof ReorderCompetitionLocationsSchema
>;
