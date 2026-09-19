import { z } from "zod";

import { AssetPurpose } from "@/generated/prisma";

export const CreateUploadIntentSchema = z.object({
  purpose: z.nativeEnum(AssetPurpose),

  targetEntityType: z.string().trim().min(1).optional(),

  targetEntityId: z.string().trim().min(1).optional(),

  // Declared only — never trusted as the truth. The provider's confirmed
  // result is what finalization actually validates against (see
  // upload-intent.service.ts and security.md).
  declaredMimeType: z.string().trim().min(1),

  declaredSize: z.number().int().positive(),
});

export type CreateUploadIntentInput = z.infer<typeof CreateUploadIntentSchema>;
