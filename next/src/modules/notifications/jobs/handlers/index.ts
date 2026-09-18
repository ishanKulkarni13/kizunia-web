/**
 * The handler registry — the dispatch table the runner reads.
 *
 * Exhaustive over `NotificationJobKind` by its type, so a new job kind cannot
 * reach production without a handler. Without that, such a job would claim
 * successfully, find nothing to run, and fail every attempt before giving up —
 * a failure whose cause is invisible from its symptom.
 *
 * A lookup, not a chain of conditionals: adding a kind means adding a file and
 * a line here, never editing a growing `switch` that every other kind also
 * passes through (principle 5).
 */
import type { JobHandlerRegistry } from "../handler";
import { deliverNotificationHandler } from "./deliver-notification.handler";
import { evaluateRegistrationClosingHandler } from "./evaluate-registration-closing.handler";
import { evaluateTopRelevantCompetitionHandler } from "./evaluate-top-relevant-competition.handler";
import { fanoutAnnouncementHandler } from "./fanout-announcement.handler";
import { notifyAdminsOfSuggestionHandler } from "./notify-admins-of-suggestion.handler";

export const notificationJobHandlers: JobHandlerRegistry = {
  EVALUATE_TOP_RELEVANT_COMPETITION: evaluateTopRelevantCompetitionHandler,
  EVALUATE_REGISTRATION_CLOSING: evaluateRegistrationClosingHandler,
  FANOUT_ANNOUNCEMENT: fanoutAnnouncementHandler,
  NOTIFY_ADMINS_OF_SUGGESTION: notifyAdminsOfSuggestionHandler,
  DELIVER_NOTIFICATION: deliverNotificationHandler,
};
