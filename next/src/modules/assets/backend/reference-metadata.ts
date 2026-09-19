/**
 * Admin reference-reporting metadata.
 *
 * This is NOT the lifecycle authority — `AssetReferenceChecker.countReferences`
 * is, and stays untouched and independently enumerated (see its own doc
 * comment). This file exists only to answer an admin's "what references this
 * Asset, and why can't it be cleaned up" question, cheaply, across a whole
 * page of Assets at once.
 *
 * `AssetReferenceChecker.countReferences` counts DISTINCT REFERENCING SOURCE
 * ENTITIES, not populated Asset-FK slots — e.g. a User whose avatar AND cover
 * both point at the same Asset counts as one reference, not two, because
 * `db.user.count({ where: { OR: [...] } })` counts users, not fields. Three
 * source models have more than one Asset-referencing slot (User, Competition,
 * Project); everywhere else "distinct entity" and "populated slot" count the
 * same thing. `AssetReferenceReporter.forAssets` below reproduces that exact
 * semantics — grouping by source model, one query per model — so the
 * `referenceCount` an admin sees can never disagree with the number the
 * lifecycle actually uses. The `referenceCount` vs. `references` (breakdown)
 * distinction is what keeps the two representable at once: a single User
 * referencing an Asset from two slots reports `referenceCount: 1` and a
 * two-entry breakdown.
 *
 * Deliberately two hand-maintained inventories rather than one shared,
 * dynamically-dispatched one: deriving `countReferences` from this metadata
 * would require indexing `db[model]` by a runtime string, which is untyped
 * Prisma reflection in the hot path that runs under a row lock during every
 * detach — rejected on those grounds (see
 * docs/architecture/domain/assets/lifecycle.md#concurrency). Equivalence
 * between the two is enforced by test
 * (asset-admin.integration.test.ts), not by shared code — see the structural
 * drift guard (reference-metadata.test.ts) and the semantic equivalence test.
 */

import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

interface ReferenceSlot {
  /** The Asset-side back-relation name (see schema.prisma `model Asset`). */
  readonly relation: string;
  /** The FK field on the source model, for documentation/traceability only. */
  readonly field: string;
  /** Short, human label for this slot (e.g. "avatar", "logo"). */
  readonly slot: string;
}

interface ReferenceSource {
  /** Human label for the source model (e.g. "User", "Competition"). */
  readonly entity: string;
  readonly slots: readonly ReferenceSlot[];
}

/**
 * One entry per source model that can reference an Asset — 12 entries
 * covering all 16 Asset-side back-relations (verified against schema.prisma;
 * excludes `uploadedBy`, the forward audit-only FK, which is not a reference
 * — see repository.ts / schema.prisma's comment on that field). Structural
 * completeness against the schema is enforced by a drift-guard unit test.
 */
export const ASSET_REFERENCE_SOURCES: readonly ReferenceSource[] = [
  {
    entity: "User",
    slots: [
      { relation: "userAvatar", field: "avatarAssetId", slot: "avatar" },
      { relation: "userCover", field: "coverAssetId", slot: "cover" },
    ],
  },
  {
    entity: "Competition",
    slots: [
      { relation: "competitionLogo", field: "logoAssetId", slot: "logo" },
      { relation: "competitionBanner", field: "bannerAssetId", slot: "banner" },
      { relation: "competitionCover", field: "coverAssetId", slot: "cover" },
    ],
  },
  {
    entity: "Competition suggestion",
    slots: [{ relation: "suggestionAssets", field: "assetId", slot: "gallery" }],
  },
  {
    entity: "Project",
    slots: [
      { relation: "projectLogo", field: "logoAssetId", slot: "logo" },
      { relation: "projectCover", field: "coverAssetId", slot: "cover" },
    ],
  },
  {
    entity: "Portfolio",
    slots: [{ relation: "portfolioResume", field: "resumeAssetId", slot: "resume" }],
  },
  {
    entity: "Education",
    slots: [
      {
        relation: "educationInstitutionLogos",
        field: "institutionLogoAssetId",
        slot: "institution logo",
      },
    ],
  },
  {
    entity: "Experience",
    slots: [
      { relation: "experienceCompanyLogos", field: "companyLogoAssetId", slot: "company logo" },
    ],
  },
  {
    entity: "Achievement",
    slots: [{ relation: "achievementAssets", field: "assetId", slot: "asset" }],
  },
  {
    entity: "Certification",
    slots: [{ relation: "certificationAssets", field: "assetId", slot: "asset" }],
  },
  {
    entity: "Testimonial",
    slots: [{ relation: "testimonialImages", field: "imageAssetId", slot: "image" }],
  },
  {
    entity: "Badge",
    slots: [{ relation: "badgeIcons", field: "iconAssetId", slot: "icon" }],
  },
  {
    entity: "Technology",
    slots: [{ relation: "technologyIcons", field: "iconAssetId", slot: "icon" }],
  },
] as const;

/** Every Asset-side back-relation name, flattened — used to build the
 *  referenced/unreferenced list filter. */
const ALL_RELATIONS: readonly string[] = ASSET_REFERENCE_SOURCES.flatMap((source) =>
  source.slots.map((slot) => slot.relation),
);

export interface ReferenceBreakdownEntry {
  entity: string;
  slot: string;
  count: number;
}

export interface AssetReferenceReport {
  /** Number of DISTINCT referencing source entities — matches
   *  `AssetReferenceChecker.countReferences` exactly. NEVER the sum of
   *  `breakdown[].count`, which double-counts a source entity using more
   *  than one slot on the same Asset. */
  total: number;
  breakdown: ReferenceBreakdownEntry[];
}

function emptyReport(): AssetReferenceReport {
  return { total: 0, breakdown: [] };
}

/**
 * Builds the `Asset.where` clause for the admin "referenced" / "unreferenced"
 * filter, from the same relation inventory above. Every relation is an
 * Asset-side back-relation, so this is ordinary, fully-typed Prisma relation
 * filtering on one fixed model — not the dynamic `db[model]` dispatch
 * rejected above (that would index into *different* Prisma models by a
 * runtime string; this indexes known relation fields of one model, `Asset`).
 *
 * "Zero references" means the same thing under either counting semantics
 * (distinct-entity vs. populated-slot), so this filter is unaffected by the
 * distinction the rest of this file exists to preserve.
 */
export function referencedWhere(mode: "yes" | "no"): Prisma.AssetWhereInput {
  const relationFilter = mode === "yes" ? "some" : "none";
  const clauses = ALL_RELATIONS.map(
    (relation) => ({ [relation]: { [relationFilter]: {} } }) as Prisma.AssetWhereInput,
  );

  return mode === "yes" ? { OR: clauses } : { AND: clauses };
}

export class AssetReferenceReporter {
  /**
   * Reports references for a whole page of Assets in a fixed 12 queries —
   * one per source model, each filtered with `id IN (...)` over the entire
   * requested id set — never 12 * N. Each query selects only the id and the
   * FK columns it needs; aggregation (grouping FK hits back into "how many
   * DISTINCT rows reference each Asset") happens in memory, mirroring what
   * `count({ where: { OR: [...] } })` does in the lifecycle checker.
   */
  static async forAssets(
    db: Db,
    assetIds: readonly string[],
  ): Promise<Map<string, AssetReferenceReport>> {
    const reports = new Map<string, AssetReferenceReport>();

    if (assetIds.length === 0) {
      return reports;
    }

    for (const id of assetIds) {
      reports.set(id, emptyReport());
    }

    function record(assetId: string | null, entity: string, slot: string) {
      if (!assetId) return;
      const report = reports.get(assetId);
      if (!report) return;

      const existing = report.breakdown.find(
        (entry) => entity === entry.entity && slot === entry.slot,
      );
      if (existing) {
        existing.count += 1;
      } else {
        report.breakdown.push({ entity, slot, count: 1 });
      }
    }

    /** One source-entity row contributes 1 to `total` for EVERY distinct
     *  Asset id it references, regardless of how many of its own slots
     *  point at that same Asset — this is what keeps `total` aligned with
     *  `countReferences`'s `OR`-based per-entity counting. */
    function recordEntityOnce(assetId: string | null, seen: Set<string>) {
      if (!assetId || seen.has(assetId)) return;
      seen.add(assetId);
      const report = reports.get(assetId);
      if (report) report.total += 1;
    }

    const ids = { in: [...assetIds] };

    const [
      users,
      competitions,
      suggestionAssets,
      projects,
      portfolios,
      educations,
      experiences,
      achievements,
      certifications,
      testimonials,
      badges,
      technologies,
    ] = await Promise.all([
      db.user.findMany({
        where: { OR: [{ avatarAssetId: ids }, { coverAssetId: ids }] },
        select: { avatarAssetId: true, coverAssetId: true },
      }),
      db.competition.findMany({
        where: {
          OR: [{ logoAssetId: ids }, { bannerAssetId: ids }, { coverAssetId: ids }],
        },
        select: { logoAssetId: true, bannerAssetId: true, coverAssetId: true },
      }),
      db.competitionSuggestionAsset.findMany({
        where: { assetId: ids },
        select: { assetId: true },
      }),
      db.project.findMany({
        where: { OR: [{ logoAssetId: ids }, { coverAssetId: ids }] },
        select: { logoAssetId: true, coverAssetId: true },
      }),
      db.portfolio.findMany({
        where: { resumeAssetId: ids },
        select: { resumeAssetId: true },
      }),
      db.portfolioEducation.findMany({
        where: { institutionLogoAssetId: ids },
        select: { institutionLogoAssetId: true },
      }),
      db.portfolioExperience.findMany({
        where: { companyLogoAssetId: ids },
        select: { companyLogoAssetId: true },
      }),
      db.portfolioAchievement.findMany({
        where: { assetId: ids },
        select: { assetId: true },
      }),
      db.portfolioCertification.findMany({
        where: { assetId: ids },
        select: { assetId: true },
      }),
      db.testimonial.findMany({
        where: { imageAssetId: ids },
        select: { imageAssetId: true },
      }),
      db.badge.findMany({
        where: { iconAssetId: ids },
        select: { iconAssetId: true },
      }),
      db.technology.findMany({
        where: { iconAssetId: ids },
        select: { iconAssetId: true },
      }),
    ]);

    for (const user of users) {
      const seen = new Set<string>();
      record(user.avatarAssetId, "User", "avatar");
      record(user.coverAssetId, "User", "cover");
      recordEntityOnce(user.avatarAssetId, seen);
      recordEntityOnce(user.coverAssetId, seen);
    }

    for (const competition of competitions) {
      const seen = new Set<string>();
      record(competition.logoAssetId, "Competition", "logo");
      record(competition.bannerAssetId, "Competition", "banner");
      record(competition.coverAssetId, "Competition", "cover");
      recordEntityOnce(competition.logoAssetId, seen);
      recordEntityOnce(competition.bannerAssetId, seen);
      recordEntityOnce(competition.coverAssetId, seen);
    }

    for (const row of suggestionAssets) {
      record(row.assetId, "Competition suggestion", "gallery");
      recordEntityOnce(row.assetId, new Set());
    }

    for (const project of projects) {
      const seen = new Set<string>();
      record(project.logoAssetId, "Project", "logo");
      record(project.coverAssetId, "Project", "cover");
      recordEntityOnce(project.logoAssetId, seen);
      recordEntityOnce(project.coverAssetId, seen);
    }

    for (const row of portfolios) {
      record(row.resumeAssetId, "Portfolio", "resume");
      recordEntityOnce(row.resumeAssetId, new Set());
    }

    for (const row of educations) {
      record(row.institutionLogoAssetId, "Education", "institution logo");
      recordEntityOnce(row.institutionLogoAssetId, new Set());
    }

    for (const row of experiences) {
      record(row.companyLogoAssetId, "Experience", "company logo");
      recordEntityOnce(row.companyLogoAssetId, new Set());
    }

    for (const row of achievements) {
      record(row.assetId, "Achievement", "asset");
      recordEntityOnce(row.assetId, new Set());
    }

    for (const row of certifications) {
      record(row.assetId, "Certification", "asset");
      recordEntityOnce(row.assetId, new Set());
    }

    for (const row of testimonials) {
      record(row.imageAssetId, "Testimonial", "image");
      recordEntityOnce(row.imageAssetId, new Set());
    }

    for (const row of badges) {
      record(row.iconAssetId, "Badge", "icon");
      recordEntityOnce(row.iconAssetId, new Set());
    }

    for (const row of technologies) {
      record(row.iconAssetId, "Technology", "icon");
      recordEntityOnce(row.iconAssetId, new Set());
    }

    return reports;
  }
}
