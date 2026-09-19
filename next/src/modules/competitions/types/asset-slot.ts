export type CompetitionAssetSlot =
  | "logo"
  | "banner"
  | "cover";

const COMPETITION_ASSET_SLOTS: readonly CompetitionAssetSlot[] = [
  "logo",
  "banner",
  "cover",
];

export function isCompetitionAssetSlot(
  value: string,
): value is CompetitionAssetSlot {
  return (COMPETITION_ASSET_SLOTS as readonly string[]).includes(value);
}
