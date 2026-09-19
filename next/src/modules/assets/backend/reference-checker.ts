import type { Prisma, PrismaClient } from "@/generated/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Counts references to an Asset across every explicit, named relation that
 * can point at one.
 *
 * There is deliberately no polymorphic `assetableType`/`assetableId`
 * relation (see docs/architecture/domain/assets/overview.md), so there is no
 * single generic query for "is this Asset referenced anywhere" — each known
 * relation has to be checked individually. This is the enumeration that
 * makes "Assets may be shared" and "DETACHED means no valid references
 * remain" both true at once: an Asset is only detached once every one of
 * these comes back zero.
 */
export class AssetReferenceChecker {
  static async countReferences(db: Db, assetId: string): Promise<number> {
    const counts = await Promise.all([
      db.user.count({
        where: { OR: [{ avatarAssetId: assetId }, { coverAssetId: assetId }] },
      }),
      db.competition.count({
        where: {
          OR: [
            { logoAssetId: assetId },
            { bannerAssetId: assetId },
            { coverAssetId: assetId },
          ],
        },
      }),
      db.competitionSuggestionAsset.count({ where: { assetId } }),
      db.project.count({
        where: { OR: [{ logoAssetId: assetId }, { coverAssetId: assetId }] },
      }),
      db.portfolio.count({ where: { resumeAssetId: assetId } }),
      db.portfolioEducation.count({ where: { institutionLogoAssetId: assetId } }),
      db.portfolioExperience.count({ where: { companyLogoAssetId: assetId } }),
      db.portfolioAchievement.count({ where: { assetId } }),
      db.portfolioCertification.count({ where: { assetId } }),
      db.testimonial.count({ where: { imageAssetId: assetId } }),
      db.badge.count({ where: { iconAssetId: assetId } }),
      db.technology.count({ where: { iconAssetId: assetId } }),
    ]);

    return counts.reduce((total, count) => total + count, 0);
  }
}
