import { describe, expect, it } from "vitest";
import { EDITABLE_SCALAR_KEYS } from "./build-update-payload";
import { FIELD_METADATA, getFieldMeta } from "./field-metadata";

const VALID_TABS = new Set([
  "general",
  "schedule",
  "locations",
  "technologies",
  "eligibility",
  "documentation",
]);

const VALID_IMPORTANCE = new Set(["critical", "important", "optional"]);

describe("FIELD_METADATA", () => {
  it("has no duplicate keys", () => {
    const keys = FIELD_METADATA.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every editable scalar key from the PATCH payload", () => {
    for (const key of EDITABLE_SCALAR_KEYS) {
      expect(getFieldMeta(key), `missing metadata for "${key}"`).toBeDefined();
    }
  });

  it("only uses known tabs", () => {
    for (const meta of FIELD_METADATA) {
      expect(VALID_TABS.has(meta.tab), `unknown tab "${meta.tab}" on ${meta.key}`).toBe(
        true,
      );
    }
  });

  it("only uses known importance tiers", () => {
    for (const meta of FIELD_METADATA) {
      expect(
        VALID_IMPORTANCE.has(meta.importance),
        `unknown importance "${meta.importance}" on ${meta.key}`,
      ).toBe(true);
    }
  });

  it("marks title, slug, and visibility as critical and non-nullable", () => {
    for (const key of ["title", "slug", "visibility"] as const) {
      const meta = getFieldMeta(key);
      expect(meta?.importance).toBe("critical");
      expect(meta?.nullable).toBe(false);
    }
  });

  it("does not mark any optional-information field as critical", () => {
    // The core product principle: Mode, Team Size, Certificate, Prize,
    // Registration Link, Technologies, and Locations must never be able to
    // block a save. Asserting their tier here is the drift guard for that
    // guarantee — the Summary tab derives its "blocker" section from this
    // metadata, so if one of these ever regressed to "critical" the
    // Summary would incorrectly start reporting it as a save blocker.
    const mustNeverBeCritical = [
      "mode",
      "minTeamSize",
      "maxTeamSize",
      "certificateType",
      "prizePool",
      "registrationLink",
      "technologies",
      "eligibilities",
      "locations",
    ] as const;

    for (const key of mustNeverBeCritical) {
      expect(getFieldMeta(key)?.importance).not.toBe("critical");
      expect(getFieldMeta(key)?.nullable).toBe(true);
    }
  });
});
