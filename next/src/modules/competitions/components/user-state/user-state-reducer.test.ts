import { describe, expect, it } from "vitest";

import {
  UNRESOLVED_ENTRY,
  userStateReducer,
  type UserStateMap,
} from "./user-state-reducer";

describe("userStateReducer", () => {
  it("resolves unseen ids to unresolved by default", () => {
    const state: UserStateMap = {};

    expect(state["comp-1"] ?? UNRESOLVED_ENTRY).toEqual(UNRESOLVED_ENTRY);
  });

  it("BATCH_RESOLVED marks every id in the response as resolved", () => {
    const state = userStateReducer(
      {},
      { type: "BATCH_RESOLVED", values: { "comp-1": true, "comp-2": false } },
    );

    expect(state["comp-1"]).toEqual({
      status: "resolved",
      value: true,
      pending: false,
    });
    expect(state["comp-2"]).toEqual({
      status: "resolved",
      value: false,
      pending: false,
    });
  });

  it("BATCH_RESOLVED does not clobber an in-flight optimistic value", () => {
    // The user clicked before the batch read landed. The server's value is
    // older than their click, so adopting it would visibly undo the toggle.
    const optimistic = userStateReducer(
      {},
      { type: "OPTIMISTIC_SET", id: "comp-1", value: true },
    );

    const afterBatch = userStateReducer(optimistic, {
      type: "BATCH_RESOLVED",
      values: { "comp-1": false },
    });

    expect(afterBatch["comp-1"]).toEqual({
      status: "resolved",
      value: true,
      pending: true,
    });
  });

  it("MARK_ANONYMOUS marks the given ids as anonymous with a false value", () => {
    const state = userStateReducer(
      {},
      { type: "MARK_ANONYMOUS", ids: ["comp-1", "comp-2"] },
    );

    expect(state["comp-1"]).toEqual({
      status: "anonymous",
      value: false,
      pending: false,
    });
    expect(state["comp-2"].status).toBe("anonymous");
  });

  it("OPTIMISTIC_SET writes the target value immediately and marks pending", () => {
    const initial: UserStateMap = {
      "comp-1": { status: "resolved", value: false, pending: false },
    };

    const next = userStateReducer(initial, {
      type: "OPTIMISTIC_SET",
      id: "comp-1",
      value: true,
    });

    expect(next["comp-1"]).toEqual({
      status: "resolved",
      value: true,
      pending: true,
    });
  });

  it("OPTIMISTIC_SET on an unseen id starts from the unresolved default", () => {
    const next = userStateReducer(
      {},
      { type: "OPTIMISTIC_SET", id: "comp-1", value: true },
    );

    expect(next["comp-1"]).toEqual({
      status: "unresolved",
      value: true,
      pending: true,
    });
  });

  it("COMMIT clears the pending flag and leaves the optimistic value in place", () => {
    const optimistic = userStateReducer(
      {},
      { type: "OPTIMISTIC_SET", id: "comp-1", value: true },
    );

    const committed = userStateReducer(optimistic, {
      type: "COMMIT",
      id: "comp-1",
    });

    expect(committed["comp-1"]).toEqual({
      status: "resolved",
      value: true,
      pending: false,
    });
  });

  it("ROLLBACK restores the previous value and clears pending on failure", () => {
    const optimistic = userStateReducer(
      { "comp-1": { status: "resolved", value: false, pending: false } },
      { type: "OPTIMISTIC_SET", id: "comp-1", value: true },
    );

    const rolledBack = userStateReducer(optimistic, {
      type: "ROLLBACK",
      id: "comp-1",
      previousValue: false,
    });

    expect(rolledBack["comp-1"]).toEqual({
      status: "resolved",
      value: false,
      pending: false,
    });
  });

  it("does not mutate the previous state object", () => {
    const initial: UserStateMap = {
      "comp-1": { status: "resolved", value: false, pending: false },
    };

    const next = userStateReducer(initial, {
      type: "OPTIMISTIC_SET",
      id: "comp-1",
      value: true,
    });

    expect(initial["comp-1"].value).toBe(false);
    expect(next).not.toBe(initial);
  });
});
