/**
 * Search Core - Custom preset storage (CLIENT-SAFE)
 *
 * =============================================================================
 * Local today, an account tomorrow
 * =============================================================================
 *
 * Saved presets live in this browser's `localStorage` for now. That is a
 * deployment decision, not a data-model decision: what is persisted is a list
 * of `CustomPreset` rows — generated id, name, filters, created and updated
 * timestamps — which is precisely the shape a per-user table would hold.
 *
 * Everything that touches storage goes through the store this module builds,
 * so moving to an account means writing a second implementation of
 * `CustomPresetStore` and handing it to the same hook. No component reads a
 * key, parses a payload, or knows that `localStorage` was ever involved.
 *
 * =============================================================================
 * Nothing here may throw
 * =============================================================================
 *
 * Every entry point into this module is reachable while a person is browsing
 * competitions, and none of them is important enough to justify taking the
 * listing down. Storage can be disabled outright (Safari's private mode used
 * to throw on write; enterprise policy still can), full, or holding whatever a
 * previous version — or a curious user with devtools — left behind.
 *
 * So reads degrade to "no saved presets", writes report failure, and the page
 * keeps working. The one thing this module will not do is trust what it reads:
 * every row is validated individually, and a single corrupt entry costs that
 * entry rather than the whole collection.
 */

import { z } from "zod";

import type { CustomPreset, PresetFilters } from "./presets";

// =============================================================================
// Persisted format
// =============================================================================

/**
 * The version of the payload this build writes.
 *
 * Bumped when the persisted shape changes incompatibly. Reads of an older or
 * newer version fall back to an empty list rather than guessing, which keeps a
 * migration an explicit act rather than something that quietly half-happens.
 */
export const CUSTOM_PRESET_SCHEMA_VERSION = 1;

/** Bounds a name to something a chip can render and a person can scan. */
export const PRESET_NAME_MAX_LENGTH = 60;

/**
 * A ceiling on how many presets one browser keeps.
 *
 * `localStorage` is a small, shared, synchronous budget: filling it does not
 * only break presets, it breaks whatever else the origin stores. Fifty is far
 * past what anyone curates by hand and far short of anything that could
 * threaten the quota.
 */
export const MAX_CUSTOM_PRESETS = 50;

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a date.");

/**
 * Filters as stored: flat string-to-string, exactly the URL's own vocabulary.
 *
 * Deliberately not validated against the filter registry here. This module is
 * entity-agnostic, and a preset saved when a filter existed should survive
 * that filter being renamed rather than being deleted on read — applying it is
 * where the registry has the final word, in `sanitizePresetFilters`.
 */
const PresetFiltersSchema: z.ZodType<PresetFilters> = z.record(
  z.string().min(1),
  z.string().min(1),
);

const CustomPresetSchema: z.ZodType<CustomPreset> = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(PRESET_NAME_MAX_LENGTH),
  filters: PresetFiltersSchema,
  createdAt: isoDateString,
  updatedAt: isoDateString,
});

/**
 * The envelope, validated loosely on purpose.
 *
 * `presets` is read as an unknown array and each element is validated on its
 * own below. Validating the array as a whole would make one malformed row
 * discard every good row beside it, which is the opposite of what someone
 * whose storage got scrambled needs from us.
 */
const EnvelopeSchema = z.object({
  schemaVersion: z.number().int(),
  presets: z.array(z.unknown()),
});

// =============================================================================
// The store contract
// =============================================================================

export interface CreateCustomPresetInput {
  readonly name: string;

  readonly filters: PresetFilters;
}

/**
 * Why writes report success rather than assuming it.
 *
 * A write can fail for reasons the person can act on — storage disabled, quota
 * exhausted, the cap reached — and an interface that reported "Saved" anyway
 * would be lying about something they will notice later, when their preset is
 * gone. The boolean and the `undefined` here exist so the dialog can say what
 * actually happened.
 */
export interface CustomPresetStore {
  /** Notifies on every change, including ones made in another tab. */
  readonly subscribe: (listener: () => void) => () => void;

  /** Stable between changes, as `useSyncExternalStore` requires. */
  readonly getSnapshot: () => readonly CustomPreset[];

  /** Always empty: the server has no access to this browser's storage. */
  readonly getServerSnapshot: () => readonly CustomPreset[];

  readonly create: (
    input: CreateCustomPresetInput,
  ) => CustomPreset | undefined;

  readonly rename: (id: string, name: string) => boolean;

  readonly remove: (id: string) => boolean;
}

/** One frozen instance, so an empty snapshot never changes identity. */
const EMPTY: readonly CustomPreset[] = Object.freeze([]);

/**
 * Reads `localStorage` without letting its absence become an error.
 *
 * Accessing `window.localStorage` is itself throwing behaviour in some
 * configurations, so even the lookup is guarded — and it is done per call
 * rather than once at module load, because this module is imported during
 * server rendering where there is no `window` at all.
 */
function readStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") {
      return undefined;
    }

    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * A stable id that does not depend on the name.
 *
 * `randomUUID` needs a secure context, which localhost and production both
 * are, but an origin served over plain HTTP is not — hence a fallback that is
 * merely unique enough for a per-browser list.
 */
function generateId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // Falls through to the timestamp form below.
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Builds a store over one namespace.
 *
 * The namespace keys the storage entry, so Competitions' saved presets and a
 * future entity's cannot collide, and clearing one never touches the other.
 */
export function createCustomPresetStore(
  namespace: string,
): CustomPresetStore {
  const storageKey = `kizunia:search-presets:${namespace}`;

  const listeners = new Set<() => void>();

  /**
   * The last parsed list.
   *
   * Cached because `getSnapshot` is called during render and must return the
   * same reference until something actually changes — re-parsing on each call
   * would hand React a new array every time and re-render forever.
   */
  let snapshot: readonly CustomPreset[] = EMPTY;

  let loaded = false;

  function parse(raw: string | null): readonly CustomPreset[] {
    if (raw === null) {
      return EMPTY;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed JSON: someone edited it, or a write was interrupted. There
      // is nothing to recover and nothing to report to the person browsing.
      return EMPTY;
    }

    const envelope = EnvelopeSchema.safeParse(parsed);

    if (!envelope.success) {
      return EMPTY;
    }

    if (envelope.data.schemaVersion !== CUSTOM_PRESET_SCHEMA_VERSION) {
      // A version this build does not know how to read. Treated as empty
      // rather than guessed at; a real migration belongs here when there is a
      // second version to migrate from.
      return EMPTY;
    }

    const presets: CustomPreset[] = [];

    for (const candidate of envelope.data.presets) {
      const preset = CustomPresetSchema.safeParse(candidate);

      if (preset.success) {
        presets.push(preset.data);
      }
    }

    return presets.length > 0 ? presets : EMPTY;
  }

  function load(): readonly CustomPreset[] {
    const storage = readStorage();

    if (!storage) {
      return EMPTY;
    }

    try {
      return parse(storage.getItem(storageKey));
    } catch {
      return EMPTY;
    }
  }

  function refresh(): void {
    snapshot = load();
    loaded = true;
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Persists a new list, adopting it only if the write succeeded.
   *
   * Order matters: a snapshot updated before a failed write would show a
   * preset that is not saved and will vanish on the next reload.
   */
  function persist(next: readonly CustomPreset[]): boolean {
    const storage = readStorage();

    if (!storage) {
      return false;
    }

    try {
      storage.setItem(
        storageKey,
        JSON.stringify({
          schemaVersion: CUSTOM_PRESET_SCHEMA_VERSION,
          presets: next,
        }),
      );
    } catch {
      // Quota, or storage disabled between the read and the write.
      return false;
    }

    snapshot = next.length > 0 ? next : EMPTY;
    loaded = true;

    notify();

    return true;
  }

  function current(): readonly CustomPreset[] {
    if (!loaded) {
      refresh();
    }

    return snapshot;
  }

  /**
   * Keeps tabs in agreement.
   *
   * `storage` fires only in the *other* tabs, which is exactly the case a
   * local write cannot cover. Attached with the first subscriber and released
   * with the last, so a page that never renders the preset bar carries no
   * listener at all.
   */
  const handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== storageKey) {
      return;
    }

    refresh();
    notify();
  };

  return {
    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== "undefined") {
        window.addEventListener("storage", handleStorageEvent);
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", handleStorageEvent);
        }
      };
    },

    getSnapshot: current,

    getServerSnapshot: () => EMPTY,

    create({ name, filters }) {
      const trimmed = name.trim();

      if (trimmed.length === 0 || trimmed.length > PRESET_NAME_MAX_LENGTH) {
        return undefined;
      }

      if (Object.keys(filters).length === 0) {
        return undefined;
      }

      const existing = current();

      if (existing.length >= MAX_CUSTOM_PRESETS) {
        return undefined;
      }

      const now = new Date().toISOString();

      const preset: CustomPreset = {
        id: generateId(),
        name: trimmed,
        filters,
        createdAt: now,
        updatedAt: now,
      };

      // Newest first: the list is read top-down and the preset someone just
      // saved is the one they are most likely to be looking for.
      return persist([preset, ...existing]) ? preset : undefined;
    },

    rename(id, name) {
      const trimmed = name.trim();

      if (trimmed.length === 0 || trimmed.length > PRESET_NAME_MAX_LENGTH) {
        return false;
      }

      const existing = current();

      const target = existing.find((preset) => preset.id === id);

      if (!target) {
        return false;
      }

      // Filters and `createdAt` are carried through untouched. Renaming is a
      // relabelling, and a rename that quietly re-saved the current search
      // would destroy the very thing the preset was kept for.
      const next = existing.map((preset) =>
        preset.id === id
          ? { ...preset, name: trimmed, updatedAt: new Date().toISOString() }
          : preset,
      );

      return persist(next);
    },

    remove(id) {
      const existing = current();

      if (!existing.some((preset) => preset.id === id)) {
        return false;
      }

      return persist(existing.filter((preset) => preset.id !== id));
    },
  };
}
