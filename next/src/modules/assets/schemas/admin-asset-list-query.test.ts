import { describe, expect, it } from "vitest";

import { AssetCategory, AssetStatus } from "@/generated/prisma";

import { AdminAssetListQuerySchema } from "./admin-asset-list-query";

describe("AdminAssetListQuerySchema", () => {
  it("parses valid filters", () => {
    const result = AdminAssetListQuerySchema.parse({
      status: AssetStatus.ACTIVE,
      category: AssetCategory.IMAGE,
      referenced: "yes",
      createdFrom: "2024-01-01T00:00:00.000Z",
    });

    expect(result.status).toBe(AssetStatus.ACTIVE);
    expect(result.category).toBe(AssetCategory.IMAGE);
    expect(result.referenced).toBe("yes");
    expect(result.createdFrom).toBeInstanceOf(Date);
  });

  it("degrades an unparsable date to undefined rather than throwing", () => {
    const result = AdminAssetListQuerySchema.parse({ createdFrom: "not-a-date" });
    expect(result.createdFrom).toBeUndefined();
  });

  it("rejects an invalid status value", () => {
    const result = AdminAssetListQuerySchema.safeParse({ status: "NOT_A_STATUS" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid referenced value", () => {
    const result = AdminAssetListQuerySchema.safeParse({ referenced: "maybe" });
    expect(result.success).toBe(false);
  });

  it("parses an empty object (no filters)", () => {
    const result = AdminAssetListQuerySchema.parse({});
    expect(result).toEqual({});
  });
});
