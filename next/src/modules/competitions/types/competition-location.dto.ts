import type { LocationDTO } from "@/modules/locations";

/**
 * One location as used by one competition.
 *
 * Dates are ISO strings to match the rest of the competition edit surface,
 * which serializes dates for the editor store.
 */
export interface CompetitionLocationDTO {
  id: string;

  /**
   * Free-form context for this stop — "Qualifier", "Final", "Opening Ceremony".
   * Display only; nothing in the platform branches on its value.
   */
  label: string | null;

  venueName: string | null;

  address: string | null;

  /** Dates for this location specifically, which may sit inside the
   * competition's overall window rather than matching it. */
  startDate: string | null;

  endDate: string | null;

  order: number;

  location: LocationDTO;
}

/**
 * Compact form for cards and lists, where only the place name matters.
 */
export interface CompetitionLocationSummaryDTO {
  id: string;

  label: string | null;

  displayName: string;
}
