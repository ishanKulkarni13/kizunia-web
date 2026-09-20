/**
 * Recommendation Engine — Profile Normalization (PURE)
 *
 * Turns a flat `PreferenceEntry[]` into a `NormalizedProfile`: one
 * `DimensionPreference` per dimension the user actually expressed something
 * about, with hard-constraint dominance already resolved.
 *
 * Every later stage (eligibility, dimension matching, scoring) reads a
 * `DimensionPreference`, never raw entries — this is the one place the
 * weight-0/soft/hard rules and hard-dominance rule are encoded.
 */
import type {
  DimensionId,
  DimensionPreference,
  NormalizedProfile,
  PreferenceEntry,
  PreferenceProfile,
} from "./types";

/**
 * Normalizes a preference profile.
 *
 * Rules applied, in order:
 * - Weight `0` entries are dropped. Weight `0` and "no entry at all" are the
 *   same thing — indifference, never dislike.
 * - Weights outside `[0, 1]` are clamped; the engine does not trust callers
 *   (including the internal tuning route) to have validated this upstream.
 * - **Hard-constraint dominance**: if any surviving entry in a dimension has
 *   weight `1`, that dimension becomes hard and every non-1 value in it is
 *   discarded — only the weight-1 values are acceptable.
 * - `userStrength` is the max weight among the values that survive the rule
 *   above (so it is always `1` for a hard dimension, and the strongest soft
 *   weight otherwise).
 */
export function normalizeProfile(entries: PreferenceProfile): NormalizedProfile {
  const byDimension = new Map<DimensionId, Map<string, number>>();

  for (const entry of entries) {
    const weight = clampWeight(entry.weight);
    if (weight <= 0) continue;

    const values = byDimension.get(entry.dimension) ?? new Map<string, number>();
    // A later duplicate value in the same dimension wins — last one in wins,
    // matching "entries are a set of facts", not an append log.
    values.set(entry.value, weight);
    byDimension.set(entry.dimension, values);
  }

  const normalized = new Map<DimensionId, DimensionPreference>();

  for (const [dimension, values] of byDimension) {
    const hasHardValue = [...values.values()].some((w) => w >= 1);

    const survivingValues = hasHardValue
      ? new Map([...values].filter(([, w]) => w >= 1).map(([v]) => [v, 1]))
      : values;

    const userStrength = Math.max(...survivingValues.values());

    normalized.set(dimension, {
      dimension,
      hard: hasHardValue,
      values: survivingValues,
      userStrength,
    });
  }

  return normalized;
}

function clampWeight(weight: number): number {
  if (Number.isNaN(weight)) return 0;
  if (weight < 0) return 0;
  if (weight > 1) return 1;
  return weight;
}

/** Convenience used by tests and the eligibility stage. */
export function hardDimensions(
  profile: NormalizedProfile,
): readonly DimensionPreference[] {
  return [...profile.values()].filter((p) => p.hard);
}

export type { DimensionPreference, PreferenceEntry };
