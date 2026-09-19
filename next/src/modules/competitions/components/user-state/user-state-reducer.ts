/**
 * Pure state transitions for one competition's per-user state (bookmark or
 * registration — the same shape serves both). Extracted from the hook so
 * the optimistic-apply / rollback logic is unit-testable without a DOM or
 * a network mock.
 */

/**
 * `"unresolved"` — no batch response yet; the control must render disabled
 *   and non-committal (never a confident "not saved").
 * `"anonymous"` — the viewer is signed out; no request is ever sent.
 * `"resolved"` — a real value is known, optimistic or server-confirmed.
 */
export type UserStateStatus = "unresolved" | "anonymous" | "resolved";

export interface UserStateEntry {
  status: UserStateStatus;
  value: boolean;
  /** True while a toggle request for this id is in flight. */
  pending: boolean;
}

export const UNRESOLVED_ENTRY: UserStateEntry = {
  status: "unresolved",
  value: false,
  pending: false,
};

export type UserStateMap = Record<string, UserStateEntry>;

export type UserStateAction =
  | { type: "BATCH_RESOLVED"; values: Record<string, boolean> }
  | { type: "MARK_ANONYMOUS"; ids: string[] }
  | { type: "OPTIMISTIC_SET"; id: string; value: boolean }
  | { type: "COMMIT"; id: string }
  | { type: "ROLLBACK"; id: string; previousValue: boolean };

export function userStateReducer(
  state: UserStateMap,
  action: UserStateAction,
): UserStateMap {
  switch (action.type) {
    case "BATCH_RESOLVED": {
      const next = { ...state };
      for (const [id, value] of Object.entries(action.values)) {
        const current = state[id];

        // A toggle that started before this batch landed is newer than the
        // data in it. Adopting the server's value here would visibly undo
        // the user's click mid-flight, so a pending entry keeps its
        // optimistic value and only gains "resolved" status; COMMIT or
        // ROLLBACK still has the final say.
        if (current?.pending) {
          next[id] = { ...current, status: "resolved" };
          continue;
        }

        next[id] = { status: "resolved", value, pending: false };
      }
      return next;
    }

    case "MARK_ANONYMOUS": {
      const next = { ...state };
      for (const id of action.ids) {
        next[id] = { status: "anonymous", value: false, pending: false };
      }
      return next;
    }

    case "OPTIMISTIC_SET": {
      const current = state[action.id] ?? UNRESOLVED_ENTRY;
      return {
        ...state,
        [action.id]: { ...current, value: action.value, pending: true },
      };
    }

    case "COMMIT": {
      const current = state[action.id] ?? UNRESOLVED_ENTRY;
      return {
        ...state,
        [action.id]: { ...current, status: "resolved", pending: false },
      };
    }

    case "ROLLBACK": {
      const current = state[action.id] ?? UNRESOLVED_ENTRY;
      return {
        ...state,
        [action.id]: {
          ...current,
          status: "resolved",
          value: action.previousValue,
          pending: false,
        },
      };
    }

    default:
      return state;
  }
}
