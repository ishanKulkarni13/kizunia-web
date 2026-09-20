import { describe, expect, it } from "vitest";

import { PlatformAction } from "@/authorization/platform/actions";
import { NotificationIntent } from "@/generated/prisma";

import { isIntentVisibleTo } from "./intent-audience";

describe("isIntentVisibleTo", () => {
  it("is visible to everyone for an intent with no required action", () => {
    expect(
      isIntentVisibleTo(NotificationIntent.TOP_RELEVANT_COMPETITION, new Set()),
    ).toBe(true);
    expect(
      isIntentVisibleTo(NotificationIntent.FEATURE_ANNOUNCEMENT, new Set()),
    ).toBe(true);
  });

  it("hides the operational intent from an actor without the review action", () => {
    expect(
      isIntentVisibleTo(
        NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        new Set([PlatformAction.CREATE_PROJECT]),
      ),
    ).toBe(false);
  });

  it("shows the operational intent to an actor who holds the review action", () => {
    expect(
      isIntentVisibleTo(
        NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        new Set([PlatformAction.REVIEW_COMPETITION_SUGGESTIONS]),
      ),
    ).toBe(true);
  });
});
