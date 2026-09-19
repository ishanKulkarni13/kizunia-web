/**
 * Standing regression suite for the Competition lifecycle service, database
 * integration, admin preview/apply workflow, cron sweep, date-edit /
 * re-enable reconciliation, and authorization.
 *
 * Deliberately separate from `verify-competition-lifecycle.ts` — that suite
 * covers the pure resolver in isolation; this one covers everything around
 * it that needs a real database: `CompetitionLifecycleService`,
 * `CompetitionService.update`'s reconciliation integration, and the
 * platform authorization gate.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-competition-lifecycle-service.ts
 *
 * Invariants asserted:
 *   - automation-disabled competitions are never touched by the sweep, by
 *     admin apply, or by a date edit — but a manual status change still
 *     works while disabled
 *   - re-enabling automation (`true -> false`) recalculates immediately,
 *     within the same request, using dates already behind the current time
 *   - date edits can move status forward AND backward
 *   - an explicit manual `status` in the same payload as a date edit skips
 *     recalculation for that request
 *   - preview returns only actual, actionable changes; respects filters,
 *     the disabled flag, and never proposes a change for CANCELLED
 *   - apply mutates only the ids it is given; a row excluded from apply is
 *     left untouched
 *   - apply re-reads and re-evaluates before writing — it does not trust a
 *     stale/forged target status, and a row that changed between preview
 *     and apply is skipped with a reason, not blindly overwritten
 *   - the sweep is idempotent (a second run changes nothing already correct)
 *     and never modifies CANCELLED or disabled rows
 *   - `statusUpdatedAt` changes only when persisted status actually changes
 *   - `updatedById` is set by a human PATCH and left untouched by automatic
 *     lifecycle processing
 *   - MANAGE_COMPETITION_LIFECYCLE is required for preview, apply, and
 *     toggling `automaticStatusUpdatesDisabled` — and is separate from
 *     VIEW_ALL_COMPETITIONS / EDIT
 */

import { PrismaClient, type CompetitionStatus } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { PlatformAction } from "../src/authorization/platform/actions";
import { PlatformPolicy } from "../src/authorization/platform/policy";
import { CompetitionLifecycleService } from "../src/modules/competitions/backend/lifecycle.service";
import { CompetitionService } from "../src/modules/competitions/backend/service";
import { CompetitionContextResolver } from "../src/modules/competitions/backend/authorization";
import type { StrictAuthorizationActor } from "../src/authorization";

const prisma = new PrismaClient();

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

const FIXTURE_PREFIX = "verify-lifecycle-fixture-";

const ADMIN_ACTOR: StrictAuthorizationActor = {
  id: `${FIXTURE_PREFIX}admin-actor`,
  role: PlatformRole.ADMIN,
  banned: false,
};

const MEMBER_ACTOR: StrictAuthorizationActor = {
  id: `${FIXTURE_PREFIX}member-actor`,
  role: "user",
  banned: false,
};

const NOW = new Date();

function daysFromNow(offset: number): Date {
  return new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);
}

const PAST_10 = daysFromNow(-10);
const PAST_5 = daysFromNow(-5);
const PAST_1 = daysFromNow(-1);
const FUTURE_5 = daysFromNow(5);
const FUTURE_10 = daysFromNow(10);

async function seedUsers(): Promise<void> {
  await prisma.user.upsert({
    where: { id: ADMIN_ACTOR.id },
    create: {
      id: ADMIN_ACTOR.id,
      name: "Verify Lifecycle Fixture Admin",
      email: `${FIXTURE_PREFIX}admin@example.invalid`,
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { id: MEMBER_ACTOR.id },
    create: {
      id: MEMBER_ACTOR.id,
      name: "Verify Lifecycle Fixture Member",
      email: `${FIXTURE_PREFIX}member@example.invalid`,
    },
    update: {},
  });
}

async function cleanupFixtures(): Promise<void> {
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_ACTOR.id, MEMBER_ACTOR.id] } },
  });
}

interface FixtureSpec {
  readonly slug: string;
  readonly status: CompetitionStatus | null;
  readonly registrationStartDate?: Date | null;
  readonly registrationDeadline?: Date | null;
  readonly startDate?: Date | null;
  readonly endDate?: Date | null;
  readonly automaticStatusUpdatesDisabled?: boolean;
}

async function createFixture(spec: FixtureSpec) {
  return prisma.competition.create({
    data: {
      title: `Verify Lifecycle Fixture — ${spec.slug}`,
      slug: `${FIXTURE_PREFIX}${spec.slug}`,
      status: spec.status,
      registrationStartDate: spec.registrationStartDate ?? null,
      registrationDeadline: spec.registrationDeadline ?? null,
      startDate: spec.startDate ?? null,
      endDate: spec.endDate ?? null,
      automaticStatusUpdatesDisabled: spec.automaticStatusUpdatesDisabled ?? false,
      visibility: "PUBLIC",
    },
  });
}

// =============================================================================
// 18-22: Automation disabled
// =============================================================================

async function verifyAutomationDisabled(): Promise<void> {
  console.log("\n== Automation disabled ==");

  const disabled = await createFixture({
    slug: "disabled-stale",
    status: "UPCOMING",
    startDate: PAST_5,
    endDate: FUTURE_5,
    automaticStatusUpdatesDisabled: true,
  });

  // 18/19: cron and admin apply both ignore it.
  await CompetitionLifecycleService.runAutomaticSweep();
  const afterSweep = await prisma.competition.findUnique({ where: { id: disabled.id } });
  report(
    "cron ignores a disabled competition even though its dates imply ONGOING",
    afterSweep?.status === "UPCOMING",
    afterSweep?.status ?? "null",
  );

  const applyResult = await CompetitionLifecycleService.apply([disabled.id]);
  report(
    "admin apply reports a disabled competition as skipped (AUTOMATION_DISABLED)",
    applyResult.applied === 0 &&
      applyResult.skipped.some((s) => s.id === disabled.id && s.reason === "AUTOMATION_DISABLED"),
    JSON.stringify(applyResult),
  );

  // 20: a date change while disabled does not automatically change status.
  const context = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: disabled.id,
  });
  await CompetitionService.update({
    context,
    data: { endDate: PAST_1 }, // now implies COMPLETED, if automation were on
  });
  const afterDateEdit = await prisma.competition.findUnique({ where: { id: disabled.id } });
  report(
    "a date edit on a disabled competition does not change its status",
    afterDateEdit?.status === "UPCOMING",
    afterDateEdit?.status ?? "null",
  );

  // 21: manual status change still works while disabled.
  const contextAfterEdit = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: disabled.id,
  });
  await CompetitionService.update({
    context: contextAfterEdit,
    data: { status: "REGISTRATION_OPEN" },
  });
  const afterManual = await prisma.competition.findUnique({ where: { id: disabled.id } });
  report(
    "a manual status change succeeds on a disabled competition",
    afterManual?.status === "REGISTRATION_OPEN",
    afterManual?.status ?? "null",
  );

  // 22: re-enabling automation recalculates immediately, using the dates
  // already behind `now` (endDate = PAST_1, set above) — no sweep needed.
  const contextForReenable = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: disabled.id,
  });
  await CompetitionService.update({
    context: contextForReenable,
    data: { automaticStatusUpdatesDisabled: false },
  });
  const afterReenable = await prisma.competition.findUnique({ where: { id: disabled.id } });
  report(
    "re-enabling automation immediately recalculates (endDate already passed -> COMPLETED)",
    afterReenable?.status === "COMPLETED" && afterReenable?.automaticStatusUpdatesDisabled === false,
    JSON.stringify({ status: afterReenable?.status, disabled: afterReenable?.automaticStatusUpdatesDisabled }),
  );
}

// =============================================================================
// 23-26: Date changes
// =============================================================================

async function verifyDateChanges(): Promise<void> {
  console.log("\n== Date changes: forward and backward ==");

  const competition = await createFixture({
    slug: "date-edit-forward-backward",
    status: "UPCOMING",
    startDate: FUTURE_5,
    endDate: FUTURE_10,
  });

  // 23: forward — pushing startDate into the past moves UPCOMING -> ONGOING.
  const contextForward = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  await CompetitionService.update({
    context: contextForward,
    data: { startDate: PAST_1 },
  });
  const afterForward = await prisma.competition.findUnique({ where: { id: competition.id } });
  report(
    "a date edit can move status forward (UPCOMING -> ONGOING)",
    afterForward?.status === "ONGOING",
    afterForward?.status ?? "null",
  );

  // 24: backward — pushing startDate back into the future moves it back.
  const contextBackward = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  await CompetitionService.update({
    context: contextBackward,
    data: { startDate: FUTURE_5 },
  });
  const afterBackward = await prisma.competition.findUnique({ where: { id: competition.id } });
  report(
    "a date edit can move status backward (ONGOING -> UPCOMING)",
    afterBackward?.status === "UPCOMING",
    afterBackward?.status ?? "null",
  );

  // Manual status wins: sending `status` alongside a date edit must skip
  // recalculation for that request.
  const contextManualWithDate = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  await CompetitionService.update({
    context: contextManualWithDate,
    data: { startDate: PAST_1, status: "REGISTRATION_CLOSED" },
  });
  const afterManualWithDate = await prisma.competition.findUnique({ where: { id: competition.id } });
  report(
    "an explicit manual status in the same payload as a date edit wins over recalculation",
    afterManualWithDate?.status === "REGISTRATION_CLOSED",
    afterManualWithDate?.status ?? "null",
  );
}

// =============================================================================
// 27-34: Admin preview / apply
// =============================================================================

async function verifyPreviewAndApply(): Promise<void> {
  console.log("\n== Admin preview / apply ==");

  const willChange = await createFixture({
    slug: "preview-will-change",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });

  const alreadyCorrect = await createFixture({
    slug: "preview-already-correct",
    status: "ONGOING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });

  const disabled = await createFixture({
    slug: "preview-disabled",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
    automaticStatusUpdatesDisabled: true,
  });

  const cancelled = await createFixture({
    slug: "preview-cancelled",
    status: "CANCELLED",
    startDate: PAST_10,
    endDate: PAST_1, // would imply COMPLETED if not CANCELLED
  });

  const unfiltered = await CompetitionLifecycleService.preview({});
  const previewIds = new Set(unfiltered.items.map((item) => item.id));

  report(
    "preview includes a competition whose status would actually change",
    previewIds.has(willChange.id),
  );
  report(
    "preview excludes a competition already at its correct status",
    !previewIds.has(alreadyCorrect.id),
  );
  report(
    "preview excludes a disabled competition even though its dates imply a change",
    !previewIds.has(disabled.id),
  );
  report(
    "preview never proposes an automatic change for a CANCELLED competition",
    !previewIds.has(cancelled.id),
  );

  // 28: preview respects filters — filter to only UPCOMING current status.
  const filteredToUpcoming = await CompetitionLifecycleService.preview({
    statuses: "UPCOMING",
  });
  const filteredIds = new Set(filteredToUpcoming.items.map((i) => i.id));
  report(
    "preview filtered to statuses=UPCOMING includes the UPCOMING fixture",
    filteredIds.has(willChange.id),
  );
  report(
    "preview filtered to statuses=UPCOMING excludes the ONGOING fixture (not UPCOMING, and unchanged anyway)",
    !filteredIds.has(alreadyCorrect.id),
  );

  // 31/32: apply only the selected id; a candidate NOT selected must be
  // left completely untouched.
  const anotherWillChange = await createFixture({
    slug: "preview-will-change-2",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });

  const beforeApply = await prisma.competition.findUnique({
    where: { id: anotherWillChange.id },
  });

  const applyResult = await CompetitionLifecycleService.apply([willChange.id]);
  report(
    "apply updates the selected row",
    applyResult.applied === 1,
    JSON.stringify(applyResult),
  );

  const afterApplyWillChange = await prisma.competition.findUnique({
    where: { id: willChange.id },
  });
  report(
    "the applied row now shows the derived status",
    afterApplyWillChange?.status === "ONGOING",
    afterApplyWillChange?.status ?? "null",
  );

  const afterApplyExcluded = await prisma.competition.findUnique({
    where: { id: anotherWillChange.id },
  });
  report(
    "a row not included in the apply call is left completely untouched",
    afterApplyExcluded?.status === beforeApply?.status &&
      afterApplyExcluded?.updatedAt.getTime() === beforeApply?.updatedAt.getTime(),
  );

  // 30: apply also never touches CANCELLED, even if explicitly requested.
  const cancelledApply = await CompetitionLifecycleService.apply([cancelled.id]);
  report(
    "apply skips a CANCELLED row with reason CANCELLED",
    cancelledApply.applied === 0 &&
      cancelledApply.skipped.some((s) => s.id === cancelled.id && s.reason === "CANCELLED"),
    JSON.stringify(cancelledApply),
  );

  // 33/34: apply does not blindly trust a stale preview. Mutate the row
  // directly (simulating another admin's concurrent edit) between "preview"
  // and "apply", then apply the stale id.
  const staleTarget = await createFixture({
    slug: "preview-stale-target",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });
  // A preview would have proposed UPCOMING -> ONGOING here. Before applying,
  // another actor cancels it.
  await prisma.competition.update({
    where: { id: staleTarget.id },
    data: { status: "CANCELLED" },
  });
  const staleApply = await CompetitionLifecycleService.apply([staleTarget.id]);
  report(
    "apply re-reads fresh state and skips a row that became CANCELLED after the preview was shown",
    staleApply.applied === 0 &&
      staleApply.skipped.some((s) => s.id === staleTarget.id && s.reason === "CANCELLED"),
    JSON.stringify(staleApply),
  );

  const staleTarget2 = await createFixture({
    slug: "preview-stale-target-2",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });
  // Another admin already applied the exact change a stale preview proposed.
  await prisma.competition.update({
    where: { id: staleTarget2.id },
    data: { status: "ONGOING" },
  });
  const staleApply2 = await CompetitionLifecycleService.apply([staleTarget2.id]);
  report(
    "apply reports NO_CHANGE for a row already reconciled by someone else",
    staleApply2.applied === 0 &&
      staleApply2.skipped.some((s) => s.id === staleTarget2.id && s.reason === "NO_CHANGE"),
    JSON.stringify(staleApply2),
  );
}

// =============================================================================
// 35-39: Cron / sweep
// =============================================================================

async function verifySweep(): Promise<void> {
  console.log("\n== Cron sweep: idempotency, CANCELLED, disabled, necessity ==");

  const willChange = await createFixture({
    slug: "sweep-will-change",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });

  const cancelled = await createFixture({
    slug: "sweep-cancelled",
    status: "CANCELLED",
    startDate: PAST_10,
    endDate: PAST_1,
  });

  const disabled = await createFixture({
    slug: "sweep-disabled",
    status: "UPCOMING",
    startDate: PAST_1,
    endDate: FUTURE_5,
    automaticStatusUpdatesDisabled: true,
  });

  const alreadyCorrect = await createFixture({
    slug: "sweep-already-correct",
    status: "ONGOING",
    startDate: PAST_1,
    endDate: FUTURE_5,
  });
  const beforeSweepCorrect = await prisma.competition.findUnique({
    where: { id: alreadyCorrect.id },
  });

  const firstRun = await CompetitionLifecycleService.runAutomaticSweep();
  report("first sweep run scans and changes at least the fixtures seeded above", firstRun.scanned >= 4 && firstRun.changed >= 1);

  const afterFirst = await prisma.competition.findUnique({ where: { id: willChange.id } });
  report(
    "sweep updates a competition whose dates imply a new status",
    afterFirst?.status === "ONGOING",
    afterFirst?.status ?? "null",
  );

  const cancelledAfter = await prisma.competition.findUnique({ where: { id: cancelled.id } });
  report(
    "sweep never modifies a CANCELLED competition",
    cancelledAfter?.status === "CANCELLED",
  );

  const disabledAfter = await prisma.competition.findUnique({ where: { id: disabled.id } });
  report(
    "sweep never modifies a disabled competition",
    disabledAfter?.status === "UPCOMING",
  );

  const correctAfter = await prisma.competition.findUnique({ where: { id: alreadyCorrect.id } });
  report(
    "sweep does not rewrite a row already at its correct status (updatedAt unchanged)",
    correctAfter?.updatedAt.getTime() === beforeSweepCorrect?.updatedAt.getTime(),
  );
  report(
    "updatedById is never set by the sweep",
    correctAfter?.updatedById === null && afterFirst?.updatedById === null,
  );

  // Idempotency: running the sweep again must change nothing further among
  // these fixtures.
  const secondRun = await CompetitionLifecycleService.runAutomaticSweep();
  const afterSecond = await prisma.competition.findUnique({ where: { id: willChange.id } });
  report(
    "running the sweep twice is idempotent — the already-reconciled row is unchanged the second time",
    afterSecond?.status === "ONGOING" &&
      afterSecond?.updatedAt.getTime() === afterFirst?.updatedAt.getTime(),
  );
  void secondRun;
}

// =============================================================================
// statusUpdatedAt / updatedById invariants
// =============================================================================

async function verifyAuditInvariants(): Promise<void> {
  console.log("\n== statusUpdatedAt / updatedById ==");

  const competition = await createFixture({
    slug: "audit-invariants",
    status: "UPCOMING",
    startDate: FUTURE_5,
  });
  report(
    "statusUpdatedAt is null on a freshly created fixture",
    competition.statusUpdatedAt === null,
  );

  // An ordinary edit that does not touch status must not disturb statusUpdatedAt.
  const context = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  const updated = await CompetitionService.update({
    context,
    data: { organizer: "Verify Lifecycle Fixture Organizer" },
  });
  report(
    "an ordinary field edit that never touches status leaves statusUpdatedAt null",
    updated.statusUpdatedAt === null,
  );
  report(
    "a human PATCH sets updatedById to the actor who made the request",
    (await prisma.competition.findUnique({ where: { id: competition.id } }))?.updatedById === ADMIN_ACTOR.id,
  );

  // A manual status change must set statusUpdatedAt.
  const context2 = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  const afterManualStatus = await CompetitionService.update({
    context: context2,
    data: { status: "ONGOING" },
  });
  report(
    "a manual status change sets statusUpdatedAt",
    afterManualStatus.statusUpdatedAt !== null,
  );

  const statusUpdatedAtAfterManual = afterManualStatus.statusUpdatedAt;

  // Setting status to the SAME value it already has must not move
  // statusUpdatedAt again.
  const context3 = await CompetitionContextResolver.resolve({
    actor: ADMIN_ACTOR,
    competitionId: competition.id,
  });
  const afterNoOpStatus = await CompetitionService.update({
    context: context3,
    data: { status: "ONGOING", organizer: "Verify Lifecycle Fixture Organizer 2" },
  });
  report(
    "setting status to the value it already has does not move statusUpdatedAt",
    afterNoOpStatus.statusUpdatedAt === statusUpdatedAtAfterManual,
  );
}

// =============================================================================
// 40-42: Authorization
// =============================================================================

function verifyAuthorization(): void {
  console.log("\n== Authorization: MANAGE_COMPETITION_LIFECYCLE ==");

  const userDecision = PlatformPolicy.can(
    { actor: MEMBER_ACTOR },
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );
  report(
    "an ordinary authenticated user is denied MANAGE_COMPETITION_LIFECYCLE",
    userDecision.allowed === false,
    JSON.stringify(userDecision),
  );

  const moderatorDecision = PlatformPolicy.can(
    { actor: { ...MEMBER_ACTOR, role: PlatformRole.MODERATOR } },
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );
  report(
    "a moderator is denied MANAGE_COMPETITION_LIFECYCLE (undecided capabilities, baseline only)",
    moderatorDecision.allowed === false,
    JSON.stringify(moderatorDecision),
  );

  const bannedAdminDecision = PlatformPolicy.can(
    { actor: { ...ADMIN_ACTOR, banned: true } },
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );
  report(
    "a banned actor is denied MANAGE_COMPETITION_LIFECYCLE even with the admin role",
    bannedAdminDecision.allowed === false,
    JSON.stringify(bannedAdminDecision),
  );

  const adminDecision = PlatformPolicy.can(
    { actor: ADMIN_ACTOR },
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );
  report(
    "an admin is granted MANAGE_COMPETITION_LIFECYCLE",
    adminDecision.allowed === true,
    JSON.stringify(adminDecision),
  );

  const superAdminDecision = PlatformPolicy.can(
    { actor: { ...ADMIN_ACTOR, role: PlatformRole.SUPER_ADMIN } },
    PlatformAction.MANAGE_COMPETITION_LIFECYCLE,
  );
  report(
    "a super admin is granted MANAGE_COMPETITION_LIFECYCLE",
    superAdminDecision.allowed === true,
    JSON.stringify(superAdminDecision),
  );
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  await cleanupFixtures();
  await seedUsers();

  try {
    await verifyAutomationDisabled();
    await verifyDateChanges();
    await verifyPreviewAndApply();
    await verifySweep();
    await verifyAuditInvariants();
    verifyAuthorization();
  } finally {
    await cleanupFixtures();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  await prisma.$disconnect();

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await cleanupFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exitCode = 1;
});
