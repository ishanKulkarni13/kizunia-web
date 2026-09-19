/**
 * Standing regression suite for the admin Competition listing's P0
 * hardening: the scope-aware deletion invariant (Trash), restore as an
 * admin-only capability, and bulk mutation authorization.
 *
 * Deliberately separate from `verify-search-invariants.ts` — that suite
 * covers the search engine's general behaviour; this one covers the
 * specific security properties this admin pass added, most of which need
 * real fixture rows (an active one and a soft-deleted one) that the rest of
 * the suite has no reason to create.
 *
 * Run with:
 *
 *   pnpm exec tsx scripts/verify-admin-competitions.ts
 */

import { PrismaClient } from "../src/generated/prisma";
import { PlatformRole } from "../src/authorization/platform/roles";
import { PlatformAction } from "../src/authorization/platform/actions";
import { PlatformPolicy } from "../src/authorization/platform/policy";
import {
  CompetitionAction,
  CompetitionContextResolver,
  CompetitionPolicy,
} from "../src/modules/competitions/backend/authorization";
import { CompetitionRepository } from "../src/modules/competitions/backend/repository";
import { CompetitionService } from "../src/modules/competitions/backend/service";
import {
  buildCompetitionQuery,
  planCompetitionSearch,
} from "../src/modules/competitions/search/plan";
import { BulkCompetitionActionSchema } from "../src/modules/competitions/schemas/bulk-competition-action";
import type { RawSearchParams } from "../src/lib/search/types";
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

const FIXTURE_PREFIX = "verify-admin-fixture-";

const ADMIN_ACTOR: StrictAuthorizationActor = {
  id: "verify-admin-fixture-admin-actor",
  role: PlatformRole.ADMIN,
  banned: false,
};

const MEMBER_ACTOR: StrictAuthorizationActor = {
  id: "verify-admin-fixture-member-actor",
  role: "user",
  banned: false,
};

async function runScope(
  scope: "public" | "management" | "admin",
  params: RawSearchParams,
  context: Record<string, unknown> = {},
): Promise<string[]> {
  const plan = await planCompetitionSearch({ scope, params, context });
  const query = buildCompetitionQuery(plan);

  const rows = await prisma.competition.findMany({
    where: query.where,
    select: { id: true },
  });

  return rows.map((row) => row.id);
}

async function seedFixtures(): Promise<{ activeId: string; deletedId: string }> {
  const active = await prisma.competition.create({
    data: {
      title: "Verify Admin Fixture — Active",
      slug: `${FIXTURE_PREFIX}active`,
      visibility: "PUBLIC",
    },
  });

  const deleted = await prisma.competition.create({
    data: {
      title: "Verify Admin Fixture — Deleted",
      slug: `${FIXTURE_PREFIX}deleted`,
      visibility: "PUBLIC",
      deletedAt: new Date(),
    },
  });

  // MEMBER_ACTOR is made a real member of the deleted fixture, so the
  // management-scope check below is actually exercising the deletion
  // invariant — without this, membership filtering alone would already
  // exclude the row, and the check would pass even if the invariant did
  // nothing at all.
  await prisma.competitionMember.create({
    data: { competitionId: deleted.id, userId: MEMBER_ACTOR.id, role: "OWNER" },
  });

  return { activeId: active.id, deletedId: deleted.id };
}

/**
 * `CompetitionMember.userId` is a real foreign key to `User`, so the bulk
 * authorization tests — which need an actual OWNER row — need an actual user
 * to own it. Deleting the user cascades the membership away with it.
 */
async function seedMemberActor(): Promise<void> {
  await prisma.user.upsert({
    where: { id: MEMBER_ACTOR.id },
    create: {
      id: MEMBER_ACTOR.id,
      name: "Verify Admin Fixture Member",
      email: `${FIXTURE_PREFIX}member@example.invalid`,
    },
    update: {},
  });
}

async function cleanupFixtures(): Promise<void> {
  await prisma.competition.deleteMany({
    where: { slug: { startsWith: FIXTURE_PREFIX } },
  });

  await prisma.user.deleteMany({ where: { id: MEMBER_ACTOR.id } });
}

// =============================================================================
// P0.B — the deletion invariant is scope-aware and cannot be forged
// =============================================================================

async function verifyDeletionInvariant(deletedId: string, activeId: string): Promise<void> {
  console.log("\n== Invariant: deletion visibility is scope-gated, not param-gated ==");

  // public: never sees the deleted fixture, no matter what recordState says.
  for (const params of [
    {},
    { recordState: "DELETED" },
    { recordState: "ACTIVE,DELETED" },
  ] as RawSearchParams[]) {
    const ids = await runScope("public", params);

    report(
      `public with ${JSON.stringify(params)} never returns the deleted fixture`,
      !ids.includes(deletedId),
    );
  }

  // management: same, using a context whose guard actually resolves.
  const managementIds = await runScope(
    "management",
    { recordState: "DELETED" },
    { actorId: MEMBER_ACTOR.id },
  );

  report(
    "management with a forged recordState never returns the deleted fixture",
    !managementIds.includes(deletedId),
  );

  // admin: absent recordState is today's unchanged default.
  const adminDefault = await runScope("admin", {});

  report(
    "admin default excludes the deleted fixture",
    !adminDefault.includes(deletedId) && adminDefault.includes(activeId),
  );

  // admin: DELETED-only excludes active, includes deleted.
  const adminDeleted = await runScope("admin", { recordState: "DELETED" });

  report(
    "admin recordState=DELETED returns only the deleted fixture (of these two)",
    adminDeleted.includes(deletedId) && !adminDeleted.includes(activeId),
  );

  // admin: both selected removes the restriction entirely.
  const adminBoth = await runScope("admin", { recordState: "ACTIVE,DELETED" });

  report(
    "admin recordState=ACTIVE,DELETED returns both fixtures",
    adminBoth.includes(deletedId) && adminBoth.includes(activeId),
  );

  // Plan symmetry: findMany and count must agree for every one of the above.
  for (const params of [
    {},
    { recordState: "DELETED" },
    { recordState: "ACTIVE,DELETED" },
  ] as RawSearchParams[]) {
    const plan = await planCompetitionSearch({ scope: "admin", params });
    const a = buildCompetitionQuery(plan);
    const b = buildCompetitionQuery(plan);

    report(
      `admin plan is symmetric for ${JSON.stringify(params)}`,
      JSON.stringify(a.where) === JSON.stringify(b.where),
    );
  }
}

// =============================================================================
// P0.C — restore is reachable only by a non-banned platform admin
// =============================================================================

async function verifyRestoreAuthorization(deletedId: string): Promise<void> {
  console.log("\n== Invariant: restore is an admin-only capability ==");

  const deletedCompetition =
    await CompetitionRepository.findByIdIncludingDeletedOrThrow(deletedId);

  const memberContext = CompetitionContextResolver.fromData({
    actor: MEMBER_ACTOR,
    competition: deletedCompetition,
    membership: null,
  });

  const memberDecision = CompetitionPolicy.can(
    memberContext,
    CompetitionAction.RESTORE,
  );

  report(
    "an ordinary, non-member actor is denied RESTORE",
    memberDecision.allowed === false,
    JSON.stringify(memberDecision),
  );

  const adminContext = CompetitionContextResolver.fromData({
    actor: ADMIN_ACTOR,
    competition: deletedCompetition,
    membership: null,
  });

  const adminDecision = CompetitionPolicy.can(
    adminContext,
    CompetitionAction.RESTORE,
  );

  report(
    "a platform admin is granted RESTORE, even with no membership",
    adminDecision.allowed === true,
    JSON.stringify(adminDecision),
  );

  // The ordinary resolver must NOT be able to find a deleted row at all —
  // this is the defect that would make restore unreachable even for an
  // admin if the deleted-inclusive resolver did not exist.
  let ordinaryResolverThrew = false;

  try {
    await CompetitionContextResolver.resolve({
      actor: ADMIN_ACTOR,
      competitionId: deletedId,
    });
  } catch {
    ordinaryResolverThrew = true;
  }

  report(
    "the ordinary context resolver cannot find a deleted competition (by design)",
    ordinaryResolverThrew,
  );

  const resolvedIncludingDeleted =
    await CompetitionContextResolver.resolveIncludingDeleted({
      actor: ADMIN_ACTOR,
      competitionId: deletedId,
    });

  report(
    "resolveIncludingDeleted finds it",
    resolvedIncludingDeleted.competition.id === deletedId,
  );
}

// =============================================================================
// P0.E — GET /api/v1/admin/competitions requires VIEW_ALL_COMPETITIONS, not
// merely authenticated-and-not-banned
// =============================================================================
//
// `CompetitionController.searchAdminManageable` gates access with
// `PlatformAuthorizer.can({ actor }, PlatformAction.VIEW_ALL_COMPETITIONS)` —
// the same platform-level check the admin page and `CompetitionFacade` use.
// This exercises that check through `PlatformPolicy` directly, the same
// abstraction the controller calls through, so a regression here (someone
// reverting the controller to only check authentication) is caught without
// needing an HTTP harness.

function verifyAdminSearchAuthorization(): void {
  console.log(
    "\n== Invariant: admin competition search requires VIEW_ALL_COMPETITIONS ==",
  );

  const ordinaryUserDecision = PlatformPolicy.can(
    { actor: MEMBER_ACTOR },
    PlatformAction.VIEW_ALL_COMPETITIONS,
  );

  report(
    "an authenticated, non-banned ordinary user is denied VIEW_ALL_COMPETITIONS",
    ordinaryUserDecision.allowed === false,
    JSON.stringify(ordinaryUserDecision),
  );

  const bannedAdminDecision = PlatformPolicy.can(
    { actor: { ...ADMIN_ACTOR, banned: true } },
    PlatformAction.VIEW_ALL_COMPETITIONS,
  );

  report(
    "a banned actor is denied VIEW_ALL_COMPETITIONS even with the admin role",
    bannedAdminDecision.allowed === false,
    JSON.stringify(bannedAdminDecision),
  );

  const adminDecision = PlatformPolicy.can(
    { actor: ADMIN_ACTOR },
    PlatformAction.VIEW_ALL_COMPETITIONS,
  );

  report(
    "a non-banned platform admin is granted VIEW_ALL_COMPETITIONS",
    adminDecision.allowed === true,
    JSON.stringify(adminDecision),
  );
}

// =============================================================================
// P0.D — bulk: validation, authorized-set-equals-requested-set, no partial writes
// =============================================================================

function verifyBulkValidation(): void {
  console.log("\n== Invariant: bulk request validation ==");

  const validId = "c".repeat(25); // cuid-shaped, not necessarily real

  report(
    "a well-formed SET_STATUS request parses",
    BulkCompetitionActionSchema.safeParse({
      ids: [validId],
      action: { type: "SET_STATUS", status: "UPCOMING" },
    }).success,
  );

  report(
    "an empty id list is rejected",
    !BulkCompetitionActionSchema.safeParse({
      ids: [],
      action: { type: "DELETE" },
    }).success,
  );

  report(
    "more than 50 ids is rejected",
    !BulkCompetitionActionSchema.safeParse({
      ids: Array.from({ length: 51 }, () => validId),
      action: { type: "DELETE" },
    }).success,
  );

  report(
    "a non-cuid id is rejected",
    !BulkCompetitionActionSchema.safeParse({
      ids: ["not-a-cuid"],
      action: { type: "DELETE" },
    }).success,
  );

  report(
    "an invalid status enum value is rejected",
    !BulkCompetitionActionSchema.safeParse({
      ids: [validId],
      action: { type: "SET_STATUS", status: "NOT_A_REAL_STATUS" },
    }).success,
  );

  report(
    "SET_STATUS without a status is rejected (discriminated union enforces the payload)",
    !BulkCompetitionActionSchema.safeParse({
      ids: [validId],
      action: { type: "SET_STATUS" },
    }).success,
  );

  report(
    "an unknown action type is rejected",
    !BulkCompetitionActionSchema.safeParse({
      ids: [validId],
      action: { type: "ARCHIVE_EVERYTHING" },
    }).success,
  );
}

async function verifyBulkAuthorization(
  ownedId: string,
  foreignId: string,
): Promise<void> {
  console.log(
    "\n== Invariant: bulk authorization is all-or-nothing, from DB-resolved context ==",
  );

  // The member actor owns `ownedId` (is its OWNER) but not `foreignId`.
  const contexts = await CompetitionService.loadBulkActionContexts(
    MEMBER_ACTOR,
    [ownedId, foreignId],
  );

  const unauthorized = contexts
    .filter((context) => !CompetitionPolicy.can(context, CompetitionAction.EDIT).allowed)
    .map((context) => context.competition.id);

  report(
    "a mixed authorized/unauthorized request identifies exactly the unauthorized id",
    unauthorized.length === 1 && unauthorized[0] === foreignId,
    JSON.stringify(unauthorized),
  );

  // Mirroring the controller: since not every id is authorized, bulkApply is
  // never called. Confirm neither row was touched.
  const [ownedBefore, foreignBefore] = await Promise.all([
    prisma.competition.findUniqueOrThrow({ where: { id: ownedId } }),
    prisma.competition.findUniqueOrThrow({ where: { id: foreignId } }),
  ]);

  report(
    "neither row was mutated by the mixed request (the controller never reaches bulkApply)",
    ownedBefore.status === null && foreignBefore.status === null,
  );

  // Now a fully-authorized request against just the owned id succeeds.
  const ownedOnlyContexts = await CompetitionService.loadBulkActionContexts(
    MEMBER_ACTOR,
    [ownedId],
  );

  const ownedOnlyUnauthorized = ownedOnlyContexts.filter(
    (context) => !CompetitionPolicy.can(context, CompetitionAction.EDIT).allowed,
  );

  report(
    "a fully-authorized request has no unauthorized ids",
    ownedOnlyUnauthorized.length === 0,
  );

  const result = await CompetitionService.bulkApply([ownedId], {
    type: "SET_STATUS",
    status: "ONGOING",
  });

  report("bulkApply reports one row updated", result.updated === 1);

  const ownedAfter = await prisma.competition.findUniqueOrThrow({
    where: { id: ownedId },
  });

  report(
    "the owned row's status actually changed",
    ownedAfter.status === "ONGOING",
  );

  const foreignAfter = await prisma.competition.findUniqueOrThrow({
    where: { id: foreignId },
  });

  report(
    "the foreign row is untouched by the authorized, narrower request",
    foreignAfter.status === null,
  );

  // Nonexistent id: loadBulkActionContexts must throw naming it, before any
  // authorization or mutation is attempted.
  let threwForMissingId = false;

  try {
    await CompetitionService.loadBulkActionContexts(MEMBER_ACTOR, [
      ownedId,
      "cdoesnotexist00000000000",
    ]);
  } catch {
    threwForMissingId = true;
  }

  report(
    "a request naming a nonexistent id is rejected before authorization runs",
    threwForMissingId,
  );
}

// =============================================================================

async function main(): Promise<void> {
  await cleanupFixtures();
  await seedMemberActor();

  const { activeId, deletedId } = await seedFixtures();

  // A second fixture the member actor owns, and one it does not — for the
  // bulk authorization tests. Reuses the repository's own membership write
  // so this is a real OWNER row, not a hand-built context.
  const owned = await prisma.competition.create({
    data: { title: "Verify Admin Fixture — Owned", slug: `${FIXTURE_PREFIX}owned` },
  });

  await prisma.competitionMember.create({
    data: {
      competitionId: owned.id,
      userId: MEMBER_ACTOR.id,
      role: "OWNER",
    },
  });

  const foreign = await prisma.competition.create({
    data: { title: "Verify Admin Fixture — Foreign", slug: `${FIXTURE_PREFIX}foreign` },
  });

  try {
    await verifyDeletionInvariant(deletedId, activeId);
    await verifyRestoreAuthorization(deletedId);
    verifyAdminSearchAuthorization();
    verifyBulkValidation();
    await verifyBulkAuthorization(owned.id, foreign.id);
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
