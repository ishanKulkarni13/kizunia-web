import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerSessionReset,
  resetSessionScopedState,
  sessionUserChanged,
} from "./reset-registry";

describe("sessionUserChanged", () => {
  it("does not reset while the session is still loading", () => {
    expect(sessionUserChanged({ previous: "a", current: undefined })).toBe(
      false,
    );
    expect(
      sessionUserChanged({ previous: undefined, current: undefined }),
    ).toBe(false);
  });

  it("does not reset on the first resolution of a page load", () => {
    expect(sessionUserChanged({ previous: undefined, current: "a" })).toBe(
      false,
    );
    expect(sessionUserChanged({ previous: undefined, current: null })).toBe(
      false,
    );
  });

  it("resets on sign-out", () => {
    expect(sessionUserChanged({ previous: "a", current: null })).toBe(true);
  });

  it("resets on sign-in after being signed out", () => {
    expect(sessionUserChanged({ previous: null, current: "b" })).toBe(true);
  });

  it("resets on a direct account switch", () => {
    expect(sessionUserChanged({ previous: "a", current: "b" })).toBe(true);
  });

  it("does not reset when the same user stays signed in", () => {
    expect(sessionUserChanged({ previous: "a", current: "a" })).toBe(false);
    expect(sessionUserChanged({ previous: null, current: null })).toBe(false);
  });
});

describe("resetSessionScopedState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs every registered reset", () => {
    const first = vi.fn();
    const second = vi.fn();

    registerSessionReset(first);
    registerSessionReset(second);

    resetSessionScopedState();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps resetting the remaining stores when one throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const after = vi.fn();

    registerSessionReset(failing);
    registerSessionReset(after);

    expect(() => resetSessionScopedState()).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it("registering the same reset twice runs it once", () => {
    const reset = vi.fn();

    registerSessionReset(reset);
    registerSessionReset(reset);

    resetSessionScopedState();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
