# Frontend Architecture

Reusable across Competitions, Projects, Blogs and any future listing. Like
the backend core, nothing here contains the word `Competition`.

---

## 1. The governing rule

> The canonical applied search state lives in the URL. Client state holds
> only *pending, unapplied* edits.

This satisfies shareability, bookmarking, back/forward, refresh persistence,
deep linking and server rendering in one decision, and — more importantly —
prevents a second source of truth that silently drifts from the URL.

```text
Filter UI (client)
    │  pending edits held locally
    ▼  on commit
router.push(new URLSearchParams)
    ▼
Server Component re-renders with new searchParams
    ▼
derived Zod schema → buildSearchQuery() → service → results
```

No URL-state library is required. `useSearchParams` and `useRouter` from
`next/navigation` are sufficient, and both are already used elsewhere in the
codebase. `nuqs` was considered and **deferred, not rejected**: it earns its
place once several modules need per-field typed URL state, which is a Phase
3 question, not a Phase 1 one. Adopting it now would mean introducing a
dependency to solve a problem we have exactly one instance of.

---

## 2. The URL-state hook

One generic hook, parameterised by a registry — not one hook per module.

```ts
// src/components/search/use-search-params-state.ts
export function useSearchParamsState(filters: readonly FilterUiDescriptor[]): {
  /** Current raw value of one filter parameter. */
  get: (key: string) => string | undefined;
  /** Commit one filter. `undefined` removes it. Resets page to 1. */
  set: (key: string, value: string | undefined) => void;
  /** Commit several at once — one navigation, not N. */
  setMany: (patch: Record<string, string | undefined>) => void;
  /** Remove every registry-known key. Preserves nothing but the pathname. */
  clearAll: () => void;
  /** Build an href preserving current state with a patch applied. */
  buildHref: (patch: Record<string, string | undefined>) => string;
  /** Filters currently active, decoded, for chip rendering. */
  active: ActiveFilter[];
};
```

Three behaviours worth stating explicitly because they are easy to get
wrong and expensive to retrofit:

- **Any filter change resets `page` to 1.** Landing on page 7 of a
  freshly-narrowed result set is a bug users report as "search is broken."
- **`clearAll` removes only registry-known keys.** It cannot strand unknown
  parameters, and because the filter UI is the only writer of these keys,
  no invalid parameters can survive a reset (requirement §11 of the brief).
- **`buildHref` is the only way pagination links are constructed**, which
  fixes limitation 5 permanently rather than per-page.

---

## 3. Generic controls

One component per *filter kind*, not per filter. The Quick Filters bar and
Advanced panel become loops:

```tsx
{quickFilters.map((filter) => (
  <FilterControl key={filter.key} filter={filter} />
))}
```

`FilterControl` dispatches on `filter.kind` to:

| Kind | Control |
| --- | --- |
| `enum-multi` | multi-select popover with checkboxes |
| `relation-slug-multi` | searchable multi-select (many categories/technologies) |
| `relation-id-multi` | searchable multi-select with async options |
| `text` | debounced input |
| `number-range` | two bounded numeric inputs |
| `date-range` | date-range picker |
| `boolean` | toggle chip |

Adding a filter to any module means adding a registry entry. It requires a
new component only when a genuinely new *kind* of interaction appears —
which is rare, and when it happens it is written once for every module.

All controls are built on the existing Radix/shadcn primitives already in
the project. Before building the Advanced panel, confirm which drawer
primitive the codebase has settled on (`vaul` is a dependency, and shadcn
Sheet/Dialog are present) rather than introducing a fourth pattern.

---

## 4. Apply vs. instant

Not one global policy — a per-*kind* policy, so it stays a property of the
core rather than fifteen special cases:

| Kind | Commit behaviour | Rationale |
| --- | --- | --- |
| `boolean`, single-tap chips | Instant | Cheap, frequent, expected to feel immediate |
| `enum-multi`, `relation-*-multi` | Buffered — commit on Apply or popover close | Avoids a navigation per checkbox |
| `text` | Debounced ~400 ms | Standard search-box expectation |
| `number-range`, `date-range` | Buffered — explicit Apply | Must not fire per keystroke or slider tick |

All paths converge on the same mechanism (`set`/`setMany`); only the timing
of the commit differs. The Advanced panel wraps its whole contents in a
single buffered Apply, committing via `setMany` so a ten-filter change is
one navigation.

---

## 5. Active filters and reset

Derived, never separately maintained:

```text
for each filter in registry:
    raw = searchParams.get(filter.key)
    if raw is present and decodes to a non-empty value:
        emit one chip per selected value, labelled via filter.ui.options
```

Removing a chip re-encodes that filter minus the removed value and commits.
Because chips are a pure function of the URL and the registry, they cannot
disagree with the applied results — a class of bug that hand-maintained
active-filter lists reliably produce.

---

## 6. Server/client boundary

Unchanged in spirit from the current pages, extended:

- `page.tsx` stays an async Server Component: parse `searchParams`, call the
  service, render results.
- Client components are small and leaf-shaped: `SearchFiltersBar`,
  `SearchAdvancedPanel`, `SearchActiveFilters`, `SearchSortControl`. Each
  reads the URL for display state and writes via the hook. None holds
  canonical state.
- Results list and pagination remain server-rendered.

The page shell, results, and pagination never become client components. This
matters for a discovery surface that should be indexable and fast on first
paint.

---

## 7. Cross-module reuse

The generic layer takes a registry as input, so a module's listing page is
thin:

```tsx
// any entity's listing page
<SearchFiltersBar filters={competitionSearchUi.quick} />
<SearchActiveFilters filters={competitionSearchUi.all} />
<SearchSortControl sorts={competitionSearchUi.sorts} />
```

Projects and Blogs pass their own registries to the same components. The
practical test of the design: **a new module's listing page should require
zero new filter components.**

---

## 8. Mobile

First-class, not adapted afterwards:

- Quick Filters bar is horizontally scrollable chips on small screens.
- Advanced filters open in a bottom sheet with a sticky Apply/Clear footer.
- Active chips wrap and remain individually removable at touch-target size.
- The buffered-commit policy matters more on mobile, where each navigation
  is a visible reflow — the Advanced panel's single `setMany` commit is the
  main reason to prefer buffering there.

---

## 9. Deliberately deferred

- Per-user filter reordering and frequently/recently-used surfacing. The
  registry's `ui.weight` and the generic dispatch make this a re-sort of an
  array rather than a rewrite — which is precisely the property that lets it
  wait.
- Facet counts next to options ("Online (12)"). Needs backend support; see
  [06-open-questions.md](06-open-questions.md).
- Typeahead/autocomplete over the free-text field.
