export type ProjectAssetSlot = "logo" | "cover";

const PROJECT_ASSET_SLOTS: readonly ProjectAssetSlot[] = ["logo", "cover"];

export function isProjectAssetSlot(value: string): value is ProjectAssetSlot {
  return (PROJECT_ASSET_SLOTS as readonly string[]).includes(value);
}
