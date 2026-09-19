import { describe, expect, it } from "vitest";
import {
  NULLABLE_TEXT_FIELDS,
  normalizeContentValue,
  normalizeEditorPatch,
  normalizeTextValue,
} from "./normalize";

describe("normalizeTextValue", () => {
  it("normalizes an empty string to null", () => {
    expect(normalizeTextValue("")).toBeNull();
  });

  it("normalizes a whitespace-only string to null", () => {
    expect(normalizeTextValue("   ")).toBeNull();
    expect(normalizeTextValue("\t\n")).toBeNull();
  });

  it("returns a populated string unchanged", () => {
    expect(normalizeTextValue("https://example.com")).toBe(
      "https://example.com",
    );
  });
});

describe("normalizeContentValue", () => {
  it("normalizes blank markdown to null only on exact blank", () => {
    expect(normalizeContentValue("")).toBeNull();
    expect(normalizeContentValue("   ")).toBeNull();
  });

  it("does not treat whitespace-adjacent real content as blank", () => {
    expect(normalizeContentValue("  # Heading  ")).toBe("  # Heading  ");
  });
});

describe("normalizeEditorPatch", () => {
  it("normalizes every field in NULLABLE_TEXT_FIELDS", () => {
    for (const field of NULLABLE_TEXT_FIELDS) {
      const patch = { [field]: "" } as Record<string, unknown>;
      expect(normalizeEditorPatch(patch)[field]).toBeNull();
    }
  });

  it("does not normalize title", () => {
    expect(normalizeEditorPatch({ title: "" }).title).toBe("");
  });

  it("does not normalize slug", () => {
    expect(normalizeEditorPatch({ slug: "" }).slug).toBe("");
  });

  it("does not normalize content (handled separately, see normalizeContentValue)", () => {
    expect(normalizeEditorPatch({ content: "" }).content).toBe("");
  });

  it("never produces 0 for numeric fields it does not own", () => {
    expect(normalizeEditorPatch({ minTeamSize: 0 }).minTeamSize).toBe(0);
  });

  it("leaves arrays untouched", () => {
    const technologies = [{ id: "t1" }];
    expect(normalizeEditorPatch({ technologies }).technologies).toBe(
      technologies,
    );
  });

  it("leaves an already-null nullable text field as null", () => {
    expect(normalizeEditorPatch({ website: null }).website).toBeNull();
  });

  it("passes through unrelated keys unchanged", () => {
    const patch = { mode: "ONLINE", visibility: "PUBLIC" };
    expect(normalizeEditorPatch(patch)).toEqual(patch);
  });
});
