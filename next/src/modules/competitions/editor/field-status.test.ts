import { describe, expect, it } from "vitest";
import { deriveFieldStatus, isBlank, isEquivalent } from "./field-status";

describe("isBlank", () => {
  it("treats null and undefined as blank", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(undefined)).toBe(true);
  });

  it("treats empty and whitespace-only strings as blank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
  });

  it("treats an empty array as blank", () => {
    expect(isBlank([])).toBe(true);
  });

  it("does not treat 0 or false as blank", () => {
    expect(isBlank(0)).toBe(false);
    expect(isBlank(false)).toBe(false);
  });

  it("does not treat a populated string or array as blank", () => {
    expect(isBlank("hello")).toBe(false);
    expect(isBlank([{ id: "1" }])).toBe(false);
  });
});

describe("isEquivalent", () => {
  it("compares primitives with Object.is semantics", () => {
    expect(isEquivalent(1, 1)).toBe(true);
    expect(isEquivalent("a", "b")).toBe(false);
    expect(isEquivalent(null, null)).toBe(true);
    expect(isEquivalent(null, undefined)).toBe(false);
  });

  it("compares id-bearing arrays as sets, order-independent", () => {
    const a = [{ id: "1" }, { id: "2" }];
    const b = [{ id: "2" }, { id: "1" }];
    expect(isEquivalent(a, b)).toBe(true);
  });

  it("detects a different array membership", () => {
    const a = [{ id: "1" }];
    const b = [{ id: "2" }];
    expect(isEquivalent(a, b)).toBe(false);
  });

  it("detects a different array length", () => {
    expect(isEquivalent([{ id: "1" }], [{ id: "1" }, { id: "2" }])).toBe(
      false,
    );
  });

  it("treats two empty arrays as equivalent", () => {
    expect(isEquivalent([], [])).toBe(true);
  });

  it("compares single id-bearing objects by id, not by reference", () => {
    // Regression for a real bug: `original` is a `structuredClone` of
    // `competition` (see `initialize` in the store), so an asset object
    // like `logoAsset` never reference-equals its clone counterpart even
    // when the content is identical — `Object.is` alone reported these as
    // permanently different, showing a phantom UNSAVED status from load.
    const a = { id: "asset-1", secureUrl: "https://example.com/a.png" };
    const b = { id: "asset-1", secureUrl: "https://example.com/a.png" };
    expect(a).not.toBe(b);
    expect(isEquivalent(a, b)).toBe(true);
  });

  it("detects a different id-bearing object", () => {
    expect(
      isEquivalent({ id: "asset-1" }, { id: "asset-2" }),
    ).toBe(false);
  });

  it("detects a change from an asset to null, and vice versa", () => {
    expect(isEquivalent({ id: "asset-1" }, null)).toBe(false);
    expect(isEquivalent(null, { id: "asset-1" })).toBe(false);
  });

  it("treats two nulls as equivalent for an id-bearing field", () => {
    expect(isEquivalent(null, null)).toBe(true);
  });
});

describe("deriveFieldStatus", () => {
  it("is NULL for a never-populated field with no pending change", () => {
    expect(deriveFieldStatus(null, null)).toBe("NULL");
  });

  it("is UNSAVED when a saved value is cleared but not yet saved", () => {
    // The brief's exact scenario: saved registrationLink, cleared in the
    // editor, not yet saved.
    expect(deriveFieldStatus(null, "https://example.com")).toBe("UNSAVED");
  });

  it("is NULL after that clear is saved (both sides now null)", () => {
    expect(deriveFieldStatus(null, null)).toBe("NULL");
  });

  it("is UNSAVED for a brand-new, unsaved value", () => {
    expect(deriveFieldStatus("something", null)).toBe("UNSAVED");
  });

  it("is DONE once a populated value is saved", () => {
    expect(deriveFieldStatus("something", "something")).toBe("DONE");
  });

  it("is NULL for an empty array with no pending change", () => {
    expect(deriveFieldStatus([], [])).toBe("NULL");
  });

  it("is DONE for a populated, saved array", () => {
    const list = [{ id: "1" }];
    expect(deriveFieldStatus(list, list)).toBe("DONE");
  });

  it("is UNSAVED for a typed-and-reverted value compared incorrectly", () => {
    // Guards against a naive "just check current" implementation: typing a
    // character and deleting it must resolve back to the saved value
    // before this function is even called (that's buildUpdateCompetitionPayload's
    // job), so given equal values it must never report UNSAVED.
    expect(deriveFieldStatus("same", "same")).not.toBe("UNSAVED");
  });
});
