/**
 * Session-scoped client state.
 *
 * Client stores are module-level singletons that outlive a sign-out: the
 * app navigates client-side, so the JS module graph is never reloaded, and a
 * store that still holds account A's data will happily show — or re-save — it
 * for account B signed in on the same tab.
 *
 * Any store that holds data belonging to the signed-in account registers a
 * reset here; `SessionStateReset` (mounted once at the root) runs every one of
 * them when the signed-in user changes. Registration is by side effect of the
 * store module being imported, so a store nobody has loaded costs nothing and
 * the root layout never has to import every module's stores.
 */

const resetters = new Set<() => void>();

/**
 * Registers `reset` to run on every session change. Call it once, at module
 * scope, next to the store definition:
 *
 *   registerSessionReset(() => useThingStore.getState().reset());
 */
export function registerSessionReset(reset: () => void): void {
  resetters.add(reset);
}

/**
 * Runs every registered reset. One failing reset must not leave the other
 * stores holding the previous account's data, so each is isolated.
 */
export function resetSessionScopedState(): void {
  for (const reset of resetters) {
    try {
      reset();
    } catch (error) {
      console.error("Session state reset failed.", error);
    }
  }
}

/**
 * Whether a change in the signed-in user id requires resetting client state.
 *
 * `undefined` means the session has not resolved yet (still loading): that is
 * neither "signed out" nor a new account, so it never counts as a change and
 * never becomes the remembered baseline.
 */
export function sessionUserChanged({
  previous,
  current,
}: {
  previous: string | null | undefined;
  current: string | null | undefined;
}): boolean {
  if (current === undefined) {
    return false;
  }

  if (previous === undefined) {
    // First resolution of this page load: every store is still in its initial
    // state, so there is nothing to clear.
    return false;
  }

  return previous !== current;
}
