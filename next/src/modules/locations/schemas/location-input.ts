import { z } from "zod";

import { LocationPrecision, LocationProvider } from "@/generated/prisma";

/**
 * Everything an admin may supply when attaching a place to a competition.
 *
 * `displayName` is the only required field. That is deliberate: during a
 * provider outage an admin must still be able to type "Pune" and move on, so
 * the minimum valid location is a single readable string.
 */
const LocationFieldsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Location name must be at least 2 characters.")
    .max(200, "Location name cannot exceed 200 characters."),

  precision: z.nativeEnum(LocationPrecision).optional(),

  country: z
    .string()
    .trim()
    .max(100, "Country cannot exceed 100 characters.")
    .nullable()
    .optional(),

  countryCode: z
    .string()
    .trim()
    .length(2, "Country code must be a 2-letter ISO code.")
    .regex(/^[A-Za-z]{2}$/, "Country code must be a 2-letter ISO code.")
    .nullable()
    .optional(),

  state: z
    .string()
    .trim()
    .max(100, "State cannot exceed 100 characters.")
    .nullable()
    .optional(),

  stateCode: z
    .string()
    .trim()
    .max(10, "State code cannot exceed 10 characters.")
    .nullable()
    .optional(),

  city: z
    .string()
    .trim()
    .max(100, "City cannot exceed 100 characters.")
    .nullable()
    .optional(),

  postalCode: z
    .string()
    .trim()
    .max(20, "Postal code cannot exceed 20 characters.")
    .nullable()
    .optional(),

  latitude: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90.")
    .nullable()
    .optional(),

  longitude: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180.")
    .nullable()
    .optional(),

  timezone: z
    .string()
    .trim()
    .max(64, "Timezone cannot exceed 64 characters.")
    .nullable()
    .optional(),

  provider: z.nativeEnum(LocationProvider).optional(),

  providerLocationId: z
    .string()
    .trim()
    .max(200, "Provider location id cannot exceed 200 characters.")
    .nullable()
    .optional(),
});

/**
 * A half-set coordinate is worse than none — it silently breaks any future
 * proximity search — so the pair is validated together.
 */
export const LocationInputSchema = LocationFieldsSchema.superRefine(
  (data, ctx) => {
    const hasLatitude = data.latitude !== null && data.latitude !== undefined;

    const hasLongitude = data.longitude !== null && data.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasLatitude ? "longitude" : "latitude"],
        message: "Latitude and longitude must be provided together.",
      });
    }
  },
);

export type LocationInput = z.infer<typeof LocationInputSchema>;
