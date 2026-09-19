import { z } from "zod";

// Deliberately minimal: only enough to correlate the completed provider
// upload with its UploadIntent. Never a client-controlled Asset object —
// see docs/architecture/domain/assets/upload.md and security.md.
export const FinalizeUploadSchema = z.object({
  intentId: z.string().trim().min(1),
});

export type FinalizeUploadInput = z.infer<typeof FinalizeUploadSchema>;
