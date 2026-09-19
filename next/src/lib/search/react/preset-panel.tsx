"use client";

/**
 * Search Core (React) - Presets, inside the filter panel
 *
 * =============================================================================
 * Why presets live here and not on the page
 * =============================================================================
 *
 * A row of preset pills above the search box asked people to understand a
 * concept before they had a reason to care about one. It sat between the page
 * title and the search field — the two things every visitor is actually looking
 * for — and it explained nothing about what a "preset" was, what pressing one
 * would do to the filters they had already set, or where the saved ones came
 * from.
 *
 * Presets are shortcuts *for filters*, so they belong where the filters are.
 * Inside the panel they arrive in the order the question is actually asked:
 *
 *   1. Presets           — "start me somewhere sensible"
 *   2. Current filters   — "here is what you have, and where it came from"
 *   3. Every filter      — "change any of it"
 *
 * Someone who never opens the panel is not missing a feature they were told
 * about; someone who does opens it and finds all three explained in sequence.
 *
 * =============================================================================
 * Immediate, inside a surface that stages
 * =============================================================================
 *
 * The panel around this stages its edits behind Apply. Presets do not: a preset
 * is a whole search, not an adjustment to one, and staging it would leave the
 * controls below showing a preset's filters that nothing had applied yet. So a
 * preset applies at once and the panel closes behind it, exactly like Clear
 * all — and the section says so, because a surface with two different commit
 * rules has to admit it.
 *
 * Saving runs the other way: it commits whatever *is* staged, so "save these
 * filters" saves the filters the person can see. See `useSearchPresets`.
 */

import { useMemo, useState } from "react";
import {
  BookmarkIcon,
  CheckIcon,
  CompassIcon,
  GlobeIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { applyParamPatch, type ParamPatch } from "../params";
import type { CustomPresetStore } from "../preset-storage";
import type {
  ActivePreset,
  CustomPreset,
  PlatformPreset,
  PresetIcon,
} from "../presets";
import type { FilterSpec } from "../spec";
import { describeAllChips, type ChipContext } from "../spec-values";
import type { RawSearchParams } from "../types";
import { PresetNameDialog } from "./preset-name-dialog";
import { useSearchPresets } from "./use-search-presets";
import type { ApplySearchOptions } from "./use-search-params-state";

/**
 * Icon names resolved to components in exactly one place.
 *
 * A preset carries a name rather than a component so its definition stays plain
 * data — serialisable, storable, and portable to an admin-managed list later.
 * This map is the presentation half of that trade.
 */
const PRESET_ICONS: Record<PresetIcon, LucideIcon> = {
  sparkles: SparklesIcon,
  globe: GlobeIcon,
  "map-pin": MapPinIcon,
  bookmark: BookmarkIcon,
  compass: CompassIcon,
  star: StarIcon,
};

export interface PresetPanelProps {
  /** Every registered filter: what a preset clears, and what it may set. */
  readonly specs: readonly FilterSpec[];

  /** The applied search. Staged edits arrive separately, in `pendingPatch`. */
  readonly params: RawSearchParams;

  /**
   * The full navigation seam, not the one-argument `onApply` the filter
   * controls take. Presets need to say how a change should affect history and
   * pagination — deleting a preset must not move the reader off their page.
   */
  readonly onApply: (patch: ParamPatch, options?: ApplySearchOptions) => void;

  readonly platformPresets: readonly PlatformPreset[];

  readonly store: CustomPresetStore;

  /** Edits staged in the surrounding surface and not yet applied. */
  readonly pendingPatch?: ParamPatch;

  /** Labels for relation options, so a summary reads "Web3", not "web3". */
  readonly chipContext?: ChipContext;

  readonly disabled?: boolean;

  /**
   * A preset was applied, replacing the whole search.
   *
   * The surrounding surface is staged and modal; leaving it open over results
   * it no longer describes, holding a buffer of edits the preset just
   * discarded, would be worse than closing it.
   */
  readonly onApplied?: () => void;

  /**
   * A preset was saved, committing any staged edits along with it.
   *
   * Deliberately *not* the same signal as above. The surface stays open so the
   * new preset can be seen arriving in "My saved presets" — which is the only
   * confirmation that says where it went — and closing here would mean
   * unmounting the save dialog in the middle of its own close.
   */
  readonly onSaved?: () => void;

  readonly className?: string;
}

export function PresetPanel({
  specs,
  params,
  onApply,
  platformPresets,
  store,
  pendingPatch,
  chipContext,
  disabled,
  onApplied,
  onSaved,
  className,
}: PresetPanelProps) {
  const hasPending =
    pendingPatch !== undefined && Object.keys(pendingPatch).length > 0;

  // What the person can see, which is what "these filters" has to mean. The
  // applied search plus whatever is staged in the controls below.
  const viewParams = useMemo(
    () => (hasPending ? applyParamPatch(params, pendingPatch) : params),
    [hasPending, params, pendingPatch],
  );

  const presets = useSearchPresets({
    specs,
    params: viewParams,
    apply: onApply,
    platformPresets,
    store,
    pendingPatch,
  });

  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<CustomPreset | undefined>();
  const [deleting, setDeleting] = useState<CustomPreset | undefined>();

  const chips = useMemo(
    () => describeAllChips(specs, viewParams, chipContext),
    [specs, viewParams, chipContext],
  );

  const summary = useMemo(() => summarise(chips), [chips]);

  const applyPreset = (run: () => void) => {
    run();
    onApplied?.();
  };

  const handleSave = (name: string): boolean => {
    const preset = presets.saveCurrentSearch(name);

    if (!preset) {
      return false;
    }

    toast.success("Preset saved", {
      description: `“${preset.name}” is now under your saved presets.`,
    });

    onSaved?.();

    return true;
  };

  return (
    <div className={cn("space-y-6", className)}>
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Presets</h3>

          <p className="text-xs leading-relaxed text-muted-foreground">
            A preset applies a group of filters in one go. Picking one replaces
            the filters you have now and shows the results straight away.
          </p>
        </div>

        {presets.platformPresets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.platformPresets.map((preset) => (
              <PlatformPresetPill
                key={preset.id}
                preset={preset}
                active={isActive(presets.active, "platform", preset.id)}
                disabled={disabled}
                onSelect={() =>
                  applyPreset(() => presets.applyPlatformPreset(preset))
                }
              />
            ))}
          </div>
        )}

        <div className="space-y-2 pt-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            My saved presets
          </h4>

          {presets.customPresets.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              You haven’t saved any presets yet. Choose the filters you want,
              then save them here to reuse the same combination later.
            </p>
          ) : (
            <ul className="space-y-1">
              {presets.customPresets.map((preset) => (
                <li key={preset.id}>
                  <SavedPresetRow
                    preset={preset}
                    active={isActive(presets.active, "custom", preset.id)}
                    disabled={disabled}
                    onSelect={() =>
                      applyPreset(() => presets.applyCustomPreset(preset))
                    }
                    onRename={() => setRenaming(preset)}
                    onDelete={() => setDeleting(preset)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Current filters</h3>

        {chips.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No filters chosen yet. Pick some below and they will show up here.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              // Deliberately not removable. Every other control in this panel
              // waits for Apply, and a chip that cleared a filter the instant
              // it was pressed would be the one thing in here that did not.
              // Removing a value is the control below, or the chip bar on the
              // page itself.
              <span
                key={chip.id}
                className="inline-flex max-w-full items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium"
              >
                <span className="truncate">{chip.label}</span>
              </span>
            ))}
          </div>
        )}

        {/*
          Provenance, spelled out. The preset stays highlighted after someone
          adds a filter of their own, and without a sentence saying why, a
          highlighted "Online and Free" next to a Category chip looks like a
          bug rather than the feature it is.
        */}
        {presets.active.kind !== "none" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Based on{" "}
            <span className="font-medium text-foreground">
              {presets.active.preset.name}
            </span>
            . Anything you change stays on top of it.
          </p>
        )}

        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !presets.canSaveCurrentSearch}
            onClick={() => setSaving(true)}
            className="w-full justify-start gap-1.5"
          >
            <PlusIcon className="size-3.5" aria-hidden />
            Save these filters as a preset
          </Button>

          {/*
            Disabled with the reason next to it rather than hidden. Someone who
            never sees the control never learns that saving exists, and the
            sentence doubles as an instruction for how to make it work.
          */}
          {!presets.canSaveCurrentSearch && (
            <p className="text-xs text-muted-foreground">
              Choose at least one filter first — there is nothing to save yet.
            </p>
          )}
        </div>
      </section>

      <PresetNameDialog
        open={saving}
        onOpenChange={setSaving}
        title="Save preset"
        description="Give your preset a name so you can find these filters again later. Saved presets stay in this browser."
        submitLabel="Save preset"
        details={<PresetFilterSummary rows={summary} />}
        onSubmit={handleSave}
      />

      <PresetNameDialog
        open={renaming !== undefined}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        title="Rename preset"
        description="Only the name changes. The filters this preset applies stay exactly as they are."
        submitLabel="Save name"
        initialName={renaming?.name}
        onSubmit={(name) =>
          renaming ? presets.renameCustomPreset(renaming.id, name) : false
        }
      />

      <AlertDialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>

            <AlertDialogDescription>
              The preset is removed from this browser. The filters you have
              applied right now stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>

            <AlertDialogAction
              onClick={() => {
                if (deleting) {
                  presets.deleteCustomPreset(deleting.id);
                }

                setDeleting(undefined);
              }}
            >
              Delete preset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Whether this exact preset — by kind and id, never by name — is active. */
function isActive(
  active: ActivePreset,
  kind: "platform" | "custom",
  id: string,
): boolean {
  return active.kind === kind && active.preset.id === id;
}

// =============================================================================
// Summarising what is about to be saved
// =============================================================================

interface SummaryRow {
  readonly label: string;

  readonly values: readonly string[];
}

/**
 * Groups the active chips by the filter they belong to.
 *
 * Built from `describeAllChips`, so the dialog names filters and values exactly
 * as the rest of the interface does — "Category", "Artificial Intelligence" —
 * and can never show a URL parameter, a slug or a stored id. There is no second
 * vocabulary to keep in step.
 */
function summarise(
  chips: readonly { filterLabel: string; label: string }[],
): readonly SummaryRow[] {
  const grouped = new Map<string, string[]>();

  for (const chip of chips) {
    const existing = grouped.get(chip.filterLabel);

    if (existing) {
      existing.push(chip.label);
      continue;
    }

    grouped.set(chip.filterLabel, [chip.label]);
  }

  return [...grouped.entries()].map(([label, values]) => ({ label, values }));
}

function PresetFilterSummary({ rows }: { rows: readonly SummaryRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border bg-muted/40 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        These filters will be saved
      </p>

      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 text-sm"
          >
            <dt className="shrink-0 text-muted-foreground">{row.label}</dt>

            <dd className="min-w-0 text-right font-medium">
              {row.values.join(", ")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// =============================================================================
// Pills and rows
// =============================================================================

const pillClasses =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const activeClasses = "border-primary bg-primary/10 text-foreground";

const inactiveClasses =
  "border-border bg-background hover:border-foreground/25 hover:bg-muted";

/**
 * A preset Kizunia maintains.
 *
 * No management affordance of any kind: platform presets cannot be renamed,
 * deleted or reordered, and offering a menu that only ever contained "Apply"
 * would imply otherwise.
 */
function PlatformPresetPill({
  preset,
  active,
  disabled,
  onSelect,
}: {
  preset: PlatformPreset;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const Icon = preset.icon ? PRESET_ICONS[preset.icon] : undefined;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      // Announced as a toggle rather than a link: it describes the state of the
      // current search, and a screen reader user needs to know which one they
      // are in as much as a sighted one does.
      aria-pressed={active}
      title={preset.description}
      className={cn(pillClasses, active ? activeClasses : inactiveClasses)}
    >
      {active ? (
        <CheckIcon className="size-3.5 shrink-0" aria-hidden />
      ) : (
        Icon && <Icon className="size-3.5 shrink-0" aria-hidden />
      )}

      <span className="truncate">{preset.name}</span>
    </button>
  );
}

/**
 * A preset the viewer saved.
 *
 * A full-width row rather than a pill, because this list grows: fifty pills
 * wrap into an unreadable block, fifty rows are a list you scan. Applying and
 * managing are siblings inside it, never nested — a button inside a button is
 * invalid HTML and behaves unpredictably under assistive technology.
 */
function SavedPresetRow({
  preset,
  active,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: {
  preset: CustomPreset;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-md border transition-colors",
        active
          ? activeClasses
          : "border-transparent hover:border-border hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2.5 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {active ? (
          <CheckIcon className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <BookmarkIcon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}

        <span className="truncate">{preset.name}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Manage ${preset.name}`}
            className="rounded-r-md px-2 py-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MoreHorizontalIcon className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <PencilIcon aria-hidden />
            Rename
          </DropdownMenuItem>

          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
