"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, MapPin, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/http";
import { CompetitionLocationApi } from "@/modules/competitions/api/competition-location-api";
import { useCompetitionEditorStore } from "@/modules/competitions/store/editor-store";
import type { CompetitionLocationDTO } from "@/modules/competitions/types/competition-location.dto";
import { LocationPicker, type PickedLocation } from "./location-picker";
import { BufferedTextInput } from "./buffered-text-input";
import { DateTimePicker } from "./datetime-picker";
import { TabCompletenessFooter } from "./tab-completeness-footer";
import { useScrollToFocusedField } from "./use-scroll-to-focused-field";

export function LocationsTab() {
  useScrollToFocusedField();

  const competition = useCompetitionEditorStore((state) => state.competition);

  const setLocations = useCompetitionEditorStore((state) => state.setLocations);

  const [busy, setBusy] = useState(false);

  if (!competition) {
    return null;
  }

  const locations = competition.locations;

  /**
   * Every mutation returns the full server-ordered list, so the store is
   * replaced wholesale rather than patched — the client never has to guess how
   * the server assigned `order`.
   */
  async function run(
    action: () => Promise<CompetitionLocationDTO[]>,
    successMessage: string,
  ) {
    try {
      setBusy(true);

      setLocations(await action());

      toast.success(successMessage);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Unexpected error");
      }
    } finally {
      setBusy(false);
    }
  }

  function add(picked: PickedLocation) {
    // A picked place is sent as an id for the server to resolve; a typed name
    // goes straight through as a manual location.
    const body =
      "providerPlaceId" in picked
        ? { providerPlaceId: picked.providerPlaceId }
        : { location: { displayName: picked.manualDisplayName } };

    void run(
      () => CompetitionLocationApi.add(competition!.id, body),
      "Location added.",
    );
  }

  function remove(competitionLocationId: string) {
    void run(
      () => CompetitionLocationApi.remove(competition!.id, competitionLocationId),
      "Location removed.",
    );
  }

  function patch(
    competitionLocationId: string,
    body: Parameters<typeof CompetitionLocationApi.update>[2],
  ) {
    void run(
      () =>
        CompetitionLocationApi.update(
          competition!.id,
          competitionLocationId,
          body,
        ),
      "Location updated.",
    );
  }

  /**
   * Moves one location and sends the resulting order of the whole list, which
   * is what the reorder endpoint requires — a partial list would leave the
   * others at stale positions.
   */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;

    if (target < 0 || target >= locations.length) {
      return;
    }

    const ids = locations.map((location) => location.id);

    [ids[index], ids[target]] = [ids[target], ids[index]];

    void run(
      () => CompetitionLocationApi.reorder(competition!.id, { ids }),
      "Locations reordered.",
    );
  }

  return (
    <div id="field-locations" className="grid gap-6 pt-6">
      <div className="space-y-2">
        <Label>Add a location</Label>

        <LocationPicker onSelect={add} disabled={busy} />

        <p className="text-xs text-muted-foreground">
          A competition can have any number of locations — or none, if the venue
          has not been announced. Whether it runs online or in person is set by
          Mode, not here.
        </p>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-2 h-6 w-6" />
          No locations yet.
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map((competitionLocation, index) => (
            <div
              key={competitionLocation.id}
              className="space-y-4 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {competitionLocation.location.displayName}
                  </p>

                  <p className="text-xs text-muted-foreground">
                    {competitionLocation.location.precision.toLowerCase()}
                    {competitionLocation.location.provider === "MANUAL"
                      ? " · entered manually"
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label="Move location up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy || index === locations.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label="Move location down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    onClick={() => remove(competitionLocation.id)}
                    aria-label="Remove location"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`label-${competitionLocation.id}`}>
                    Label
                  </Label>

                  <BufferedTextInput
                    id={`label-${competitionLocation.id}`}
                    value={competitionLocation.label ?? ""}
                    placeholder="Qualifier, Final, Opening Ceremony…"
                    disabled={busy}
                    onCommit={(label) =>
                      patch(competitionLocation.id, { label })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`venue-${competitionLocation.id}`}>
                    Venue
                  </Label>

                  <BufferedTextInput
                    id={`venue-${competitionLocation.id}`}
                    value={competitionLocation.venueName ?? ""}
                    placeholder="MIT-WPU Auditorium"
                    disabled={busy}
                    onCommit={(venueName) =>
                      patch(competitionLocation.id, { venueName })
                    }
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`address-${competitionLocation.id}`}>
                    Address
                  </Label>

                  <BufferedTextInput
                    id={`address-${competitionLocation.id}`}
                    value={competitionLocation.address ?? ""}
                    placeholder="Kothrud Campus, Survey No. 124"
                    disabled={busy}
                    onCommit={(address) =>
                      patch(competitionLocation.id, { address })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`start-${competitionLocation.id}`}>
                    Starts
                  </Label>

                  <DateTimePicker
                    id={`start-${competitionLocation.id}`}
                    value={competitionLocation.startDate}
                    disabled={busy}
                    onCommit={(startDate) =>
                      patch(competitionLocation.id, { startDate })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`end-${competitionLocation.id}`}>Ends</Label>

                  <DateTimePicker
                    id={`end-${competitionLocation.id}`}
                    value={competitionLocation.endDate}
                    disabled={busy}
                    onCommit={(endDate) =>
                      patch(competitionLocation.id, { endDate })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TabCompletenessFooter tab="locations" />
    </div>
  );
}
