/**
 * Search Core (React) - Entry point
 *
 * Entity-agnostic filter interface, built entirely on `FilterSpec`. Nothing
 * here mentions Competitions, Projects or Blogs, and nothing here imports the
 * server half of the search core — every module reaches for
 * `@/lib/search/client` rather than `@/lib/search`.
 *
 * A module adopting search renders these components against its own spec list.
 * The only entity-specific code it needs is the specs themselves, the option
 * data for any relation filters, and whatever page composition it wants.
 */

export { useSearchParamsState } from "./use-search-params-state";
export type {
  ApplySearchOptions,
  HistoryMode,
  SearchParamsState,
} from "./use-search-params-state";

export { useDebouncedValue, DEFAULT_DEBOUNCE_MS } from "./use-debounced-value";
export type { DebouncedValue } from "./use-debounced-value";

export { useStagedParams } from "./use-staged-params";
export type { StagedParamsState } from "./use-staged-params";

export { useSearchPresets } from "./use-search-presets";
export type {
  SearchPresetsState,
  UseSearchPresetsOptions,
} from "./use-search-presets";

export { PresetPanel } from "./preset-panel";
export type { PresetPanelProps } from "./preset-panel";

export { PresetNameDialog } from "./preset-name-dialog";
export type { PresetNameDialogProps } from "./preset-name-dialog";

export { FilterControl } from "./controls";
export type { FilterControlProps } from "./controls/types";

export { FilterPopover } from "./filter-popover";
export { QuickFilterBar } from "./quick-filter-bar";
export { AdvancedFilterPanel } from "./advanced-filter-panel";
export { FilterSheet } from "./filter-sheet";
export type { FilterSheetProps, FilterSheetPresets } from "./filter-sheet";
export { ActiveFilterChips } from "./active-filter-chips";
export { ClearAllFiltersButton } from "./clear-all-filters-button";
export type { ClearAllFiltersButtonProps } from "./clear-all-filters-button";
export { SortSelect } from "./sort-select";
export { SearchPagination } from "./search-pagination";

export type { FilterCountsMap, FilterOptionsMap } from "./types";
