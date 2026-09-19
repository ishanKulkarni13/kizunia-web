"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { LocationApi } from "@/modules/locations/api/location-api";
import type { PlaceSuggestion } from "@/modules/locations";

const SEARCH_DEBOUNCE_MS = 300;

const MIN_QUERY_LENGTH = 2;

/**
 * What the picker hands back: either a place to resolve server-side, or a
 * name typed by hand.
 *
 * The selected place is passed as an id rather than a hydrated object because
 * resolution is what produces the verified containment behind discovery, and
 * that has to happen on the server where the API key lives.
 */
export type PickedLocation =
  | { providerPlaceId: string }
  | { manualDisplayName: string };

/**
 * Search-and-select for places, with typed entry always available.
 *
 * Manual entry is not a failure path that appears when lookup breaks — it is
 * offered on every search. An admin who knows the place should never have to
 * wait for a lookup, and an outage should change nothing about how they work.
 */
export function LocationPicker({
  onSelect,
  disabled,
}: {
  onSelect(picked: PickedLocation): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState("");

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  const [searching, setSearching] = useState(false);

  const [providerAvailable, setProviderAvailable] = useState(true);

  /**
   * Groups this picker's keystrokes and the eventual details call into one
   * billed provider session. Regenerated per picker mount, which is the
   * granularity a session is meant to cover.
   */
  const sessionToken = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    // Ignores results from a superseded query, so a slow response cannot
    // overwrite the list for what the admin is typing now.
    let active = true;

    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const result = await LocationApi.autocomplete(trimmed, {
          sessionToken,
        });

        if (!active) return;

        setSuggestions(result.suggestions);

        setProviderAvailable(result.providerAvailable);
      } catch {
        // Lookup is an enhancement; failing it must not block the admin, who
        // can still type the place manually.
        if (!active) return;

        setSuggestions([]);

        setProviderAvailable(false);
      } finally {
        if (active) {
          setSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;

      clearTimeout(timer);
    };
  }, [query, sessionToken]);

  function select(picked: PickedLocation) {
    onSelect(picked);

    setOpen(false);

    setQuery("");

    setSuggestions([]);
  }

  const trimmedQuery = query.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className="w-full justify-start"
        >
          <Search className="mr-2 h-4 w-4" />
          Search for a location
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-[320px] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search a city, region, or venue…"
            value={query}
            onValueChange={setQuery}
          />

          <CommandList>
            {searching && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            )}

            {!searching && trimmedQuery.length < MIN_QUERY_LENGTH && (
              <CommandEmpty>
                Type at least {MIN_QUERY_LENGTH} characters to search.
              </CommandEmpty>
            )}

            {!searching && suggestions.length > 0 && (
              <CommandGroup heading="Places">
                {suggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion.providerPlaceId}
                    value={suggestion.providerPlaceId}
                    onSelect={() =>
                      select({ providerPlaceId: suggestion.providerPlaceId })
                    }
                  >
                    <MapPin className="mr-2 h-4 w-4 shrink-0" />

                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{suggestion.primaryText}</span>

                      {/* The secondary line is what separates two places that
                          share a name — without it the choice is a coin flip. */}
                      {suggestion.secondaryText && (
                        <span className="truncate text-xs text-muted-foreground">
                          {suggestion.secondaryText}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Offered on every search, not only on failure — the admin may
                simply know the place better than the provider does. */}
            {!searching && trimmedQuery.length >= MIN_QUERY_LENGTH && (
              <CommandGroup heading="Manual entry">
                <CommandItem
                  value={`manual:${trimmedQuery}`}
                  onSelect={() => select({ manualDisplayName: trimmedQuery })}
                >
                  <Check className="mr-2 h-4 w-4 shrink-0" />

                  <span className="flex-1 truncate">
                    Use &ldquo;{trimmedQuery}&rdquo; as typed
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            {!searching && !providerAvailable && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Place lookup is unavailable right now. You can still add any
                location manually — it just won&rsquo;t be discoverable through
                a wider region until lookup is working.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
