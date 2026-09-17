import { z } from "zod";

import { NotificationIntent } from "@/generated/prisma";

/**
 * Deliberately `.strict()` and, just as deliberately, has no `userId` field
 * — the actor making the request is always the subject
 * (`SessionService.getStrictActor` supplies it in the controller), so a
 * client cannot ask to update another user's preference even by
 * omission-then-guessing; the field does not exist to omit.
 */
export const UpdateNotificationPreferenceSchema = z
  .object({
    intent: z.nativeEnum(NotificationIntent),
    enabled: z.boolean(),
  })
  .strict();

export type UpdateNotificationPreferenceInput = z.infer<
  typeof UpdateNotificationPreferenceSchema
>;
