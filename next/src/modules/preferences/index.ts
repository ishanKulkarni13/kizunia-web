/**
 * Preferences module — public API. Import from this file, not from
 * `backend/`, outside this module.
 *
 * `backend/` (repositories, services, controllers) is NOT re-exported here.
 * It imports `@/lib/prisma` and `next/server` transitively, and this
 * barrel must stay safe to import from a client component. Server-side
 * consumers (the API routes) deep-import
 * `@/modules/preferences/backend/...` directly — the same convention
 * `modules/recommendations`'s own barrel establishes.
 */

export {
  UpdateNotificationPreferenceSchema,
  type UpdateNotificationPreferenceInput,
} from "./schemas/notification-preference";
export type { NotificationPreferenceDTO } from "./types/notification-preference.dto";

export {
  CompetitionPreferenceEntrySchema,
  UpdateCompetitionPreferencesSchema,
  type UpdateCompetitionPreferencesInput,
} from "./schemas/competition-preference";
export type { CompetitionPreferenceEntryDTO } from "./types/competition-preference.dto";
