import { describe, expect, it, vi } from "vitest";

// `buildAssetViewUrl` reaches the storage provider (Cloudinary config). What
// matters here is that the mapper routes every asset through it and never
// emits `secureUrl` directly, so it is replaced with a recognisable stand-in.
vi.mock("@/modules/assets/backend/download-url", () => ({
  buildAssetViewUrl: vi.fn(
    (asset: { publicId: string; category: string; secureUrl: string }) =>
      asset.category === "DOCUMENT"
        ? `signed://${asset.publicId}`
        : asset.secureUrl,
  ),
}));

import { PortfolioVisibility } from "@/generated/prisma";

import type {
  PortfolioEditorEntity,
  PortfolioPublicDetailsEntity,
} from "../repository";
import type { PortfolioTechnologyEntity } from "../portfolio-technology.repository";
import { PortfolioMapper } from "./mapper";

const RESUME = {
  id: "asset-resume",
  secureUrl: "https://res.example/raw/resume.pdf",
  publicId: "portfolio/resume-abc.pdf",
  category: "DOCUMENT",
  width: null,
  height: null,
  format: "pdf",
  mimeType: "application/pdf",
} as const;

function editorEntity(
  overrides: Partial<PortfolioEditorEntity> = {},
): PortfolioEditorEntity {
  return {
    id: "portfolio-1",
    userId: "user-1",
    displayName: "Ada",
    headline: "Engineer",
    bio: "Bio",
    phone: "+1 555",
    publicContactEmail: "ada@example.test",
    location: "London",
    visibility: PortfolioVisibility.PRIVATE,
    deletedAt: null,
    user: { username: "ada" },
    resumeAsset: RESUME,
    ...overrides,
  };
}

describe("PortfolioMapper.toEditorDto", () => {
  it("returns exactly the editor contract and nothing else", () => {
    const dto = PortfolioMapper.toEditorDto(editorEntity());

    expect(Object.keys(dto).sort()).toEqual(
      [
        "bio",
        "displayName",
        "headline",
        "id",
        "location",
        "phone",
        "publicContactEmail",
        "resumeAsset",
        "user",
        "visibility",
      ].sort(),
    );
    expect(Object.keys(dto.user)).toEqual(["username"]);
  });

  it("does not leak authorization inputs, raw asset fields or section aggregates", () => {
    const serialized = JSON.stringify(
      PortfolioMapper.toEditorDto(editorEntity()),
    );

    for (const forbidden of [
      "userId",
      "deletedAt",
      "publicId",
      "secureUrl",
      "category",
      "projects",
      "testimonials",
      "technologies",
      "settings",
      "links",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("emits the resume as a view URL, never the stored secureUrl", () => {
    const dto = PortfolioMapper.toEditorDto(editorEntity());

    expect(dto.resumeAsset).toEqual({
      id: "asset-resume",
      url: "signed://portfolio/resume-abc.pdf",
      format: "pdf",
      mimeType: "application/pdf",
    });
    expect(JSON.stringify(dto)).not.toContain(RESUME.secureUrl);
  });

  it("maps a portfolio without a resume", () => {
    const dto = PortfolioMapper.toEditorDto(
      editorEntity({ resumeAsset: null }),
    );

    expect(dto.resumeAsset).toBeNull();
  });
});

describe("PortfolioMapper.toPublicDto — resume", () => {
  it("emits the resume through the view-URL builder", () => {
    const portfolio = {
      id: "portfolio-1",
      displayName: "Ada",
      headline: null,
      bio: null,
      publicContactEmail: null,
      phone: null,
      location: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      user: { username: "ada", avatarAsset: null, coverAsset: null },
      settings: null,
      resumeAsset: RESUME,
      links: [],
      technologies: [],
      education: [],
      experience: [],
      achievements: [],
      certifications: [],
      testimonials: [],
      projects: [],
    } as unknown as PortfolioPublicDetailsEntity;

    const dto = PortfolioMapper.toPublicDto(portfolio);

    expect(dto.resumeAsset?.url).toBe("signed://portfolio/resume-abc.pdf");
    expect(JSON.stringify(dto)).not.toContain("publicId");
    expect(JSON.stringify(dto)).not.toContain(RESUME.secureUrl);
  });
});

describe("PortfolioMapper.toTechnologySummaryDto", () => {
  function entry(deletedAt: Date | null): PortfolioTechnologyEntity {
    return {
      portfolioId: "portfolio-1",
      technologyId: "tech-1",
      startedUsingAt: null,
      description: null,
      displayOrder: 0,
      technology: {
        id: "tech-1",
        name: "TypeScript",
        slug: "typescript",
        description: null,
        type: "LANGUAGE",
        iconAssetId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt,
        iconAsset: null,
      },
    } as PortfolioTechnologyEntity;
  }

  it("marks an active technology available", () => {
    expect(
      PortfolioMapper.toTechnologySummaryDto(entry(null)).unavailable,
    ).toBe(false);
  });

  it("flags a retired technology instead of hiding it, so the owner can remove it", () => {
    const dto = PortfolioMapper.toTechnologySummaryDto(entry(new Date()));

    expect(dto.unavailable).toBe(true);
    expect(dto.technologyId).toBe("tech-1");
    expect(JSON.stringify(dto)).not.toContain("deletedAt");
  });
});
