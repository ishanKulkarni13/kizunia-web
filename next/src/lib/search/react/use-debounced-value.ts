"use client";

/**
 * Search Core (React) - Debounced value with an escape hatch
 *
 * =============================================================================
 * Why debouncing alone is not enough
 * =============================================================================
 *
 * A plain debounce is the right default for typing: it turns a burst of
 * keystrokes into one navigation instead of one per character, and each
 * navigation here is a server round trip.
 *
 * It is the wrong behaviour for the two gestures that mean "I am done". A
 * person who presses Enter, or who clicks away from the field, has finished
 * their thought — making them wait out a timer they cannot see reads as lag,
 * and is worst precisely when they typed slowly and deliberately.
 *
 * So the delay is a guess about intent, and `flush` is what to do when intent
 * has been stated outright.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Deliberately slack — do not tune this down without reading
 * `docs/notes/search-focus-loss.md` first.
 *
 * A shorter delay would normally be better: the value only has to be long
 * enough to group a run of typing. It is 2.5s because every emission currently
 * costs the person their cursor — the navigation it triggers disables the input
 * mid-sentence, and a disabled element cannot hold focus — so each timer that
 * fires while someone is still thinking interrupts them. Firing less often is
 * a workaround for that, not a judgement about typing speed.
 *
 * The fast paths are `flush`: Enter, the search button, and leaving the field.
 * Nobody has to wait this out to search, which is what makes the slack
 * affordable in the first place.
 */
export const DEFAULT_DEBOUNCE_MS = 2500;

export interface DebouncedValue<T> {
  /** Trails `value` by `delay`, or matches it exactly after a `flush`. */
  readonly value: T;

  /**
   * Adopts the latest value now, cancelling any pending timer.
   *
   * Idempotent and safe to call when nothing is pending, so a blur handler
   * does not have to work out whether a keystroke is still in flight.
   */
  readonly flush: () => void;
}

/**
 * Trails a rapidly-changing value, with a way to catch up on demand.
 *
 * @param value the live value, typically a controlled input's draft
 * @param delay milliseconds of quiet before the value is adopted
 */
export function useDebouncedValue<T>(
  value: T,
  delay: number = DEFAULT_DEBOUNCE_MS,
): DebouncedValue<T> {
  const [debounced, setDebounced] = useState(value);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Held in a ref so `flush` can read the current value without being
  // recreated on every keystroke — a changing identity would restart the
  // effects of any component that depends on it.
  //
  // Written in the effect rather than during render: a render-phase ref write
  // is unsafe under concurrent rendering, where a render may be discarded.
  // Effects run before any event handler can fire, so `flush` still sees the
  // value the user is looking at.
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;

    timer.current = setTimeout(() => setDebounced(value), delay);

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [value, delay]);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    setDebounced(latest.current);
  }, []);

  return { value: debounced, flush };
}
