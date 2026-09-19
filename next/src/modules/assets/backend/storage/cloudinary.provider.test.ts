import { describe, expect, it } from "vitest";

import { AssetCategory } from "@/generated/prisma";

import { CloudinaryStorageProvider } from "./cloudinary.provider";

/**
 * `buildDurableViewUrl` never touches the network (no Cloudinary SDK call
 * for either branch — see its implementation), so this is a genuine unit
 * test, not something that needs the Cloudinary module mocked.
 */
describe("CloudinaryStorageProvider.buildDurableViewUrl", () => {
  const provider = new CloudinaryStorageProvider();

  it("returns the stored secureUrl for IMAGE — durable, public CDN URL", () => {
    const secureUrl = "https://res.cloudinary.com/test/image/upload/abc.png";

    expect(
      provider.buildDurableViewUrl({
        publicId: "kizunia/assets/abc",
        category: AssetCategory.IMAGE,
        secureUrl,
      }),
    ).toBe(secureUrl);
  });

  it("returns the stored secureUrl for VIDEO — durable, public CDN URL", () => {
    const secureUrl = "https://res.cloudinary.com/test/video/upload/abc.mp4";

    expect(
      provider.buildDurableViewUrl({
        publicId: "kizunia/assets/abc",
        category: AssetCategory.VIDEO,
        secureUrl,
      }),
    ).toBe(secureUrl);
  });

  it("returns null for DOCUMENT — no durable URL exists; callers must use the authorized download flow", () => {
    expect(
      provider.buildDurableViewUrl({
        publicId: "kizunia/assets/doc.pdf",
        category: AssetCategory.DOCUMENT,
        secureUrl: "https://res.cloudinary.com/test/raw/upload/doc.pdf",
      }),
    ).toBeNull();
  });
});
