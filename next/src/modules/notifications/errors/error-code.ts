export const NotificationErrorCode = {
  NOT_FOUND: "NOTIFICATION_NOT_FOUND",

  PUSH_SUBSCRIPTION_NOT_FOUND: "PUSH_SUBSCRIPTION_NOT_FOUND",

  ANNOUNCEMENT_NOT_FOUND: "FEATURE_ANNOUNCEMENT_NOT_FOUND",

  /**
   * An announcement whose fan-out has started or finished cannot be edited or
   * re-scheduled. Cancelling it stops further fan-out, but the notifications
   * already created stay — they are history (ND-H-02).
   */
  ANNOUNCEMENT_NOT_EDITABLE: "FEATURE_ANNOUNCEMENT_NOT_EDITABLE",

  /**
   * A notification's action must be a path inside Kizunia. Also enforced by a
   * CHECK constraint in the migration: this code is what the user sees, the
   * constraint is what stops a future write path that forgets to validate.
   */
  INVALID_ACTION_PATH: "NOTIFICATION_INVALID_ACTION_PATH",

  /** An announcement link that is neither an https URL nor a site-relative path. */
  INVALID_ANNOUNCEMENT_URL: "FEATURE_ANNOUNCEMENT_INVALID_URL",

  /**
   * A job payload that does not match the schema for its kind. Job payloads
   * cross a raw-SQL boundary, where the generated client's type safety does
   * not reach, so they are re-validated on the way out.
   */
  INVALID_JOB_PAYLOAD: "NOTIFICATION_INVALID_JOB_PAYLOAD",
} as const;

export type NotificationErrorCode =
  (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];
