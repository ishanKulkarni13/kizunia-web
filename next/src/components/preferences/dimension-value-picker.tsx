"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TechnologyApi } from "@/modules/technologies/api/technology-api";
import { LocationApi } from "@/modules/locations/api/location-api";
import { DimensionCatalogApi } from "@/modules/preferences/api/dimension-catalog-api";
import type {
  DimensionDefinition,
  DimensionOption,
} from "@/modules/preferences/dimension-config";

export interface DimensionValueEntry {
  readonly value: string;
  readonly weight: number;
  /** Display only — never sent to the backend. */
  readonly label: string;
}

interface DimensionValuePickerProps {
  definition: DimensionDefinition;
  entries: DimensionValueEntry[];
  onChange: (entries: DimensionValueEntry[]) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

export function DimensionValuePicker({
  definition,
  entries,
  onChange,
}: DimensionValuePickerProps) {
  const { control } = definition;

  const [catalog, setCatalog] = useState<DimensionOption[]>(
    control.kind === "enum" ? [...control.options] : [],
  );
  const [catalogLoading, setCatalogLoading] = useState(
    control.kind === "categories" || control.kind === "technologies",
  );

  useEffect(() => {
    let cancelled = false;

    if (control.kind === "categories") {
      DimensionCatalogApi.categories()
        .then((options) => {
          if (!cancelled) {
            setCatalog(options.map((o) => ({ value: o.value, label: o.label })));
          }
        })
        .catch(() => {
          if (!cancelled) toast.error("Failed to load categories.");
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false);
        });
    } else if (control.kind === "technologies") {
      TechnologyApi.getCatalog()
        .then((items) => {
          if (!cancelled) {
            setCatalog(items.map((t) => ({ value: t.slug, label: t.name })));
          }
        })
        .catch(() => {
          if (!cancelled) toast.error("Failed to load technologies.");
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [control.kind]);

  const selectedValues = new Set(entries.map((e) => e.value));

  function addEntry(value: string, label: string) {
    if (!value || selectedValues.has(value)) return;
    onChange([...entries, { value, label, weight: 0.5 }]);
  }

  function removeEntry(value: string) {
    onChange(entries.filter((e) => e.value !== value));
  }

  function commitWeight(value: string, weight: number) {
    if (weight <= 0) {
      removeEntry(value);
      return;
    }
    onChange(
      entries.map((e) =>
        e.value === value ? { ...e, weight: Math.min(1, weight) } : e,
      ),
    );
  }

  const isCatalogControl =
    control.kind === "enum" ||
    control.kind === "categories" ||
    control.kind === "technologies";

  const availableOptions = isCatalogControl
    ? catalog.filter((o) => !selectedValues.has(o.value))
    : [];

  return (
    <div className="space-y-3">
      {isCatalogControl && (
        <Select
          value=""
          onValueChange={(value) => {
            const option = availableOptions.find((o) => o.value === value);
            if (option) addEntry(option.value, option.label);
          }}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue
              placeholder={
                catalogLoading
                  ? "Loading…"
                  : availableOptions.length === 0
                    ? "All values added"
                    : `Add a ${definition.label.toLowerCase()}…`
              }
            />
          </SelectTrigger>
          <SelectContent>
            {availableOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {control.kind === "location" && (
        <LocationValueAdd excluded={selectedValues} onAdd={addEntry} />
      )}

      {control.kind === "team-size" && (
        <TeamSizeValueAdd excluded={selectedValues} onAdd={addEntry} />
      )}

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No preference set.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry) => (
            <ValueRow
              key={`${entry.value}:${entry.weight}`}
              entry={entry}
              onWeightCommit={(weight) => commitWeight(entry.value, weight)}
              onRemove={() => removeEntry(entry.value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ValueRow({
  entry,
  onWeightCommit,
  onRemove,
}: {
  entry: DimensionValueEntry;
  onWeightCommit: (weight: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(entry.weight.toString());

  function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      setDraft(entry.weight.toString());
      toast.error("Weight must be between 0 and 1.");
      return;
    }
    onWeightCommit(parsed);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
      <span className="flex-1 truncate text-sm">{entry.label}</span>
      <Input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="w-20"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${entry.label}`}
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}

function LocationValueAdd({
  excluded,
  onAdd,
}: {
  excluded: Set<string>;
  onAdd: (value: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string; contextLabel: string | null }[]
  >([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    let active = true;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const areas = await LocationApi.searchAreas(trimmed, 10);
        if (active) setResults(areas);
      } catch {
        if (active) toast.error("Location search failed.");
      } finally {
        if (active) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-72 justify-start">
          Search for a location…
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-70 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search a city or place"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {searching && (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                Searching…
              </div>
            )}
            {!searching && query.trim().length < 2 && (
              <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <CommandEmpty>No matching locations.</CommandEmpty>
            )}
            {!searching && results.length > 0 && (
              <CommandGroup heading="Places">
                {results
                  .filter((area) => !excluded.has(area.id))
                  .map((area) => (
                    <CommandItem
                      key={area.id}
                      value={area.id}
                      onSelect={() => {
                        onAdd(
                          area.id,
                          area.contextLabel
                            ? `${area.displayName}, ${area.contextLabel}`
                            : area.displayName,
                        );
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {area.displayName}
                      {area.contextLabel && (
                        <span className="text-xs text-muted-foreground">
                          {area.contextLabel}
                        </span>
                      )}
                    </CommandItem>
                  ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const TEAM_SIZE_OPTIONS = ["1", "2", "3", "4", "5", "6", "8", "10"];

function TeamSizeValueAdd({
  excluded,
  onAdd,
}: {
  excluded: Set<string>;
  onAdd: (value: string, label: string) => void;
}) {
  const available = TEAM_SIZE_OPTIONS.filter((v) => !excluded.has(v));

  return (
    <Select
      value=""
      onValueChange={(value) =>
        onAdd(value, value === "1" ? "1 person" : `${value} people`)
      }
    >
      <SelectTrigger className="w-full sm:w-72">
        <SelectValue
          placeholder={
            available.length === 0 ? "All team sizes added" : "Add a team size…"
          }
        />
      </SelectTrigger>
      <SelectContent>
        {available.map((value) => (
          <SelectItem key={value} value={value}>
            {value === "1" ? "1 person" : `${value} people`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
