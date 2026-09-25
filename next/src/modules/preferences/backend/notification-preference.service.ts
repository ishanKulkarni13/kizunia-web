import { PlatformAction } from "@/authorization/platform/actions";
import { PlatformPolicy } from "@/authorization/platform/policy";
import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { StrictAuthorizationActor } from "@/authorization";
import type { PlatformContext } from "@/authorization/platform/context";
import { NotificationIntent } from "@/generated/prisma";
import { ForbiddenError } from "@/lib/errors";
import { minimumPlanFor, resolveEffectiveAccess, type EffectiveAccess } from "@/lib/entitlements";
import { INTENT_REQUIRED_ACTION } from "@/modules/notifications/policy/intent-audience";
import { requiredCapabilityFor } from "@/modules/notifications/policy/intent-capability";

import { NotificationPreferenceRepository } from "./notification-preference.repository";
import type { NotificationPreferenceDTO } from "../types/notification-preference.dto";

/**
 * Default state for an intent with no row yet.
 *
 * The default is a property of the intent, not of the model (ND-P-16). Intents
 * driven by inference about the user are opt-in: computing what someone might
 * like and then messaging them about it should require consent. An
 * announcement is editorial, infrequent, and about the product the user chose
 * to use, so it defaults on — off by default would produce a channel nobody
 * receives until they find a setting they had no reason to look for.
 *
 * The admin suggestion notice defaults on for a third reason again: it is
 * operational. Someone holding the review permission is being told that work
 * has arrived in a queue they are responsible for, and a reviewer who never
 * visited their notification settings should still hear about it. Opting out
 * remains possible, and is the point of it having a setting at all.
 *
 * Keyed by every `NotificationIntent` member, so adding an intent is a compile
 * error here rather than a silent inheritance of whatever the last default was.
 */
const DEFAULT_ENABLED: Readonly<Record<NotificationIntent, boolean>> = {
  [NotificationIntent.TOP_RELEVANT_COMPETITION]: false,
  [NotificationIntent.REGISTRATION_CLOSING]: false,
  [NotificationIntent.FEATURE_ANNOUNCEMENT]: true,
  [NotificationIntent.ADMIN_COMPETITION_SUGGESTION]: true,
};

export class NotificationPreferenceService {
  /**
   * Business Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Fill in the default state for intents with no row yet
   * ✓ Restrict the intent list to those that apply to this actor
   * ✓ Report, per intent, whether the actor is currently entitled to it
   * ✓ Repository orchestration
   *
   * Does NOT
   * ----------------
   * ✗ Parse HTTP requests
   * ✗ Authenticate users
   * ✗ Query Prisma directly
   */

  /**
   * Every intent that applies to this actor, at its current state.
   *
   * An intent with no row is reported at its default, not omitted, so a client
   * never has to special-case "missing" versus "explicitly set".
   *
   * **Not every intent applies to everyone.** Most do — a notification about
   * your own interests has an audience of you — but an operational intent is
   * addressed to whoever holds a capability, and listing it for someone who
   * does not would offer a switch that controls nothing: the recipient query
   * would never select them whichever way it was set
   * (`notifications/policy/intent-audience.ts`).
   */
  static async getForUser(
    actor: StrictAuthorizationActor,
  ): Promise<NotificationPreferenceDTO[]> {
    const [context, rows, access] = await Promise.all([
      PlatformContextResolver.resolve(actor),
      NotificationPreferenceRepository.findByUser(actor.id),
      resolveEffectiveAccess(actor.id),
    ]);

    const enabledByIntent = new Map(rows.map((row) => [row.intent, row.enabled]));

    return Object.values(NotificationIntent)
      .filter((intent) => this.applies(context, intent))
      .map((intent) =>
        this.toDto(intent, enabledByIntent.get(intent) ?? DEFAULT_ENABLED[intent], access),
      );
  }

  /**
   * Whether one intent is on for one user.
   *
   * The question a background worker asks, and deliberately **not** phrased in
   * terms of an actor. A sweep has no actor: it is not acting on anyone's
   * behalf, and inventing a synthetic one to satisfy `getForUser` would push a
   * fake through the authorization layer to answer a question that is not about
   * authorization at all.
   *
   * It also does not apply the audience filter, and must not. Whether a
   * recipient is in an intent's audience has already been settled by whatever
   * selected them — the reviewer query, for the operational intent — and
   * re-deriving it here from a role lookup would answer a different question
   * with a second source of truth.
   *
   * A missing entry is `false`. That can only happen if the enum and this
   * service have drifted apart, and staying silent is the right failure: the
   * alternative is notifying on an assumption about consent.
   */
  static async isEnabledForUser(
    userId: string,
    intent: NotificationIntent,
  ): Promise<boolean> {
    const rows = await NotificationPreferenceRepository.findByUser(userId);
    const row = rows.find((candidate) => candidate.intent === intent);

    return row?.enabled ?? DEFAULT_ENABLED[intent] ?? false;
  }

  /**
   * Sets one intent's state for this actor.
   *
   * Refuses an intent the actor could not receive. Writing one would be inert
   * rather than dangerous — the recipient query is what decides who is told,
   * and it consults the permission set, not this table — but a stored
   * preference for a notification you cannot be sent is a lie the next reader
   * of the table has to work out, and a write path that accepts values the read
   * path never returns is a gap someone will eventually walk through.
   *
   * Entitlement is deliberately NOT a reason to refuse (IB-16). A preference
   * says what the user wants; an entitlement says what their plan allows, and
   * only delivery depends on it. A Free user may switch a Pro+ intent on, the
   * choice is stored, and it takes effect the moment they are entitled — with
   * no second step. The returned DTO says whether it currently applies.
   */
  static async update(
    actor: StrictAuthorizationActor,
    intent: NotificationIntent,
    enabled: boolean,
  ): Promise<NotificationPreferenceDTO> {
    const context = await PlatformContextResolver.resolve(actor);

    if (!this.applies(context, intent)) {
      throw new ForbiddenError({
        code: "NOTIFICATION_INTENT_NOT_APPLICABLE",
        message: "This notification setting does not apply to your account.",
      });
    }

    await NotificationPreferenceRepository.upsert(actor.id, intent, enabled);

    return this.toDto(intent, enabled, await resolveEffectiveAccess(actor.id));
  }

  /**
   * The preference plus the server-computed entitlement flags for it. The
   * capability an intent needs comes from the notification module's map, the
   * answer from `lib/entitlements` — no plan names are compared here.
   */
  private static toDto(
    intent: NotificationIntent,
    enabled: boolean,
    access: EffectiveAccess,
  ): NotificationPreferenceDTO {
    const capability = requiredCapabilityFor(intent);

    return {
      intent,
      enabled,
      entitled: capability === null || access.capabilities[capability],
      requiredPlan: capability === null ? null : minimumPlanFor(capability),
    };
  }

  /**
   * Whether an intent is in this actor's audience.
   *
   * Delegates the capability question to `PlatformPolicy` rather than reading
   * the permission set directly, so an intent's audience is evaluated by the
   * same path as every other authorization decision — including the banned-user
   * check, which a raw set lookup would skip.
   */
  private static applies(
    context: PlatformContext,
    intent: NotificationIntent,
  ): boolean {
    const required: PlatformAction | undefined = INTENT_REQUIRED_ACTION[intent];

    if (required === undefined) return true;

    return PlatformPolicy.can(context, required).allowed;
  }
}

/**
 * Re-exported so tests and any future server-side consumer can assert against
 * the per-intent defaults without restating them.
 */
export { DEFAULT_ENABLED as NOTIFICATION_INTENT_DEFAULTS };
