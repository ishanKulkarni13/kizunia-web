/**
 * Search Core - Client entry point
 *
 * =============================================================================
 * The boundary
 * =============================================================================
 *
 * This is the only module in `src/lib/search` that a `"use client"` component
 * may import. Everything re-exported here is pure, isomorphic and provably
 * free of any database or server-only dependency — no Prisma type, no Prisma
 * value, no Node built-in, no environment access.
 *
 * The server entry point (`./index`) re-exports these same modules *plus* the
 * query-building half: the engine, the clause composer, the filter factories
 * and the scope machinery. Those are harmless to import in principle, but a
 * component that reaches for them is almost always about to do something on
 * the client that belongs on the server, and the split makes that visible in
 * review rather than discoverable at runtime.
 *
 * =============================================================================
 * How to use it
 * =============================================================================
 *
 *   client component  →  import { ... } from "@/lib/search/client"
 *   server code       →  import { ... } from "@/lib/search"
 *
 * An entity's filter specs (`search/ui.ts`) must also be client-safe and
 * import only from here. Its registry (`search/definition.ts`) is server-only
 * and imports from `@/lib/search`.
 *
 * If something needed on the client lives only behind the server entry point,
 * the fix is to move it down into a client-safe module and re-export it here —
 * never to import the server barrel from a client component.
 */

// -----------------------------------------------------------------------------
// What a filter is
// -----------------------------------------------------------------------------

export type {
  AnyFilterValue,
  BooleanSpec,
  DateRangePreset,
  DateRangeSpec,
  DateRangeValue,
  EnumMultiSpec,
  FilterGroup,
  FilterKind,
  FilterOption,
  FilterSpec,
  NumberBoundSpec,
  PlaceRadiusConfig,
  PlaceSpec,
  PlaceValue,
  RelationMultiSpec,
  TeamEntryFormat,
  TeamSizePolicy,
  TeamSizeSpec,
  TeamSizeValue,
  TextAnySpec,
  TextSpec,
  ValueOfSpec,
  FilterValueOf,
} from "./spec";

export {
  allFilterParams,
  assertUniqueFilterParams,
  DuplicateFilterParamError,
  filterParams,
  optionLabel,
  usesOptionSearch,
  usesPillDisplay,
} from "./spec";

// -----------------------------------------------------------------------------
// Reading and writing filter values
// -----------------------------------------------------------------------------

export type { ChipContext, FilterChip } from "./spec-values";

export {
  activeFilterCount,
  clearAllFiltersPatch,
  clearFilterPatch,
  describeAllChips,
  describeFilterChips,
  isFilterActive,
  readFilterValue,
  writeFilterValue,
} from "./spec-values";

// -----------------------------------------------------------------------------
// URL parameters
// -----------------------------------------------------------------------------

export type { ApplyPatchOptions, ParamPatch } from "./params";

export {
  applyParamPatch,
  buildSearchHref,
  isSameSearch,
  LIMIT_PARAM,
  PAGE_PARAM,
  pageHref,
  pagePatch,
  PRESET_PARAM,
  readSortToken,
  RESERVED_PARAMS,
  SORT_PARAM,
  sortPatch,
  toQueryString,
} from "./params";

// -----------------------------------------------------------------------------
// Presets
// -----------------------------------------------------------------------------

export type {
  ActivePreset,
  AppliablePreset,
  CustomPreset,
  PlatformPreset,
  PresetCatalog,
  PresetFilters,
  PresetIcon,
  PresetIdentity,
  PresetKind,
} from "./presets";

export {
  activatePresetPatch,
  applyPresetPatch,
  capturePresetFilters,
  deactivatePresetPatch,
  hasCapturableFilters,
  NO_ACTIVE_PRESET,
  parsePresetToken,
  presetFilter,
  presetFilters,
  presetToken,
  readPresetIdentity,
  resolveActivePreset,
  sanitizePresetFilters,
  visiblePlatformPresets,
} from "./presets";

export type {
  CreateCustomPresetInput,
  CustomPresetStore,
} from "./preset-storage";

export {
  createCustomPresetStore,
  CUSTOM_PRESET_SCHEMA_VERSION,
  MAX_CUSTOM_PRESETS,
  PRESET_NAME_MAX_LENGTH,
} from "./preset-storage";

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------

export type {
  FilterLayoutOverride,
  FilterLayoutSource,
  ResolvedFilter,
  ResolvedFilterLayout,
} from "./layout";

export { resolveFilterLayout, userLayoutSource } from "./layout";

// -----------------------------------------------------------------------------
// Shared shapes
// -----------------------------------------------------------------------------

export type {
  PaginationInput,
  PaginationMeta,
  RawSearchParams,
  SearchResult,
} from "./types";

/**
 * Sorting, as the UI sees it.
 *
 * `SortOption` carries an entity's `orderBy` shape, which for a Prisma entity
 * is a Prisma type — so the generic type itself is exported, but an entity
 * must expose its own concrete sort *options* to the client as plain
 * `{ key, label }` data rather than passing the registry across the boundary.
 */
export type { SortOptionSummary } from "./sort";

export { toSortOptionSummaries } from "./sort";
