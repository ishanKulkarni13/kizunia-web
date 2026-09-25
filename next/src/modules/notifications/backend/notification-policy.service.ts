/**
 * Notifications — Policy Service
 *
 * Business Layer
 *
 * The seam between Phase 0 and Phase 1. It gathers the two inputs the policy
 * needs — the user's notification preference and the recommendation engine's
 * output — and hands them to a pure decision function. It adds no rules of
 * its own; every rule lives in `policy/`, where it is testable without a
 * database.
 *
 * Responsibilities
 * ----------------
 * ✓ Establish "now" once per evaluation
 * ✓ Read the intent's enabled state, the user's entitlement to it, and
 *   relevance from the Phase 0 engine
 * ✓ Delegate the decision to the policy and return its verdict unchanged
 *
 * Does NOT
 * ----------------
 * ✗ Compute relevance, scoring, ranking or eligibility
 * ✗ Query Prisma directly
 * ✗ Create, store, queue or deliver a notification — that layer does not
 *   exist yet, and this service stops at the decision
 */
import { NotificationIntent } from "@/generated/prisma";
import { NotificationPreferenceService } from "@/modules/preferences/backend/notification-preference.service";
import { RecommendationService } from "@/modules/recommendations/backend/recommendation.service";

import { evaluateTopRelevantCompetition } from "../policy/top-relevant-competition.policy";
import { isEntitledToIntent } from "./notification-entitlement";
import type { NotificationDecision } from "../policy/types";

export class NotificationPolicyService {
  /**
   * `userId -> should we notify them about their top relevant competition?`
   *
   * Returns a decision, not a notification. Producing and delivering one is a
   * later layer's job.
   */
  static async evaluateTopRelevantCompetition(
    userId: string,
    evaluatedAt?: Date,
  ): Promise<NotificationDecision> {
    // A scheduled evaluation supplies its own anchor, frozen when the work was
    // scheduled (ND-D-07), so a retry reproduces the same decision rather than
    // a fresh one. The default keeps the existing manual/internal callers
    // working unchanged.
    const now = evaluatedAt ?? new Date();
    const enabled = await this.isIntentEnabled(
      userId,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
    );

    // Short-circuit: running the engine for a user who has opted out would be
    // work whose result is discarded. The policy checks `enabled` before it
    // reads `recommendations`, so the empty array below is never observable.
    if (!enabled) {
      return evaluateTopRelevantCompetition({
        userId,
        enabled: false,
        entitled: false,
        recommendations: [],
        now,
      });
    }

    // Re-check of the scheduler's entitlement filter (IB-2): access may have
    // been lost since the work was scheduled. Asked of the current clock, not
    // the frozen anchor. The engine is not run for a user who is not
    // entitled; the engine itself is never gated.
    const entitled = await isEntitledToIntent(
      userId,
      NotificationIntent.TOP_RELEVANT_COMPETITION,
    );

    if (!entitled) {
      return evaluateTopRelevantCompetition({
        userId,
        enabled: true,
        entitled: false,
        recommendations: [],
        now,
      });
    }

    // Engine defaults only. Threshold/topN/dimension overrides belong to the
    // internal tuning route, not to a production notification evaluation.
    const result = await RecommendationService.generateForUser({ userId });

    return evaluateTopRelevantCompetition({
      userId,
      enabled: true,
      entitled: true,
      recommendations: result.items,
      now,
    });
  }

  /**
   * Delegated rather than read here: the preference service owns what an
   * unset intent defaults to, and a second copy of that rule in the policy
   * layer would be free to disagree with it.
   */
  private static async isIntentEnabled(
    userId: string,
    intent: NotificationIntent,
  ): Promise<boolean> {
    return NotificationPreferenceService.isEnabledForUser(userId, intent);
  }
}
