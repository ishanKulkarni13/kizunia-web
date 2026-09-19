"use client";

/**
 * Search Core (React) - Free-text controls
 *
 * Two related controls: a single search box, and a token field for filters
 * that accept several independent substrings.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownLeftIcon, SearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";

import type { TextAnySpec, TextSpec } from "../../spec";
import { useDebouncedValue, DEFAULT_DEBOUNCE_MS } from "../use-debounced-value";
import type { FilterControlProps } from "./types";

/**
 * The search box.
 *
 * =============================================================================
 * Four ways to say "search this"
 * =============================================================================
 *
 * Typing debounces, because each emission is a navigation and a server render,
 * and one request per character would make the results list thrash under the
 * reader. Enter, the magnifier button and blur bypass the timer entirely: all
 * three are unambiguous statements that the query is finished, and waiting out
 * a delay the person cannot see would read as the page being slow rather than
 * as it being careful.
 *
 * The button exists because the timer is long — see `DEFAULT_DEBOUNCE_MS`, and
 * `docs/notes/search-focus-loss.md` for why it is long. Enter already served
 * anyone typing; the magnifier serves anyone who has reached for the mouse,
 * and neither should have to wait 2.5 seconds for a query they have finished.
 *
 * All four paths converge on one emission point, so no combination of them can
 * produce two searches for one intent — pressing Enter while a debounce is
 * pending cancels the timer rather than racing it.
 */
export function TextControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<TextSpec>) {
  const applied = value ?? "";

  const [draft, setDraft] = useState(applied);

  const { value: settled, flush } = useDebouncedValue(
    draft,
    DEFAULT_DEBOUNCE_MS,
  );

  // Tracks `applied` outside of state so the emission effect below can read
  // its current value without depending on it. Depending on it directly would
  // re-fire that effect whenever `applied` changes from *outside* — a chip
  // removed, a Clear all, the back button — even though `settled` has not
  // caught up to the new draft yet, and the effect would then re-send the
  // just-cleared, now-stale `settled` value straight back into the URL.
  const appliedRef = useRef(applied);

  // Re-sync when the applied value changes from outside — a chip removed, a
  // Clear all, or the back button. Without this the input would keep showing
  // text that is no longer filtering anything.
  useEffect(() => {
    appliedRef.current = applied;
    setDraft(applied);
  }, [applied]);

  // The single emission point. Every path — timer, Enter, blur, the clear
  // button — reaches the search through this one effect, which is what keeps
  // them from each firing a navigation of their own.
  //
  // Deliberately keyed on `settled` alone. `applied` is read through a ref
  // instead of a dependency, so an external change to it (see above) cannot
  // by itself re-run this effect against an as-yet-unrefreshed `settled`.
  useEffect(() => {
    if (settled === appliedRef.current) {
      return;
    }

    onChange(settled.trim().length > 0 ? settled : undefined);
    // `onChange` is intentionally excluded: it is recreated on every render by
    // callers that close over the current params, and depending on it would
    // re-run this continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Not a form submission — there is no form. Prevented so a wrapping
      // dialog or sheet does not interpret it as a confirm.
      event.preventDefault();
      flush();
      return;
    }

    // Escape abandons the edit and restores what is actually applied, which is
    // the only way back if someone types over a query they wanted to keep.
    if (event.key === "Escape") {
      setDraft(applied);
    }
  };

  const isDirty = draft !== applied;

  return (
    <InputGroup className="h-9">
      <InputGroupAddon align="inline-start">
        {/* A button rather than decoration: Enter is the fast path for
            someone whose hands are on the keyboard, and this is the same
            thing for someone whose hand is on the mouse. It reaches the
            search through `flush`, exactly as Enter and blur do, so there is
            still one emission point and no combination can double-fire.

            Not disabled while the draft matches what is applied — clicking
            then is a no-op the emission effect already absorbs, and a button
            that greys itself out on a condition the person cannot see is
            worse than one that occasionally does nothing. */}
        <button
          type="button"
          disabled={disabled}
          // Keeps the caret where it was: without this the mousedown blurs
          // the input first, which would flush through the blur handler
          // instead and leave the person's place lost for no reason.
          onMouseDown={(event) => event.preventDefault()}
          onClick={flush}
          aria-label={`Search ${spec.label.toLowerCase()}`}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <SearchIcon className="size-4" aria-hidden />
        </button>
      </InputGroupAddon>

      <InputGroupInput
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        // Leaving the field is a statement that the query is finished, so it
        // searches immediately rather than waiting out the timer.
        onBlur={flush}
        placeholder={spec.placeholder ?? spec.label}
        aria-label={spec.label}
      />

      <InputGroupAddon align="inline-end">
        {/* Shown only while a keystroke is still pending, so the hint appears
            exactly when it is actionable and never as permanent decoration. */}
        {isDirty && !disabled && (
          <Kbd className="hidden sm:inline-flex" aria-hidden>
            <CornerDownLeftIcon className="size-3" />
          </Kbd>
        )}

        {draft.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft("");
              flush();
            }}
            aria-label={`Clear ${spec.label.toLowerCase()}`}
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * Several free-text values, each matched as a substring and OR-ed together.
 *
 * Entered as tokens rather than as one comma-separated string, because the
 * comma is the encoding, not the interface. Making the person type the
 * separator would expose a serialisation detail and would make "Acme, Inc"
 * impossible to express deliberately.
 */
export function TextAnyControl({
  spec,
  value,
  onChange,
  disabled,
}: FilterControlProps<TextAnySpec>) {
  const [draft, setDraft] = useState("");

  const tokens = value ?? [];

  const commit = () => {
    const trimmed = draft.trim();

    // Silently ignoring a duplicate is right: the person's intent is already
    // satisfied, and an error for asking twice would be pedantic.
    if (trimmed.length === 0 || tokens.includes(trimmed)) {
      setDraft("");
      return;
    }

    onChange([...tokens, trimmed]);
    setDraft("");
  };

  const remove = (token: string) => {
    const next = tokens.filter((entry) => entry !== token);

    onChange(next.length > 0 ? next : undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      return;
    }

    // Backspace on an empty field removes the last token — the convention
    // every tag input follows, and the fastest way to undo a mistake.
    if (event.key === "Backspace" && draft.length === 0 && tokens.length > 0) {
      remove(tokens[tokens.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={spec.placeholder ?? `Add ${spec.label.toLowerCase()}`}
        aria-label={spec.label}
      />

      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tokens.map((token) => (
            <Badge key={token} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-40 truncate">{token}</span>

              <button
                type="button"
                onClick={() => remove(token)}
                aria-label={`Remove ${token}`}
                className="rounded-sm p-0.5 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
