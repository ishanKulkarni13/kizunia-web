/**
 * Owned-project quota (Subscription Phase II, IB-12) against a real database.
 *
 * Driven entirely by grants — the only entitlement source until Phase III —
 * through the real `ProjectService.create`, so what is asserted is the
 * authoritative boundary, not a UI check:
 *
 * - FREE 5, PRO 10, PRO+ 20 owned, non-deleted projects;
 * - memberships and soft-deleted projects never count;
 * - a downgrade keeps every project and only refuses creation;
 * - platform admins bypass the quota (IB-7);
 * - concurrent creates at the edge never both succeed (advisory lock).
 *
 * Only the session is faked for the HTTP-level cases.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: { actorId: "", role: "user" } }));

vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getActor: vi.fn(async () =>
      session.actorId ? { id: session.actorId, role: session.role, banned: false } : null,
    ),
    getStrictActor: vi.fn(async () => ({ id: session.actorId, role: session.role, banned: false })),
  },
}));

import { AuthorizationCode, type StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { ProjectRole } from "@/generated/prisma";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import {
  deleteGrantsForUsers,
  insertGrant,
  revokeGrants,
} from "@/testing/entitlement-fixtures";

import { ProjectController } from "./controller";
import { projectService } from "./service";

const PREFIX = "__vitest_project_quota__";
const SLUG_PREFIX = "vitest-quota-";

let counter = 0;

function unique(name: string): string {
  counter += 1;
  return `${PREFIX}-${name}-${Date.now()}-${counter}`;
}

function uniqueSlug(): string {
  counter += 1;
  return `${SLUG_PREFIX}${Date.now().toString(36)}-${counter}-${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(name: string, role: string = PlatformRole.USER) {
  const id = unique(name);
  await prisma.user.create({ data: { id, name: "Quota Test", email: `${id}@example.test`, role } });
  return id;
}

function actorFor(id: string, role: string = PlatformRole.USER): StrictAuthorizationActor {
  return { id, role, banned: false };
}

function createProject(actor: StrictAuthorizationActor) {
  return projectService.create({
    actor,
    dto: { title: "Quota Project", slug: uniqueSlug(), shortDescription: "A project for quota tests." },
  });
}

/** Creates `n` owned projects directly, bypassing the service — pre-existing state. */
async function seedOwned(userId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    const project = await prisma.project.create({
      data: {
        title: "Seeded",
        slug: uniqueSlug(),
        shortDescription: "Seeded project.",
        createdById: userId,
        updatedById: userId,
      },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId, role: ProjectRole.OWNER },
    });
  }
}

async function ownedCount(userId: string) {
  return prisma.projectMember.count({
    where: { userId, role: ProjectRole.OWNER, project: { deletedAt: null } },
  });
}

async function expectQuotaRefusal(promise: Promise<unknown>, limit: number, owned: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(ForbiddenError);
  expect((error as ForbiddenError).code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
  expect((error as ForbiddenError).details).toEqual({ limit, owned });
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  await prisma.project.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  await deleteGrantsForUsers(userIds);
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

let granter: string;

beforeEach(async () => {
  await cleanup();
  granter = await createUser("granter");
  session.actorId = "";
  session.role = PlatformRole.USER;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("owned-project quota — limits per plan", () => {
  it("FREE: allows the 5th owned project and refuses the 6th", async () => {
    const user = await createUser("free");
    await seedOwned(user, 4);

    await createProject(actorFor(user));
    expect(await ownedCount(user)).toBe(5);

    await expectQuotaRefusal(createProject(actorFor(user)), 5, 5);
    expect(await ownedCount(user)).toBe(5);
  });

  it("PRO: allows up to 10", async () => {
    const user = await createUser("pro");
    await insertGrant(user, granter, { plan: "PRO" });
    await seedOwned(user, 9);

    await createProject(actorFor(user));
    await expectQuotaRefusal(createProject(actorFor(user)), 10, 10);
  });

  it("PRO+: allows up to 20", async () => {
    const user = await createUser("plus");
    await insertGrant(user, granter, { plan: "PRO_PLUS" });
    await seedOwned(user, 19);

    await createProject(actorFor(user));
    await expectQuotaRefusal(createProject(actorFor(user)), 20, 20);
  });
});

describe("owned-project quota — what counts", () => {
  it("does not count memberships in other users' projects", async () => {
    const user = await createUser("member");
    const other = await createUser("other");
    await seedOwned(other, 3);

    const othersProjects = await prisma.projectMember.findMany({ where: { userId: other } });
    for (const [index, { projectId }] of othersProjects.entries()) {
      await prisma.projectMember.create({
        data: {
          projectId,
          userId: user,
          role: index === 0 ? ProjectRole.MAINTAINER : ProjectRole.CONTRIBUTOR,
        },
      });
    }

    await seedOwned(user, 4);

    // 4 owned + 3 memberships: the 5th owned project is still allowed.
    await createProject(actorFor(user));
    expect(await ownedCount(user)).toBe(5);
  });

  it("does not count soft-deleted projects, so deleting one frees a slot", async () => {
    const user = await createUser("deleter");
    await seedOwned(user, 5);

    await expectQuotaRefusal(createProject(actorFor(user)), 5, 5);

    const [first] = await prisma.projectMember.findMany({ where: { userId: user } });
    await projectService.delete({ id: first.projectId, actor: actorFor(user) });

    await createProject(actorFor(user));
    expect(await ownedCount(user)).toBe(5);
  });
});

describe("owned-project quota — downgrade and regrant (SB-DP-01)", () => {
  it("keeps every project on downgrade and refuses creation until back under quota", async () => {
    const user = await createUser("downgrade");
    await insertGrant(user, granter, { plan: "PRO" });
    await seedOwned(user, 8);

    await revokeGrants(user, granter);

    // Nothing deleted or archived.
    expect(await ownedCount(user)).toBe(8);
    expect(
      await prisma.project.count({
        where: { members: { some: { userId: user } }, deletedAt: { not: null } },
      }),
    ).toBe(0);

    await expectQuotaRefusal(createProject(actorFor(user)), 5, 8);

    // Deleting down to 4 owned brings the user back under the FREE quota.
    const owned = await prisma.projectMember.findMany({ where: { userId: user } });
    for (const { projectId } of owned.slice(0, 4)) {
      await projectService.delete({ id: projectId, actor: actorFor(user) });
    }

    await createProject(actorFor(user));
  });

  it("reflects a new grant immediately, and an expired grant by the clock alone", async () => {
    const user = await createUser("regrant");
    await seedOwned(user, 5);

    await expectQuotaRefusal(createProject(actorFor(user)), 5, 5);

    const grant = await insertGrant(user, granter, { plan: "PRO" });
    await createProject(actorFor(user));
    expect(await ownedCount(user)).toBe(6);

    // Expire it in place — no job runs; the next read falls back to FREE.
    await prisma.entitlementGrant.update({
      where: { id: grant.id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });

    await expectQuotaRefusal(createProject(actorFor(user)), 5, 6);
  });
});

describe("owned-project quota — admin bypass (IB-7)", () => {
  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])(
    "lets a %s create above their quota without a grant",
    async (role) => {
      const admin = await createUser(`admin-${role}`, role);
      await seedOwned(admin, 5);

      await createProject(actorFor(admin, role));
      expect(await ownedCount(admin)).toBe(6);
    },
  );

  it("does not let a moderator bypass the quota", async () => {
    const moderator = await createUser("moderator", PlatformRole.MODERATOR);
    await seedOwned(moderator, 5);

    await expectQuotaRefusal(createProject(actorFor(moderator, PlatformRole.MODERATOR)), 5, 5);
  });
});

describe("owned-project quota — concurrency (advisory lock)", () => {
  it("at 9/10, two concurrent creates never both succeed", async () => {
    for (let round = 0; round < 5; round += 1) {
      const user = await createUser(`race-${round}`);
      await insertGrant(user, granter, { plan: "PRO" });
      await seedOwned(user, 9);

      const results = await Promise.allSettled([
        createProject(actorFor(user)),
        createProject(actorFor(user)),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const [rejected] = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect((rejected.reason as ForbiddenError).code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
      expect(await ownedCount(user)).toBe(10);
    }
  });

  it("at 4/5, five concurrent creates yield exactly one project", async () => {
    const user = await createUser("race-five");
    await seedOwned(user, 4);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createProject(actorFor(user))),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await ownedCount(user)).toBe(5);
  });
});

describe("owned-project quota — server flag and HTTP contract", () => {
  it("reports the allowance the create path enforces", async () => {
    const user = await createUser("allowance");
    await seedOwned(user, 5);

    expect(await projectService.getOwnershipAllowance({ actor: actorFor(user) })).toEqual({
      canCreateOwnedProject: false,
      owned: 5,
      limit: 5,
    });

    await insertGrant(user, granter, { plan: "PRO_PLUS" });

    expect(await projectService.getOwnershipAllowance({ actor: actorFor(user) })).toEqual({
      canCreateOwnedProject: true,
      owned: 5,
      limit: 20,
    });
  });

  it("reports an admin over quota as able to create", async () => {
    const admin = await createUser("allowance-admin", PlatformRole.ADMIN);
    await seedOwned(admin, 5);

    const allowance = await projectService.getOwnershipAllowance({
      actor: actorFor(admin, PlatformRole.ADMIN),
    });
    expect(allowance.canCreateOwnedProject).toBe(true);
  });

  it("serves the allowance at GET /api/v1/projects/mine/allowance", async () => {
    const user = await createUser("allowance-http");
    await seedOwned(user, 2);
    session.actorId = user;

    const response = await ProjectController.getOwnershipAllowance(
      new NextRequest("http://localhost/api/v1/projects/mine/allowance"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ canCreateOwnedProject: true, owned: 2, limit: 5 });
  });

  it("answers POST /api/v1/projects over quota with 403 UPGRADE_REQUIRED and { limit, owned }", async () => {
    const user = await createUser("http");
    await seedOwned(user, 5);
    session.actorId = user;

    const response = await ProjectController.create(
      new NextRequest("http://localhost/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "Over Quota",
          slug: uniqueSlug(),
          shortDescription: "Should be refused.",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UPGRADE_REQUIRED");
    expect(body.error.details).toEqual({ limit: 5, owned: 5 });
  });
});
