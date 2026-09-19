"use client";

/**
 * Search Core (React) - Place selection
 *
 * =============================================================================
 * Why the provider decides what is selectable
 * =============================================================================
 *
 * Suggestions come from the provider, not from places the platform already
 * stores. Offering only stored places would mean a person could not search for
 * a town until something had already been recorded there — and the answer
 * "nothing here yet" would be indistinguishable from "you may not ask".
 *
 * Choosing a place that turns out to have nothing is a legitimate, honest
 * search that returns nothing. That distinction is preserved all the way down
 * to the query, and it starts here.
 *
 * =============================================================================
 * The endpoint contract
 * =============================================================================
 *
 * Any entity using a `place` filter must serve `spec.suggestEndpoint` with:
 *
 *   GET ?q=<query>  →  { data: { suggestions: PlaceSuggestionResponse[],
 *                                providerAvailable: boolean } }
 *
 * `providerAvailable: false` means "suggest nothing", not "error". A lookup
 * service being down must never break browsing — the rest of the filters keep
 * working and the person simply cannot pick a new place this minute.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CheckIcon, LocateFixedIcon, MapPinIcon, XIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Imported by direct path rather than through `@/modules/locations`. The barrel
// re-exports repositories and services, which pull the generated Prisma client
// into whatever imports them — and this is a client component. `radius.ts` is
// pure and has no such dependencies.
import { roundDeviceCoordinate } from "@/modules/locations/utils/radius";

import type { PlaceSpec } from "../../spec";
import type { FilterControlProps } from "./types";

/** One suggestion, as the endpoint returns it. */
interface PlaceSuggestionResponse {
  readonly providerPlaceId: string;
  readonly primaryText: string;
  readonly secondaryText: string | null;
}

/**
 * Matches the server-side minimum. One character matches most of the world and
 * costs a billed lookup to say so.
 */
const MIN_QUERY_LENGTH = 2;

/** Groups a run of keystrokes into roughly one request. */
const SEARCH_DEBOUNCE_MS = 1000;

/**
 * What the browser last told us about where the user is.
 *
 * Four outcomes rather than a boolean, because each needs different words. A
 * refusal is not a failure, a timeout is worth retrying, and an insecure or
 * unsupported context is not something the user can fix by pressing the button
 * again.
 */
type LocatingState = "idle" | "locating" | "denied" | "timeout" | "unavailable";

const LOCATING_MESSAGE: Readonly<Record<LocatingState, string | null>> = {
  idle: null,
  locating: null,
  denied:
    "Location access is blocked. Allow it in your browser settings, or search for a place instead.",
  timeout: "That took too long. Try again, or search for a place instead.",
  unavailable:
    "We can't get your location on this device. Search for a place instead.",
};

export function PlaceControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<PlaceSpec>) {
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState<LocatingState>("idle");
  const [suggestions, setSuggestions] = useState<PlaceSuggestionResponse[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerAvailable, setProviderAvailable] = useState(true);

  /**
   * Absent for entities that have not enabled radius search, which is what
   * gates both the distance slider and the "use my current location" action.
   */
  const radiusConfig = spec.radius;

  /**
   * Discards responses that arrive out of order.
   *
   * Without this, a slow request for "pu" landing after a fast one for "pune"
   * would replace the correct suggestions with stale ones — a bug that appears
   * only on a poor connection, which is exactly when it is hardest to notice
   * in development.
   */
  const requestId = useRef(0);

  /**
   * Bumped on Enter to skip the debounce for that one lookup — pressing Enter
   * is a statement that the query is finished, the same reasoning the text
   * search box uses for its own flush. Read once per effect run and reset
   * immediately, so it affects only the lookup it was raised for.
   */
  const [flushNonce, setFlushNonce] = useState(0);
  const pendingFlush = useRef(false);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const id = ++requestId.current;
    const controller = new AbortController();

    setSearching(true);

    const delay = pendingFlush.current ? 0 : SEARCH_DEBOUNCE_MS;
    pendingFlush.current = false;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${spec.suggestEndpoint}?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Suggest request failed: ${response.status}`);
        }

        const body: {
          data?: {
            suggestions?: PlaceSuggestionResponse[];
            providerAvailable?: boolean;
          };
        } = await response.json();

        if (id !== requestId.current) {
          return;
        }

        setSuggestions(body.data?.suggestions ?? []);
        setProviderAvailable(body.data?.providerAvailable ?? true);
      } catch {
        if (controller.signal.aborted || id !== requestId.current) {
          return;
        }

        // A failed lookup degrades to "no suggestions". It must not surface as
        // an error: the person can still use every other filter, and an error
        // banner would imply the page is broken when only one control is.
        setSuggestions([]);
        setProviderAvailable(false);
      } finally {
        if (id === requestId.current) {
          setSearching(false);
        }
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `flushNonce` is intentionally included even though its value is never
    // read here: bumping it is how Enter re-runs this effect against an
    // unchanged query to force an immediate, undebounced lookup.
  }, [query, spec.suggestEndpoint, flushNonce]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pendingFlush.current = true;
      setFlushNonce((nonce) => nonce + 1);
    }
  };

  const select = (suggestion: PlaceSuggestionResponse) => {
    onChange({
      center: {
        kind: "place",
        id: suggestion.providerPlaceId,
        label: suggestion.primaryText,
      },
      // Both carried over rather than reset: a person who asked to include
      // online results, or to search within 25 km, and then changed city still
      // wants both.
      includeOnline: value?.includeOnline ?? false,
      ...(value?.radiusKm !== undefined && { radiusKm: value.radiusKm }),
    });

    setQuery("");
    setSuggestions([]);
  };

  const setIncludeOnline = (includeOnline: boolean) => {
    // Meaningless without a centre, and the value layer would drop it anyway.
    if (!value) {
      return;
    }

    onChange({ ...value, includeOnline });
  };

  /**
   * Sets or clears the distance.
   *
   * Writes a plain number and nothing else. Range checking, clamping and
   * rejection all live in the decoder, because this control is only one of
   * several writers — a preset, a hand-edited URL, a shared link and the API
   * reach the same value without passing through here. Duplicating the rules
   * would mean maintaining them twice and having them disagree once.
   */
  const setRadiusKm = (radiusKm: number | undefined) => {
    if (!value) {
      return;
    }

    // A device centre has no meaning without a distance — "here" is not a
    // filter — so clearing the radius clears the whole thing rather than
    // leaving a centre the decoder would silently drop.
    if (radiusKm === undefined && value.center.kind === "device") {
      onChange(undefined);
      return;
    }

    if (radiusKm === undefined) {
      // Rebuilt field by field rather than spread-and-delete, so the absence of
      // a radius is explicit in the value that goes out.
      onChange({
        center: value.center,
        includeOnline: value.includeOnline,
      });
      return;
    }

    onChange({ ...value, radiusKm });
  };

  /**
   * Asks the browser where the user is.
   *
   * The coordinates are used directly as a search centre and nothing else: they
   * are not reverse geocoded into a place, not given an identity, and never
   * persisted. They live for exactly as long as the URL that carries them.
   */
  const useCurrentLocation = () => {
    if (!radiusConfig) {
      return;
    }

    // Geolocation is a secure-context API. Without this check the callback
    // simply never fires on plain HTTP and the button looks broken.
    if (
      typeof navigator === "undefined" ||
      !navigator.geolocation ||
      !window.isSecureContext
    ) {
      setLocating("unavailable");
      return;
    }

    setLocating("locating");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating("idle");

        onChange({
          center: {
            kind: "device",
            // Rounded here, where the value is written, rather than on read —
            // rounding on read would silently alter a coordinate someone typed.
            // ~11 m: finer than the smallest radius offered, and coarse enough
            // that a shared link does not carry someone's doorstep.
            latitude: roundDeviceCoordinate(position.coords.latitude),
            longitude: roundDeviceCoordinate(position.coords.longitude),
          },
          includeOnline: value?.includeOnline ?? false,
          // A device centre is meaningless without one, so a distance is always
          // supplied — the spec's default when the user has not chosen.
          radiusKm: value?.radiusKm ?? radiusConfig.defaultKm,
        });

        setQuery("");
        setSuggestions([]);
      },
      (error) => {
        // Distinguished rather than collapsed into one message: "you said no"
        // and "we could not tell" call for different next steps from the user.
        setLocating(
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  /**
   * Where the slider thumb sits.
   *
   * Index 0 means "no radius"; the steps follow. A value that is in range but
   * off-step — which a hand-edited or shared URL may legitimately carry, since
   * the steps are an affordance rather than a contract — snaps the thumb to the
   * nearest step while the readout above keeps showing the real number. The
   * control never rewrites a value the user did not touch.
   */
  const radiusSliderIndex = useMemo(() => {
    if (!radiusConfig || value?.radiusKm === undefined) {
      return 0;
    }

    const radiusKm = value.radiusKm;

    let closest = 0;

    radiusConfig.steps.forEach((step, index) => {
      const best = radiusConfig.steps[closest];

      if (Math.abs(step - radiusKm) < Math.abs(best - radiusKm)) {
        closest = index;
      }
    });

    return closest + 1;
  }, [radiusConfig, value?.radiusKm]);

  const selectedLabel = useMemo(() => {
    if (!value) {
      return undefined;
    }

    // Never the raw coordinates: they are unreadable, and they are not what the
    // person asked for — they asked to search near themselves.
    return value.center.kind === "device"
      ? "Near me"
      : (value.center.label ?? "Selected place");
  }, [value]);

  return (
    <div className="space-y-3">
      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <MapPinIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />

          <span className="flex-1 truncate text-sm font-medium">
            {selectedLabel}
          </span>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(undefined)}
            aria-label="Clear location"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <MapPinIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />

          <Input
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={spec.placeholder ?? "Search for a place"}
            aria-label={spec.label}
            className="pl-9 pr-9"
          />

          {searching && (
            <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      )}

      {/* Fixed height, not `max-h-*` — see the note in
          relation-multi-control.tsx for why the two don't behave the same
          with Radix's ScrollArea. */}
      {!value && suggestions.length > 0 && (
        <ScrollArea className="h-56 rounded-md border">
          <ul>
            {suggestions.map((suggestion) => (
              <li key={suggestion.providerPlaceId}>
                <button
                  type="button"
                  onClick={() => select(suggestion)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                    "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  )}
                >
                  <CheckIcon
                    className="mt-0.5 size-3.5 shrink-0 opacity-0"
                    aria-hidden
                  />

                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {suggestion.primaryText}
                    </span>

                    {suggestion.secondaryText && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {suggestion.secondaryText}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}

      {!value &&
        !providerAvailable &&
        query.trim().length >= MIN_QUERY_LENGTH && (
          <p className="text-xs text-muted-foreground">
            Location search is unavailable right now. Every other filter still
            works.
          </p>
        )}

      {/* Offered only where radius search is enabled: a device position is
          nothing but a centre to measure from, so without a radius there would
          be no question for it to answer. */}
      {!value && radiusConfig && (
        <div>
          <button
            type="button"
            disabled={disabled || locating === "locating"}
            onClick={useCurrentLocation}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {locating === "locating" ? (
              <Spinner className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <LocateFixedIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}

            <span className="flex-1">
              {locating === "locating"
                ? "Finding your location…"
                : "Use my current location"}
            </span>
          </button>

          {LOCATING_MESSAGE[locating] && (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              {LOCATING_MESSAGE[locating]}
            </p>
          )}
        </div>
      )}

      {/* Hidden until a centre exists, following the same rule the online
          switch already uses: a radius with nothing to centre it on cannot be
          expressed, and the decoder would drop it anyway. */}
      {value && radiusConfig && (
        <>
          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm font-normal">Search radius</Label>

              <span className="text-sm font-medium tabular-nums">
                {value.radiusKm === undefined
                  ? "Exact place"
                  : `${value.radiusKm} km`}
              </span>
            </div>

            <Slider
              value={[radiusSliderIndex]}
              min={0}
              max={radiusConfig.steps.length}
              step={1}
              disabled={disabled}
              aria-label="Search radius in kilometres"
              onValueChange={([next]) => {
                // Index 0 is "no radius" rather than the smallest one, so the
                // control can express today's exact-place behaviour and is not
                // a one-way door into distance matching.
                setRadiusKm(
                  next === 0 ? undefined : radiusConfig.steps[next - 1],
                );
              }}
            />

            <p className="text-xs text-muted-foreground">
              {value.radiusKm === undefined
                ? "Matches competitions recorded in this place."
                : value.center.kind === "device"
                  ? `Matches competitions within ${value.radiusKm} km of you.`
                  : `Matches competitions within ${value.radiusKm} km, by distance rather than by which place they are listed under.`}
            </p>
          </div>
        </>
      )}

      {value && (
        <>
          <Separator />

          <div className="flex items-start justify-between gap-3">
            <Label
              htmlFor={`${spec.key}-include-online`}
              className="cursor-pointer text-sm font-normal"
            >
              {spec.includeOnlineLabel}

              <span className="mt-0.5 block text-xs text-muted-foreground">
                Online competitions have no location, so they are excluded
                unless you ask for them.
              </span>
            </Label>

            <Switch
              id={`${spec.key}-include-online`}
              checked={value.includeOnline}
              disabled={disabled}
              onCheckedChange={setIncludeOnline}
            />
          </div>
        </>
      )}
    </div>
  );
}
