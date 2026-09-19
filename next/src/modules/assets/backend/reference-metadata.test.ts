import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma";

import { ASSET_REFERENCE_SOURCES } from "./reference-metadata";

describe("ASSET_REFERENCE_SOURCES drift guard", () => {
  it("covers every Asset back-relation in schema.prisma except the audit-only uploadedBy FK", () => {
    const assetModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === "Asset",
    );

    if (!assetModel) {
      throw new Error("Asset model not found in Prisma dmmf — has it been renamed?");
    }

    // `uploadedBy` is a forward, audit-only FK (see schema.prisma's comment
    // on Asset.uploadedById) — deliberately not a reference relation, so it
    // is excluded here rather than added to the inventory.
    const schemaRelations = new Set(
      assetModel.fields
        .filter((field) => field.kind === "object" && field.name !== "uploadedBy")
        .map((field) => field.name),
    );

    const inventoryRelations = new Set(
      ASSET_REFERENCE_SOURCES.flatMap((source) =>
        source.slots.map((slot) => slot.relation),
      ),
    );

    expect(inventoryRelations).toEqual(schemaRelations);
  });

  it("has no duplicate (entity, slot) pairs", () => {
    const pairs = ASSET_REFERENCE_SOURCES.flatMap((source) =>
      source.slots.map((slot) => `${source.entity}:${slot.slot}`),
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
