import type { Prisma } from "@/generated/prisma";
import type { TeamSizeValue } from "@/lib/search/client";

type CompetitionWhere = Prisma.CompetitionWhereInput;

/**
 * Builds the restriction for a team-size filter value.
 *
 * =============================================================================
 * Containment, not overlap
 * =============================================================================
 *
 * This asks an eligibility question — "can a team like mine actually enter
 * this competition" — not a looser "do our ranges share any number in
 * common". A participant's intent is an interval: every size from
 * `min ?? 1` (Exact and Range both set `min`; At most leaves it unset and
 * means "as few as 1") up to `max`. The competition can only be a match if
 * its own declared `[minTeamSize, maxTeamSize]` — `null` on either side
 * meaning "the organizer declared no limit there" — fully contains that
 * whole interval, not merely touches it:
 *
 *   competition's lower bound <= participant's lower bound
 *   competition's upper bound >= participant's upper bound
 *
 * A competition requiring a minimum of 3 cannot honestly be shown to someone
 * whose team might be 1 or 2, even though 3 falls inside a "1 to 5" request —
 * that request means the team could turn out to be any size in that range,
 * and the competition has to be able to take all of them, not just some.
 *
 * `max` is always present whenever this clause has anything to check —
 * Exact and Range both set it, and At most *is* the one-sided case, encoded
 * as `min` absent (floor of 1) with `max` set. There is no shape where only
 * `min` is set; that was "At least", which this filter no longer offers (see
 * `readTeamSize` in `spec-values.ts`, which strips a lone `min` before it
 * gets here).
 *
 * =============================================================================
 * Policy is a second, independent question
 * =============================================================================
 *
 * `policy` asks what the *competition* allows, not what the participant
 * brings, and is ANDed in alongside the size conditions rather than folded
 * into them — a person can ask for "a team of 4, at a competition that also
 * allows solo entry" in one filter, and the two conditions have to compose
 * rather than override each other.
 */
export function buildTeamSizeClause(value: TeamSizeValue): CompetitionWhere {
  const clauses: CompetitionWhere[] = [];

  if (value.max !== undefined) {
    // At most leaves `min` unset, meaning the team could be as small as 1 —
    // the competition must accept that floor, not just the stated ceiling.
    // Unlike the old overlap check, this is a real constraint even at 1: a
    // competition can declare `minTeamSize: 3`, which must fail here.
    const effectiveMin = value.min ?? 1;

    clauses.push({
      OR: [{ minTeamSize: null }, { minTeamSize: { lte: effectiveMin } }],
    });

    clauses.push({
      OR: [{ maxTeamSize: null }, { maxTeamSize: { gte: value.max } }],
    });
  }

  if (value.policy === "SOLO_ONLY") {
    // `lte` excludes NULL by SQL's own comparison rules, so this reads as "a
    // maximum is declared, and it is 1" without an explicit not-null clause.
    clauses.push({ maxTeamSize: { lte: 1 } });
  }

  if (value.policy === "SOLO_OR_TEAM") {
    clauses.push({
      OR: [{ minTeamSize: null }, { minTeamSize: { lte: 1 } }],
    });

    clauses.push({
      OR: [{ maxTeamSize: null }, { maxTeamSize: { gt: 1 } }],
    });
  }

  // At least one clause always exists: `TeamSizeControl` never emits a value
  // with every field unset — `normalizeOrUndefined` clears the filter instead.
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}
