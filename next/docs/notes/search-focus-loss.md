# Known issue: the search box loses focus when the search fires

Status: **open, deliberately deferred.** Mitigated, not fixed.

## Symptom

On `/competitions`, type `sk` into the search box and wait for the debounce.
The search runs and the results update — which is correct and wanted — but the
caret leaves the input. Pressing `h` next does nothing: the character is not
registered anywhere, because nothing is focused any more.

The same applies to the search box inside the All filters sheet; it is the same
component.

## Cause

A disabled element cannot hold focus. The browser blurs it, and nothing puts
focus back when it is re-enabled.

The chain, all in the search core:

1. `src/modules/competitions/components/discovery/competition-filters.tsx`
   takes `isPending` from `useSearchParamsState` and passes it as
   `disabled={isPending}` to five children, `QuickFilterBar` among them.
2. `QuickFilterBar` forwards `disabled` to `FilterControl`, which forwards it
   to `TextControl`.
3. `TextControl` puts it straight on the `<input>`.
4. When the debounce fires, `apply` navigates inside `startTransition`, so
   `isPending` flips true for the length of the server round trip — and the
   input the person is typing into goes disabled mid-sentence.

So the greying-out that was meant to signal "working" is what eats the
keystroke.

This also runs against the grain of the machinery it uses. The whole point of
`startTransition` is that the old UI stays *interactive* while the next render
is in flight, and `isPending`'s own documentation in `use-search-params-state.ts`
says it is surfaced so the interface can *dim the results* rather than blank
them. Nothing dims results today; `isPending` is used only to disable controls.

## What is in place instead (the mitigation)

Two changes, neither of which fixes the bug:

- **`DEFAULT_DEBOUNCE_MS` is 2.5s**, up from 1s, so the interruption happens
  less often while someone is still typing.
- **The magnifier in the search box is a button**, so a finished query can be
  submitted on demand rather than waiting the timer out. It calls the same
  `flush` that Enter and blur already use.

Focus is still lost every single time the search actually fires. If you are
here because typing feels interrupted, that is this bug, not the debounce
value — raising the timer further only trades one annoyance for another.

## The real fix, in three parts

All three are needed together. Doing only the first regresses something else.

1. **Stop equating "results refreshing" with "controls disabled."** Remove
   `disabled={isPending}` from `competition-filters.tsx`. Keep feedback
   non-blocking — `aria-busy` on the wrapper, and eventually the results
   dimming that `isPending` was documented for in the first place.

2. **Make `apply` compose onto the search it last *requested*.** This is what
   the disabling was incidentally guarding. `apply` closes over `params`, which
   is the last *committed* URL, and quick-bar popovers apply per toggle
   (`filter-popover.tsx`). Tick Category, then tick Mode before the first
   navigation lands, and the second patch is built on a snapshot that has never
   heard of the first — silently dropping it. Today that is impossible only
   because the controls are dead during the window.

   Hold the requested search in a ref, reset it whenever `serialized` changes
   (a commit, the back button, an external navigation), and build each patch
   from that instead. Bonus: `apply` stops depending on `params`, so its
   identity is finally stable across renders.

3. **Stop the URL echo overwriting a newer draft.** `TextControl` re-syncs
   `draft` from `applied` whenever `applied` changes. Once typing during a
   pending navigation is possible, the commit of `search=sk` fires that effect
   and resets the draft to `"sk"` — deleting the `h` even if focus had been
   kept. Track the value last emitted and skip the re-sync when the incoming
   value is just that coming back.

   Comparing against `settled.trim()` is exact, not approximate:
   `writeFilterValue` trims a text value and `normalizeScalar` trims it again
   on the way back, so the round trip of `settled` is precisely `settled.trim()`,
   and an emptied box round-trips to `""` — which is what `applied` is when the
   parameter is absent. Genuine outside changes (a chip removed, Clear all, the
   back button) will not match, so they still adopt as they do now.

## If focus is still lost after that

The next suspect is Next's own post-navigation focus handling. It should not
apply here — `apply` already passes `scroll: false`, which skips the router's
scroll-and-focus routine — but that is where to look. Do not reach for
re-adding any disabling.

## Verifying a fix

There is no test runner in this repo and this is DOM behaviour, so this one is
checked by hand, on `/competitions`:

- Type `sk`, wait for the results to refresh, then type `h` without touching
  the mouse. The caret should still be in the box and the value should read
  `skh`. Repeat with the connection throttled in devtools, where the pending
  window is long enough to type several characters through.
- Tick a Category and immediately tick a Mode, before the first refresh lands.
  The URL must end up with **both**.
- With `search=sk` applied, remove the search chip / press Clear all / press
  the back button. The input must clear or revert rather than hold stale text.
