import { describe, expect, it } from "vitest";

import { NotificationIntent, NotificationJobKind } from "@/generated/prisma";

import {
  adminSuggestionOccurrenceKey,
  announcementOccurrenceKey,
  deadlineWindow,
  evaluationOccurrenceKey,
  jobDedupeKey,
  nextDailyRunAt,
  registrationClosingOccurrenceKey,
  topRelevantOccurrenceKey,
  utcDateKey,
} from "./occurrence";

const DAY_SECONDS = 24 * 60 * 60;

describe("occurrence keys", () => {
  it("identifies the discovery occasion by UTC day", () => {
    expect(topRelevantOccurrenceKey(new Date("2026-09-17T13:00:00Z"))).toBe(
      "top:2026-09-17",
    );
  });

  it("gives the same key for any instant within one UTC day", () => {
    // The property the whole idempotency story rests on: a job retried four
    // hours later must resolve to the same occasion, or the unique constraint
    // it is supposed to collide with never sees a collision.
    const early = topRelevantOccurrenceKey(new Date("2026-09-17T00:00:00Z"));
    const late = topRelevantOccurrenceKey(new Date("2026-09-17T23:59:59Z"));

    expect(early).toBe(late);
  });

  it("gives a different key either side of UTC midnight", () => {
    expect(topRelevantOccurrenceKey(new Date("2026-09-17T23:59:59Z"))).not.toBe(
      topRelevantOccurrenceKey(new Date("2026-09-18T00:00:01Z")),
    );
  });

  it("keeps intents from colliding with each other on the same day", () => {
    // Different intents are independent (ND-H-07). Sharing a key would make
    // them deduplicate against one another, silently suppressing one.
    const anchor = new Date("2026-09-17T13:00:00Z");

    expect(topRelevantOccurrenceKey(anchor)).not.toBe(
      registrationClosingOccurrenceKey(anchor),
    );
  });

  it("identifies an announcement by itself, not by a date", () => {
    expect(announcementOccurrenceKey("abc123")).toBe("announcement:abc123");
  });

  it("refuses to invent a scheduled occasion for announcements", () => {
    expect(() =>
      evaluationOccurrenceKey(
        NotificationIntent.FEATURE_ANNOUNCEMENT,
        new Date(),
      ),
    ).toThrow(/no scheduled occurrence/);
  });

  it("refuses to invent a scheduled occasion for admin suggestion notices", () => {
    // Its occasion is a submission, discovered from the review queue, not a
    // date the scheduler can derive on its own.
    expect(() =>
      evaluationOccurrenceKey(
        NotificationIntent.ADMIN_COMPETITION_SUGGESTION,
        new Date(),
      ),
    ).toThrow(/no scheduled occurrence/);
  });

  it("identifies a suggestion notice by the suggestion and the instant it was submitted", () => {
    const submittedAt = new Date("2026-09-17T13:00:00Z");
    expect(adminSuggestionOccurrenceKey("sugg-1", submittedAt)).toBe(
      "suggestion:sugg-1:2026-09-17T13:00:00.000Z",
    );
  });

  it("treats a resubmission as a new occasion", () => {
    // ND-H-12's rule, applied to a suggestion instead of a deadline: a
    // suggestion resubmitted after changes are requested is genuinely back in
    // the queue, and admins have something to do again.
    const first = adminSuggestionOccurrenceKey(
      "sugg-1",
      new Date("2026-09-17T13:00:00Z"),
    );
    const resubmitted = adminSuggestionOccurrenceKey(
      "sugg-1",
      new Date("2026-09-20T09:00:00Z"),
    );

    expect(first).not.toBe(resubmitted);
  });

  it("keeps two different suggestions distinct even if submitted at the same instant", () => {
    const at = new Date("2026-09-17T13:00:00Z");
    expect(adminSuggestionOccurrenceKey("sugg-1", at)).not.toBe(
      adminSuggestionOccurrenceKey("sugg-2", at),
    );
  });

  it("routes each scheduled intent to its own occasion", () => {
    const anchor = new Date("2026-09-17T13:00:00Z");

    expect(
      evaluationOccurrenceKey(NotificationIntent.TOP_RELEVANT_COMPETITION, anchor),
    ).toBe("top:2026-09-17");
    expect(
      evaluationOccurrenceKey(NotificationIntent.REGISTRATION_CLOSING, anchor),
    ).toBe("closing:2026-09-17");
  });
});

describe("utcDateKey", () => {
  it("uses UTC rather than the host's local day", () => {
    // A server in Asia/Calcutta is five and a half hours ahead; without an
    // explicit UTC basis the day would roll over at a different instant on
    // every deployment.
    expect(utcDateKey(new Date("2026-09-17T22:30:00Z"))).toBe("2026-09-17");
  });
});

describe("deadlineWindow", () => {
  it("starts at the offset and is exactly one sweep interval wide", () => {
    const anchor = new Date("2026-09-17T13:00:00Z");

    const window = deadlineWindow(anchor, 2 * DAY_SECONDS, DAY_SECONDS);

    expect(window.start.toISOString()).toBe("2026-09-19T13:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-20T13:00:00.000Z");
  });

  it("tiles without gaps or overlap across consecutive sweeps", () => {
    // The correctness property. A gap means deadlines nobody is ever told
    // about; an overlap means every deadline is evaluated twice and
    // correctness rests entirely on deduplication.
    const first = new Date("2026-09-17T13:00:00Z");
    const second = new Date(first.getTime() + DAY_SECONDS * 1000);

    const a = deadlineWindow(first, 2 * DAY_SECONDS, DAY_SECONDS);
    const b = deadlineWindow(second, 2 * DAY_SECONDS, DAY_SECONDS);

    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it("widens with the sweep interval rather than staying fixed", () => {
    const anchor = new Date("2026-09-17T13:00:00Z");
    const hourly = deadlineWindow(anchor, 2 * DAY_SECONDS, 3600);

    expect(hourly.end.getTime() - hourly.start.getTime()).toBe(3600 * 1000);
  });
});

describe("nextDailyRunAt", () => {
  it("schedules later the same day when the hour has not passed", () => {
    expect(
      nextDailyRunAt(new Date("2026-09-17T09:00:00Z"), 13).toISOString(),
    ).toBe("2026-09-17T13:00:00.000Z");
  });

  it("schedules tomorrow when the hour has passed", () => {
    expect(
      nextDailyRunAt(new Date("2026-09-17T18:00:00Z"), 13).toISOString(),
    ).toBe("2026-09-18T13:00:00.000Z");
  });

  it("schedules tomorrow when called exactly on the hour", () => {
    // Strictly-after, so a scheduler running at 13:00 schedules tomorrow's run
    // rather than re-scheduling the one it is currently part of.
    expect(
      nextDailyRunAt(new Date("2026-09-17T13:00:00Z"), 13).toISOString(),
    ).toBe("2026-09-18T13:00:00.000Z");
  });

  it("rolls over month and year boundaries", () => {
    expect(
      nextDailyRunAt(new Date("2026-12-31T18:00:00Z"), 13).toISOString(),
    ).toBe("2027-01-01T13:00:00.000Z");
  });
});

describe("jobDedupeKey", () => {
  it("combines kind, scope and occasion into one identity", () => {
    expect(
      jobDedupeKey(
        NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
        "user-1",
        "top:2026-09-17",
      ),
    ).toBe("EVALUATE_TOP_RELEVANT_COMPETITION:user-1:top:2026-09-17");
  });

  it("keeps two users' work distinct", () => {
    const forUser = (id: string) =>
      jobDedupeKey(
        NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
        id,
        "top:2026-09-17",
      );

    expect(forUser("user-1")).not.toBe(forUser("user-2"));
  });

  it("keeps two kinds of work distinct for the same user and day", () => {
    expect(
      jobDedupeKey(
        NotificationJobKind.EVALUATE_TOP_RELEVANT_COMPETITION,
        "user-1",
        "top:2026-09-17",
      ),
    ).not.toBe(
      jobDedupeKey(
        NotificationJobKind.EVALUATE_REGISTRATION_CLOSING,
        "user-1",
        "closing:2026-09-17",
      ),
    );
  });
});
