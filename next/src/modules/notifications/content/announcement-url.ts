/**
 * Notifications — Announcement Link Safety
 *
 * Pure. One definition of "a link an announcement may carry", shared by the
 * request schema and the service.
 *
 * ## Why this is not just a zod refinement
 *
 * The repository's convention is that validation happens in the controller, and
 * for ordinary input that is right — the service can trust what it is handed.
 *
 * This field is the exception, and for a specific reason: it is the only
 * notification content a human authors, so it is the only place an attacker-
 * influenced destination could enter a message the platform sends on its own
 * authority. Anything that can write an announcement can phish every user at
 * once.
 *
 * The HTTP path is not the only way to write one. A seed script, an internal
 * tool, a future admin action, a test — each is a caller that does not pass
 * through the schema. So the rule lives here, and both layers call it: the
 * schema for a good error message at the edge, the service because it is the
 * last thing that runs before the database.
 *
 * Same reasoning as the `CHECK` constraint behind `actionPath`, one layer up.
 */

import { isSafeActionPath } from "./action-path";

/**
 * A whitelist, not a blacklist.
 *
 * `https` only — an announcement linking to a plaintext page is not a
 * capability worth having, and admitting one extra scheme "because it is
 * common" is how `javascript:` eventually gets through.
 */
export function isSafeAnnouncementUrl(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed === "") return false;

  // A path inside Kizunia.
  if (isSafeActionPath(trimmed)) return true;

  // Or an absolute https URL. `new URL` is the parser the browser will use, so
  // it is the right thing to agree with — a hand-rolled regex would disagree
  // with it in exactly the cases that matter.
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

export const ANNOUNCEMENT_URL_MESSAGE =
  "Link must be an https:// URL or a path inside Kizunia starting with /";
