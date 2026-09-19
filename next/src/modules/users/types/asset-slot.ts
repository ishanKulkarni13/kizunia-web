export type UserAssetSlot = "avatar" | "cover";

const USER_ASSET_SLOTS: readonly UserAssetSlot[] = ["avatar", "cover"];

export function isUserAssetSlot(value: string): value is UserAssetSlot {
  return (USER_ASSET_SLOTS as readonly string[]).includes(value);
}
