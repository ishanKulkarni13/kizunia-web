/**
 * The signed-in actor's own state for one competition: whether they have
 * bookmarked it, and whether they have marked themselves as registered.
 *
 * The two flags are independent by construction — see
 * `CompetitionBookmark` and `CompetitionRegistration` in the Prisma schema.
 * `registered` is a self-declared, unverified claim; it is never populated
 * from anything the organizer confirmed.
 */
export interface CompetitionUserStateDTO {
  competitionId: string;
  bookmarked: boolean;
  registered: boolean;
}
