"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/http";
import { CompetitionPreferenceApi } from "@/modules/preferences/api/competition-preference-api";
import { DIMENSION_DEFINITIONS } from "@/modules/preferences/dimension-config";
import type { CompetitionPreferenceEntryDTO } from "@/modules/preferences/types/competition-preference.dto";
import type { DimensionId } from "@/modules/recommendations";
import {
  DimensionValuePicker,
  type DimensionValueEntry,
} from "./dimension-value-picker";

type PreferenceState = Record<DimensionId, DimensionValueEntry[]>;

function emptyState(): PreferenceState {
  return Object.fromEntries(
    DIMENSION_DEFINITIONS.map((d) => [d.id, []]),
  ) as unknown as PreferenceState;
}

function initialLabelFor(
  definition: (typeof DIMENSION_DEFINITIONS)[number],
  value: string,
): string {
  const { control } = definition;

  if (control.kind === "enum") {
    return control.options.find((o) => o.value === value)?.label ?? value;
  }

  if (control.kind === "team-size") {
    return value === "1" ? "1 person" : `${value} people`;
  }

  // categories/technologies: the picker resolves the real name once its
  // catalog loads; location has no id -> name lookup endpoint, so the raw
  // id is the best available label until the user re-selects it.
  return value;
}

function toState(entries: CompetitionPreferenceEntryDTO[]): PreferenceState {
  const state = emptyState();

  for (const entry of entries) {
    const definition = DIMENSION_DEFINITIONS.find(
      (d) => d.id === entry.dimension,
    );
    if (!definition) continue;

    state[entry.dimension] = [
      ...state[entry.dimension],
      {
        value: entry.value,
        weight: entry.weight,
        label: initialLabelFor(definition, entry.value),
      },
    ];
  }

  return state;
}

function cloneState(state: PreferenceState): PreferenceState {
  const clone = {} as PreferenceState;
  for (const key of Object.keys(state) as DimensionId[]) {
    clone[key] = state[key].map((e) => ({ ...e }));
  }
  return clone;
}

function flatten(state: PreferenceState): CompetitionPreferenceEntryDTO[] {
  const flat: CompetitionPreferenceEntryDTO[] = [];

  for (const dimension of Object.keys(state) as DimensionId[]) {
    for (const entry of state[dimension]) {
      // 0 means "no preference" — never persist an unset row.
      if (entry.weight <= 0) continue;
      flat.push({ dimension, value: entry.value, weight: entry.weight });
    }
  }

  return flat;
}

export function CompetitionPreferencesForm() {
  const [state, setState] = useState<PreferenceState>(emptyState);
  const [snapshot, setSnapshot] = useState<PreferenceState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    CompetitionPreferenceApi.list()
      .then((entries) => {
        if (cancelled) return;
        const loaded = toState(entries);
        setState(loaded);
        setSnapshot(cloneState(loaded));
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load competition preferences.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateDimension(dimension: DimensionId, entries: DimensionValueEntry[]) {
    setState((prev) => ({ ...prev, [dimension]: entries }));
    setDirty(true);
  }

  function handleReset() {
    setState(cloneState(snapshot));
    setDirty(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await CompetitionPreferenceApi.replace(flatten(state));
      const nextState = toState(saved);
      setState(nextState);
      setSnapshot(cloneState(nextState));
      setDirty(false);
      toast.success("Competition preferences saved.");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Failed to save.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Competition Preferences</CardTitle>
        <CardDescription>
          Tell Kizunia what kinds of competitions you care about. For each
          value: <strong>0</strong> means no preference (removes it),
          something between <strong>0 and 1</strong> is a soft preference,
          and <strong>1</strong> is a hard preference.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          DIMENSION_DEFINITIONS.map((definition, index) => (
            <div key={definition.id}>
              {index > 0 && <Separator className="mb-6" />}
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-medium">{definition.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {definition.description}
                  </p>
                </div>
                <DimensionValuePicker
                  definition={definition}
                  entries={state[definition.id]}
                  onChange={(entries) =>
                    updateDimension(definition.id, entries)
                  }
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
      {!loading && (
        <CardFooter className="justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || saving}
            onClick={handleReset}
          >
            Reset
          </Button>
          <LoadingButton
            type="button"
            loading={saving}
            disabled={!dirty}
            onClick={handleSave}
          >
            Save changes
          </LoadingButton>
        </CardFooter>
      )}
    </Card>
  );
}
