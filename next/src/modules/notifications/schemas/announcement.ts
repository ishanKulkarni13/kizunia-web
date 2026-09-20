import { z } from "zod";

import {
  ANNOUNCEMENT_URL_MESSAGE,
  isSafeAnnouncementUrl,
} from "../content/announcement-url";

/**
 * The announcement link.
 *
 * The only notification content a human authors, and therefore the only place
 * an unsafe destination could enter the system. A notification is somewhere the
 * platform sends a user who trusts it, so this is a whitelist:
 *
 *  - an `https` URL, or
 *  - a path inside Kizunia.
 *
 * `http` is refused along with everything else. A platform notification linking
 * to a plaintext page is not a capability worth having, and permitting one
 * scheme "because it is common" is how `javascript:` eventually gets through a
 * blacklist.
 */
const AnnouncementUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(isSafeAnnouncementUrl, { message: ANNOUNCEMENT_URL_MESSAGE });

export const CreateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(500),
    /** Optional — an announcement with nothing to link to is legitimate. */
    url: AnnouncementUrl.optional(),
    /**
     * When it should be delivered. Absent means now — "send it now" is a
     * schedule time of now, not a separate path (ND-I-22).
     */
    scheduledFor: z.coerce.date().optional(),
  })
  .strict();

export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;

export const ListAnnouncementsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
