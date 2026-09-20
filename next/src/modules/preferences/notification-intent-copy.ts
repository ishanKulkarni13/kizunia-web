import type { NotificationIntent } from "@/generated/prisma";

/**
 * User-facing copy for each notification intent.
 *
 * Keyed exhaustively by `NotificationIntent`, so adding an intent is a compile
 * error here. That is the point: an intent that reaches the preferences page
 * without copy would render as a raw enum name, and a toggle a user cannot
 * understand is worse than one that does not exist yet.
 *
 * Client-safe — types only, no Prisma runtime import.
 */
export interface NotificationIntentCopy {
  readonly label: string;
  readonly description: string;
}

export const NOTIFICATION_INTENT_COPY: Readonly<
  Record<NotificationIntent, NotificationIntentCopy>
> = {
  TOP_RELEVANT_COMPETITION: {
    label: "Competition recommendations",
    description:
      "When Kizunia finds a competition that closely matches your interests, you will hear about it. At most one a day, and nothing at all on days when nothing is a good enough match.",
  },
  REGISTRATION_CLOSING: {
    label: "Registration closing soon",
    description:
      "A reminder roughly two days before registration closes on competitions you have saved or that match your interests. Competitions you have marked as registered are left out.",
  },
  FEATURE_ANNOUNCEMENT: {
    label: "Kizunia announcements",
    description:
      "Occasional updates about new features and changes to the platform. Infrequent, and never promotional.",
  },
  ADMIN_COMPETITION_SUGGESTION: {
    label: "New competition suggestions",
    description:
      "When someone submits a competition suggestion, you will hear about it shortly afterwards — not immediately, so suggestions withdrawn or reviewed in the meantime stay quiet. Only shown to reviewers.",
  },
};

/**
 * The order intents are presented in. Not alphabetical and not enum order —
 * most frequent first, platform news last, which is roughly how much attention
 * each deserves.
 *
 * The operational intent sits at the end because most people reading this page
 * will never see it: the API returns only the intents that apply to the caller
 * (`notifications/policy/intent-audience.ts`), so for all but reviewers this
 * entry is ordering for a row that is never rendered.
 */
export const NOTIFICATION_INTENT_ORDER: readonly NotificationIntent[] = [
  "TOP_RELEVANT_COMPETITION",
  "REGISTRATION_CLOSING",
  "FEATURE_ANNOUNCEMENT",
  "ADMIN_COMPETITION_SUGGESTION",
];
