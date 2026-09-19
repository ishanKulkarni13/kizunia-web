/**
 * Standing regression suite for the pure Competition lifecycle resolver
 * (`src/modules/competitions/lifecycle/resolver.ts`).
 *
 * No database is touched. `resolveAutomaticStatus` / `evaluateLifecycle` have
 * no I/O — every case below is a table-driven assertion against the function
 * itself, exercising the exact matrix required by the feature specification:
 * missing-date behaviour, lifecycle jumps, REGISTRATION_OPEN's priority over
 * ONGOING, CANCELLED's immutability under automation, and exact boundary
 * instants.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-competition-lifecycle.ts
 *
 * Invariants asserted:
 *   - UPCOMING with no relevant dates leaves status unchanged
 *   - registrationStartDate reached / not reached / null, in isolation
 *   - REGISTRATION_OPEN outranks ONGOING when registration is still open
 *     after the event has started
 *   - registrationDeadline reached -> REGISTRATION_CLOSED (when nothing
 *     later applies)
 *   - startDate reached -> ONGOING, even with registrationStartDate null
 *   - endDate reached -> COMPLETED, unconditionally except CANCELLED
 *   - every individual missing date, and combinations, skip only their own
 *     rule
 *   - lifecycle jumps (UPCOMING -> ONGOING, REGISTRATION_CLOSED ->
 *     COMPLETED, UPCOMING -> COMPLETED) without visiting intermediate states
 *   - COMPLETED reachable from every earlier status
 *   - CANCELLED never automatically changes, across every date permutation
 *   - exact boundary instants (now === date) for all four dates
 *   - null status is automatable; a dateless null-status row stays null
 *   - backward transitions (ONGOING -> UPCOMING) when dates move
 *   - determinism: identical input always yields identical output
 */

import {
  resolveAutomaticStatus,
  evaluateLifecycle,
  LifecycleReason,
  type LifecycleInput,
} from "../src/modules/competitions/lifecycle/resolver";
import type { CompetitionStatus } from "../src/generated/prisma";

let failures = 0;
let checks = 0;

function report(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

// =============================================================================
// Fixtures
// =============================================================================

const NOW = new Date("2026-06-15T12:00:00.000Z");

function daysFromNow(offset: number): Date {
  return new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);
}

const PAST_10 = daysFromNow(-10);
const PAST_5 = daysFromNow(-5);
const PAST_1 = daysFromNow(-1);
const FUTURE_1 = daysFromNow(1);
const FUTURE_5 = daysFromNow(5);
const FUTURE_10 = daysFromNow(10);

function input(overrides: Partial<LifecycleInput>): LifecycleInput {
  return {
    now: NOW,
    currentStatus: null,
    registrationStartDate: null,
    registrationDeadline: null,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

interface Case {
  readonly label: string;
  readonly input: LifecycleInput;
  readonly expectedStatus: CompetitionStatus | null;
  readonly expectedReason: LifecycleReason;
}

function runCase(c: Case): void {
  const resolution = resolveAutomaticStatus(c.input);
  report(
    `${c.label} -> status`,
    resolution.status === c.expectedStatus,
    `expected ${c.expectedStatus}, got ${resolution.status}`,
  );
  report(
    `${c.label} -> reason`,
    resolution.reason === c.expectedReason,
    `expected ${c.expectedReason}, got ${resolution.reason}`,
  );
}

// =============================================================================
// 1-3. registrationStartDate reached / not reached / null
// =============================================================================

function verifyRegistrationStartDate(): void {
  console.log("\nregistrationStartDate: reached / not reached / null");

  runCase({
    label: "reached, no deadline -> REGISTRATION_OPEN",
    input: input({ currentStatus: "UPCOMING", registrationStartDate: PAST_1 }),
    expectedStatus: "REGISTRATION_OPEN",
    expectedReason: LifecycleReason.REGISTRATION_WINDOW_OPEN,
  });

  runCase({
    label: "not reached -> falls through to UPCOMING",
    input: input({ currentStatus: "UPCOMING", registrationStartDate: FUTURE_1 }),
    expectedStatus: "UPCOMING",
    expectedReason: LifecycleReason.AWAITING_FIRST_MILESTONE,
  });

  runCase({
    label: "null, no other dates -> unchanged (not 'always open')",
    input: input({ currentStatus: "UPCOMING", registrationStartDate: null }),
    expectedStatus: "UPCOMING",
    expectedReason: LifecycleReason.NO_LIFECYCLE_DATES,
  });

  runCase({
    label: "null, but startDate reached -> ONGOING regardless",
    input: input({
      currentStatus: "UPCOMING",
      registrationStartDate: null,
      startDate: PAST_1,
      endDate: FUTURE_5,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });
}

// =============================================================================
// 4. REGISTRATION_OPEN outranks ONGOING
// =============================================================================

function verifyRegistrationOpenPriority(): void {
  console.log("\nREGISTRATION_OPEN priority over ONGOING");

  runCase({
    label: "registered already, event started, deadline still ahead",
    input: input({
      currentStatus: "REGISTRATION_OPEN",
      registrationStartDate: PAST_5,
      registrationDeadline: FUTURE_1,
      startDate: PAST_1,
      endDate: FUTURE_10,
    }),
    expectedStatus: "REGISTRATION_OPEN",
    expectedReason: LifecycleReason.REGISTRATION_WINDOW_OPEN,
  });

  runCase({
    label: "same, but deadline has now passed -> ONGOING",
    input: input({
      currentStatus: "REGISTRATION_OPEN",
      registrationStartDate: PAST_5,
      registrationDeadline: PAST_1,
      startDate: PAST_1,
      endDate: FUTURE_10,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });
}

// =============================================================================
// 5-8. deadline / start / end reached
// =============================================================================

function verifyMilestones(): void {
  console.log("\nregistrationDeadline / startDate / endDate reached");

  runCase({
    label: "registrationDeadline reached, event not started -> REGISTRATION_CLOSED",
    input: input({
      currentStatus: "REGISTRATION_OPEN",
      registrationDeadline: PAST_1,
      startDate: FUTURE_5,
      endDate: FUTURE_10,
    }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.REGISTRATION_DEADLINE_PASSED,
  });

  runCase({
    label: "startDate reached -> ONGOING",
    input: input({
      currentStatus: "REGISTRATION_CLOSED",
      startDate: PAST_1,
      endDate: FUTURE_5,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });

  runCase({
    label: "endDate reached -> COMPLETED",
    input: input({
      currentStatus: "ONGOING",
      startDate: PAST_10,
      endDate: PAST_1,
    }),
    expectedStatus: "COMPLETED",
    expectedReason: LifecycleReason.END_DATE_PASSED,
  });
}

// =============================================================================
// 9-13. missing dates, individually and combined
// =============================================================================

function verifyMissingDates(): void {
  console.log("\nmissing dates — individual and combined");

  runCase({
    label: "missing registrationStartDate: other rules still evaluate",
    input: input({
      currentStatus: "UPCOMING",
      registrationStartDate: null,
      registrationDeadline: PAST_1,
      startDate: FUTURE_5,
      endDate: FUTURE_10,
    }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.REGISTRATION_DEADLINE_PASSED,
  });

  runCase({
    label: "missing registrationDeadline: REGISTRATION_OPEN never closes on its own",
    input: input({
      currentStatus: "REGISTRATION_OPEN",
      registrationStartDate: PAST_10,
      registrationDeadline: null,
      startDate: FUTURE_5,
      endDate: FUTURE_10,
    }),
    expectedStatus: "REGISTRATION_OPEN",
    expectedReason: LifecycleReason.REGISTRATION_WINDOW_OPEN,
  });

  runCase({
    label: "missing startDate: registration-closed persists until endDate",
    input: input({
      currentStatus: "REGISTRATION_CLOSED",
      registrationDeadline: PAST_5,
      startDate: null,
      endDate: FUTURE_10,
    }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.REGISTRATION_DEADLINE_PASSED,
  });

  runCase({
    label: "missing endDate: ONGOING never auto-completes",
    input: input({
      currentStatus: "ONGOING",
      startDate: PAST_5,
      endDate: null,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });

  runCase({
    label: "multiple missing (only startDate known, in future) -> UPCOMING",
    input: input({
      currentStatus: "UPCOMING",
      registrationStartDate: null,
      registrationDeadline: null,
      startDate: FUTURE_5,
      endDate: null,
    }),
    expectedStatus: "UPCOMING",
    expectedReason: LifecycleReason.AWAITING_FIRST_MILESTONE,
  });

  runCase({
    label: "all four missing -> unchanged",
    input: input({ currentStatus: "REGISTRATION_OPEN" }),
    expectedStatus: "REGISTRATION_OPEN",
    expectedReason: LifecycleReason.NO_LIFECYCLE_DATES,
  });
}

// =============================================================================
// 14-15. lifecycle jumps, COMPLETED from every earlier status
// =============================================================================

function verifyJumps(): void {
  console.log("\nlifecycle jumps");

  runCase({
    label: "UPCOMING -> ONGOING (skips registration states entirely)",
    input: input({
      currentStatus: "UPCOMING",
      startDate: PAST_1,
      endDate: FUTURE_10,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });

  runCase({
    label: "REGISTRATION_CLOSED -> COMPLETED",
    input: input({
      currentStatus: "REGISTRATION_CLOSED",
      registrationDeadline: PAST_10,
      startDate: PAST_5,
      endDate: PAST_1,
    }),
    expectedStatus: "COMPLETED",
    expectedReason: LifecycleReason.END_DATE_PASSED,
  });

  const priorStatuses: (CompetitionStatus | null)[] = [
    null,
    "UPCOMING",
    "REGISTRATION_OPEN",
    "REGISTRATION_CLOSED",
    "ONGOING",
  ];

  for (const prior of priorStatuses) {
    runCase({
      label: `${prior ?? "null"} -> COMPLETED once endDate has passed`,
      input: input({
        currentStatus: prior,
        registrationStartDate: PAST_10,
        registrationDeadline: PAST_5,
        startDate: PAST_5,
        endDate: PAST_1,
      }),
      expectedStatus: "COMPLETED",
      expectedReason: LifecycleReason.END_DATE_PASSED,
    });
  }
}

// =============================================================================
// 16. CANCELLED never automatically changes
// =============================================================================

function verifyCancelledImmutable(): void {
  console.log("\nCANCELLED is terminal for automation");

  const permutations: Partial<LifecycleInput>[] = [
    {},
    { registrationStartDate: PAST_5 },
    { registrationDeadline: PAST_1 },
    { startDate: PAST_1, endDate: FUTURE_5 },
    { endDate: PAST_1 },
    {
      registrationStartDate: PAST_10,
      registrationDeadline: PAST_5,
      startDate: PAST_1,
      endDate: FUTURE_10,
    },
    {
      registrationStartDate: PAST_10,
      registrationDeadline: PAST_5,
      startDate: PAST_5,
      endDate: PAST_1,
    },
  ];

  for (const [index, dates] of permutations.entries()) {
    runCase({
      label: `CANCELLED preserved, permutation ${index + 1}`,
      input: input({ currentStatus: "CANCELLED", ...dates }),
      expectedStatus: "CANCELLED",
      expectedReason: LifecycleReason.CANCELLED_PRESERVED,
    });
  }
}

// =============================================================================
// 17. exact boundary instants
// =============================================================================

function verifyBoundaries(): void {
  console.log("\nexact boundary instants (now === date)");

  runCase({
    label: "endDate === now -> COMPLETED (inclusive)",
    input: input({ currentStatus: "ONGOING", startDate: PAST_10, endDate: NOW }),
    expectedStatus: "COMPLETED",
    expectedReason: LifecycleReason.END_DATE_PASSED,
  });

  runCase({
    label: "registrationStartDate === now -> REGISTRATION_OPEN (inclusive)",
    input: input({ currentStatus: "UPCOMING", registrationStartDate: NOW }),
    expectedStatus: "REGISTRATION_OPEN",
    expectedReason: LifecycleReason.REGISTRATION_WINDOW_OPEN,
  });

  runCase({
    label: "registrationDeadline === now -> deadline is reached, not still open",
    input: input({
      currentStatus: "REGISTRATION_OPEN",
      registrationStartDate: PAST_5,
      registrationDeadline: NOW,
    }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.REGISTRATION_DEADLINE_PASSED,
  });

  runCase({
    label: "startDate === now -> ONGOING (inclusive)",
    input: input({ currentStatus: "UPCOMING", startDate: NOW, endDate: FUTURE_5 }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });

  // One instant before the boundary must not yet trigger.
  const justBefore = new Date(NOW.getTime() - 1);
  runCase({
    label: "endDate 1ms before now -> still COMPLETED (already passed)",
    input: input({ currentStatus: "ONGOING", startDate: PAST_10, endDate: justBefore }),
    expectedStatus: "COMPLETED",
    expectedReason: LifecycleReason.END_DATE_PASSED,
  });

  const justAfter = new Date(NOW.getTime() + 1);
  runCase({
    label: "endDate 1ms after now -> not yet COMPLETED",
    input: input({ currentStatus: "ONGOING", startDate: PAST_10, endDate: justAfter }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.START_DATE_REACHED,
  });
}

// =============================================================================
// null status, backward transitions, determinism
// =============================================================================

function verifyNullStatus(): void {
  console.log("\nnull status is automatable");

  runCase({
    label: "null status, dates imply UPCOMING -> UPCOMING (a real change)",
    input: input({ currentStatus: null, startDate: FUTURE_5 }),
    expectedStatus: "UPCOMING",
    expectedReason: LifecycleReason.AWAITING_FIRST_MILESTONE,
  });

  runCase({
    label: "null status, no dates -> stays null",
    input: input({ currentStatus: null }),
    expectedStatus: null,
    expectedReason: LifecycleReason.NO_LIFECYCLE_DATES,
  });

  const evaluation = evaluateLifecycle(
    input({ currentStatus: null, startDate: PAST_1, endDate: FUTURE_5 }),
  );
  report(
    "null -> ONGOING is reported as changed",
    evaluation.changed === true && evaluation.status === "ONGOING",
    JSON.stringify(evaluation),
  );

  const unchanged = evaluateLifecycle(input({ currentStatus: null }));
  report(
    "null -> null (no dates) is reported as unchanged",
    unchanged.changed === false,
    JSON.stringify(unchanged),
  );
}

function verifyBackwardTransitions(): void {
  console.log("\nbackward transitions");

  // ONGOING today because startDate was in the past; startDate is then
  // edited into the future — status must move back to UPCOMING.
  const wasOngoing = evaluateLifecycle(
    input({ currentStatus: "ONGOING", startDate: FUTURE_5, endDate: FUTURE_10 }),
  );
  report(
    "ONGOING -> UPCOMING after startDate is pushed into the future",
    wasOngoing.status === "UPCOMING" && wasOngoing.changed === true,
    JSON.stringify(wasOngoing),
  );

  // REGISTRATION_CLOSED reverts to REGISTRATION_OPEN if the deadline is
  // extended back into the future.
  const wasClosed = evaluateLifecycle(
    input({
      currentStatus: "REGISTRATION_CLOSED",
      registrationStartDate: PAST_5,
      registrationDeadline: FUTURE_5,
    }),
  );
  report(
    "REGISTRATION_CLOSED -> REGISTRATION_OPEN after deadline extended",
    wasClosed.status === "REGISTRATION_OPEN" && wasClosed.changed === true,
    JSON.stringify(wasClosed),
  );
}

function verifyAmbiguousLifecycleData(): void {
  console.log("\nAMBIGUOUS_LIFECYCLE_DATA vs NO_LIFECYCLE_DATES");

  runCase({
    label: "ONGOING, startDate null, future endDate -> stays ONGOING (ambiguous)",
    input: input({
      currentStatus: "ONGOING",
      startDate: null,
      endDate: FUTURE_5,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.AMBIGUOUS_LIFECYCLE_DATA,
  });

  runCase({
    label: "ONGOING, startDate null, future registrationStartDate -> stays ONGOING (ambiguous)",
    input: input({
      currentStatus: "ONGOING",
      startDate: null,
      registrationStartDate: FUTURE_1,
    }),
    expectedStatus: "ONGOING",
    expectedReason: LifecycleReason.AMBIGUOUS_LIFECYCLE_DATA,
  });

  runCase({
    label: "ONGOING, future startDate -> UPCOMING driven by startDate",
    input: input({
      currentStatus: "ONGOING",
      startDate: FUTURE_1,
    }),
    expectedStatus: "UPCOMING",
    expectedReason: LifecycleReason.AWAITING_FIRST_MILESTONE,
  });

  const drivenByStartDate = resolveAutomaticStatus(
    input({ currentStatus: "ONGOING", startDate: FUTURE_1 }),
  );
  report(
    "ONGOING -> UPCOMING driving date is startDate",
    drivenByStartDate.drivingDate?.getTime() === FUTURE_1.getTime(),
    JSON.stringify(drivenByStartDate),
  );

  runCase({
    label: "REGISTRATION_CLOSED, future endDate -> stays REGISTRATION_CLOSED (ambiguous)",
    input: input({
      currentStatus: "REGISTRATION_CLOSED",
      endDate: FUTURE_5,
    }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.AMBIGUOUS_LIFECYCLE_DATA,
  });

  runCase({
    label: "all four lifecycle dates null -> NO_LIFECYCLE_DATES",
    input: input({ currentStatus: "REGISTRATION_CLOSED" }),
    expectedStatus: "REGISTRATION_CLOSED",
    expectedReason: LifecycleReason.NO_LIFECYCLE_DATES,
  });
}

function verifyDeterminism(): void {
  console.log("\ndeterminism");

  const sample = input({
    currentStatus: "UPCOMING",
    registrationStartDate: PAST_5,
    registrationDeadline: FUTURE_1,
    startDate: FUTURE_5,
    endDate: FUTURE_10,
  });

  const first = resolveAutomaticStatus(sample);
  const second = resolveAutomaticStatus(sample);
  report(
    "identical input yields identical output",
    first.status === second.status &&
      first.reason === second.reason &&
      first.drivingDate?.getTime() === second.drivingDate?.getTime(),
  );
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  verifyRegistrationStartDate();
  verifyRegistrationOpenPriority();
  verifyMilestones();
  verifyMissingDates();
  verifyJumps();
  verifyCancelledImmutable();
  verifyBoundaries();
  verifyNullStatus();
  verifyBackwardTransitions();
  verifyAmbiguousLifecycleData();
  verifyDeterminism();

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
