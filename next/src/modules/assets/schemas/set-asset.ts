import { z } from "zod";

// Shared by every domain's "attach an existing, finalized Asset to a slot"
// endpoint (Competition logo/banner/cover, Project logo/cover, ...). Only an
// id — never a client-controlled Asset object. `assetId: null` clears the
// slot (detaching, not deleting, the previously attached Asset) for domains
// that implement clearing. See docs/architecture/domain/assets/upload.md.
export const SetAssetSchema = z.object({
  assetId: z.string().cuid().nullable(),
});

export type SetAssetInput = z.infer<typeof SetAssetSchema>;
