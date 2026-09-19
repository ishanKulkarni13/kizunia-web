/**
 * Projects - Filter layout (CLIENT-SAFE)
 *
 * The specs in `./ui.ts` declare where each filter sits by default. This
 * module is the layer above them: a product-level decision about what the
 * Project discovery experience should lead with. See
 * `src/modules/competitions/search/layout.ts` for the fuller rationale —
 * this is the same pattern, with one scope, since Projects has no admin or
 * management discovery surface yet.
 */

import {
  resolveFilterLayout,
  type FilterLayoutSource,
  type RawSearchParams,
  type ResolvedFilterLayout,
} from "@/lib/search/client";

import { PROJECT_FILTER_SPECS } from "./ui";

/**
 * The order the quick bar leads with: what a browser decides on first —
 * what it's about, and what it's built with.
 */
const QUICK_BAR_ORDER: readonly string[] = [
  "search",
  "categories",
  "technologies",
];

export const KIZUNIA_PROJECT_LAYOUT: FilterLayoutSource = {
  id: "kizunia-default",
  pinned: QUICK_BAR_ORDER,
};

/**
 * Resolves the layout for one render.
 *
 * @param extraSources further layers, highest precedence last. The seam
 *        user preferences will arrive through, mirroring Competitions.
 */
export function resolveProjectFilterLayout(
  params: RawSearchParams,
  extraSources: readonly FilterLayoutSource[] = [],
): ResolvedFilterLayout {
  return resolveFilterLayout(PROJECT_FILTER_SPECS, params, [
    KIZUNIA_PROJECT_LAYOUT,
    ...extraSources,
  ]);
}
