/**
 * Notifications module — public API. Import from this file, not from
 * `backend/`, outside this module.
 *
 * `backend/` is NOT re-exported here. It imports the recommendation and
 * preference services, which reach `@/lib/prisma` and `next/server`
 * transitively, and this barrel must stay safe to import from a client
 * component. Server-side consumers deep-import
 * `@/modules/notifications/backend/...` directly — the same convention
 * `modules/preferences` and `modules/recommendations` establish.
 */

export {
  evaluateTopRelevantCompetition,
  type TopRelevantCompetitionInput,
} from "./policy/top-relevant-competition.policy";

export type {
  NotificationDecision,
  NotificationSubject,
  NotificationSuppressionReason,
} from "./policy/types";
