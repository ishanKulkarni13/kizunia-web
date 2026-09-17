import { NotificationIntent } from "@/generated/prisma";

import { NotificationPreferenceRepository } from "./notification-preference.repository";
import type { NotificationPreferenceDTO } from "../types/notification-preference.dto";

/**
 * Default state for an intent with no row yet. Opt-in, not opt-out: a user
 * who has never touched this setting receives nothing until they turn it
 * on. Keyed by every `NotificationIntent` member so adding a new intent
 * forces a deliberate default here rather than silently inheriting one.
 */
const DEFAULT_ENABLED: Readonly<Record<NotificationIntent, boolean>> = {
  [NotificationIntent.TOP_RELEVANT_COMPETITION]: false,
};

export class NotificationPreferenceService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Fill in the default state for intents with no row yet
   * ✓ Repository orchestration
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate or authorize users
   * ✗ Query Prisma directly
   */

  /**
   * Returns every known intent's current state for this user — an intent
   * with no row is reported at its default, not omitted, so a client never
   * has to special-case "missing" versus "explicitly set".
   */
  static async getForUser(userId: string): Promise<NotificationPreferenceDTO[]> {
    const rows = await NotificationPreferenceRepository.findByUser(userId);
    const enabledByIntent = new Map(rows.map((row) => [row.intent, row.enabled]));

    return Object.values(NotificationIntent).map((intent) => ({
      intent,
      enabled: enabledByIntent.get(intent) ?? DEFAULT_ENABLED[intent],
    }));
  }

  static async update(
    userId: string,
    intent: NotificationIntent,
    enabled: boolean,
  ): Promise<NotificationPreferenceDTO> {
    await NotificationPreferenceRepository.upsert(userId, intent, enabled);

    return { intent, enabled };
  }
}
