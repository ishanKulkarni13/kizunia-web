/**
 * Portfolio visibility and lifecycle, end to end against a real database:
 *
 * - a new portfolio starts PRIVATE;
 * - the owner changes visibility through the authorized path, and the public
 *   read follows it (PRIVATE and deleted alike are an indistinguishable 404);
 * - delete is a soft delete that keeps every child row and Asset reference;
 * - a deleted portfolio blocks creating another and can only be restored,
 *   which returns it PRIVATE and lossless;
 * - none of it is reachable for a banned owner.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: { actorId: "" } }));

// Only the session is faked (used by the HTTP-contract block below); the
// controller, services, limiter and database are all real.
vi.mock("@/lib/auth/session", () => ({
  SessionService: {
    getStrictActor: vi.fn(async () => ({
      id: session.actorId,
      role: "user",
      banned: false,
    })),
  },
}));

import { AuthorizationCode } from "@/authorization";
import type { StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { AssetStatus, PortfolioVisibility } from "@/generated/prisma";
import { AuthorizationError } from "@/lib/errors";
import prisma from "@/lib/prisma";

import {
  PortfolioAlreadyExistsError,
  PortfolioDeletedError,
  PortfolioErrorCode,
  PortfolioNotDeletedError,
  PortfolioNotFoundError,
} from "../errors";
import { PortfolioController } from "./controller";
import { portfolioService } from "./service";

const TEST_PREFIX = "__vitest_portfolio_lifecycle__";

let counter = 0;

function unique(name: string): string {
  counter += 1;

  return `${TEST_PREFIX}_${name}_${Date.now()}_${counter}`;
}

async function createUser(name: string, { banned = false } = {}) {
  const key = unique(name);

  return prisma.user.create({
    data: {
      id: key,
      name: "Lifecycle Test User",
      email: `${key}@example.test`,
      emailVerified: true,
      username: key.toLowerCase(),
      banned,
    },
  });
}

function actorFor(
  userId: string,
  { banned = false } = {},
): StrictAuthorizationActor {
  return { id: userId, role: PlatformRole.USER, banned };
}

async function createDocumentAsset(name: string) {
  const key = unique(name);

  return prisma.asset.create({
    data: {
      provider: "CLOUDINARY",
      publicId: key,
      secureUrl: `https://res.cloudinary.com/test/raw/upload/${key}.pdf`,
      category: "DOCUMENT",
      status: AssetStatus.ACTIVE,
      mimeType: "application/pdf",
      format: "pdf",
    },
  });
}

async function expectAuthorizationCode(
  promise: Promise<unknown>,
  code: AuthorizationCode,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(AuthorizationError);
  expect((error as AuthorizationError).code).toBe(code);
}

afterAll(async () => {
  await prisma.testimonial.deleteMany({
    where: { portfolio: { user: { email: { startsWith: TEST_PREFIX } } } },
  });
  await prisma.portfolio.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.asset.deleteMany({
    where: { publicId: { startsWith: TEST_PREFIX } },
  });
  await prisma.rateLimit.deleteMany({
    where: { key: { contains: TEST_PREFIX } },
  });
  await prisma.$disconnect();
});

describe("creation defaults", () => {
  it("creates a portfolio PRIVATE, so nothing is published until the owner opts in", async () => {
    const user = await createUser("default-private");

    const dto = await portfolioService.create({ actor: actorFor(user.id) });

    expect(dto.visibility).toBe(PortfolioVisibility.PRIVATE);

    const row = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.visibility).toBe(PortfolioVisibility.PRIVATE);

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("returns the editor DTO, not the entity", async () => {
    const user = await createUser("create-dto");

    const dto = await portfolioService.create({ actor: actorFor(user.id) });

    expect(Object.keys(dto).sort()).toEqual(
      [
        "bio",
        "displayName",
        "headline",
        "id",
        "location",
        "phone",
        "publicContactEmail",
        "resumeAsset",
        "user",
        "visibility",
      ].sort(),
    );
    expect(dto.user).toEqual({ username: user.username });
  });
});

describe("changeVisibility", () => {
  it("publishes and unpublishes, and the public read follows", async () => {
    const user = await createUser("visibility");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    const published = await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });
    expect(published.visibility).toBe(PortfolioVisibility.PUBLIC);

    const publicDto = await portfolioService.findPublicByUsername({
      username: user.username!,
    });
    expect(publicDto.user.username).toBe(user.username);

    const unpublished = await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PRIVATE },
    });
    expect(unpublished.visibility).toBe(PortfolioVisibility.PRIVATE);

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });

  it("only ever changes the caller's own portfolio (no portfolio id is accepted)", async () => {
    const owner = await createUser("vis-owner");
    const other = await createUser("vis-other");
    await portfolioService.create({ actor: actorFor(owner.id) });
    await portfolioService.create({ actor: actorFor(other.id) });

    await portfolioService.changeVisibility({
      actor: actorFor(other.id),
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    const ownerRow = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect(ownerRow.visibility).toBe(PortfolioVisibility.PRIVATE);
  });

  it("refuses a banned owner", async () => {
    const user = await createUser("vis-banned", { banned: true });
    await prisma.portfolio.create({
      data: { displayName: "Banned", userId: user.id },
    });

    await expectAuthorizationCode(
      portfolioService.changeVisibility({
        actor: actorFor(user.id, { banned: true }),
        dto: { visibility: PortfolioVisibility.PUBLIC },
      }),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });

  it("reports a missing portfolio as not found", async () => {
    const user = await createUser("vis-none");

    await expect(
      portfolioService.changeVisibility({
        actor: actorFor(user.id),
        dto: { visibility: PortfolioVisibility.PUBLIC },
      }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });
});

describe("delete / restore lifecycle", () => {
  async function publishedPortfolioWithContent(name: string) {
    const user = await createUser(name);
    const actor = actorFor(user.id);

    const created = await portfolioService.create({ actor });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    const resume = await createDocumentAsset(`${name}-resume`);
    await portfolioService.updateProfile({
      actor,
      dto: { resumeAssetId: resume.id },
    });

    await prisma.testimonial.create({
      data: {
        portfolioId: created.id,
        name: "Grace",
        message: "Great work",
      },
    });

    return { user, actor, portfolioId: created.id, resume };
  }

  it("soft-deletes: the public read becomes a 404 and the owner is refused with RESOURCE_DELETED", async () => {
    const { user, actor } = await publishedPortfolioWithContent("soft-delete");

    await portfolioService.delete({ actor });

    const row = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.deletedAt).not.toBeNull();
    // The stored preference is untouched: deletion overrides it, it does not
    // rewrite it.
    expect(row.visibility).toBe(PortfolioVisibility.PUBLIC);

    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    // Indistinguishable from "no such portfolio" for anyone else.
    await expect(
      portfolioService.findPublicByUsername({ username: "no_such_user_xyz" }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    await expectAuthorizationCode(
      portfolioService.findMine({ actor }),
      AuthorizationCode.RESOURCE_DELETED,
    );
  });

  it("keeps every child row and Asset reference on delete", async () => {
    const { actor, portfolioId, resume } =
      await publishedPortfolioWithContent("keeps-children");

    await portfolioService.delete({ actor });

    const row = await prisma.portfolio.findUniqueOrThrow({
      where: { id: portfolioId },
    });
    expect(row.resumeAssetId).toBe(resume.id);

    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: resume.id },
    });
    expect(asset.status).toBe(AssetStatus.ACTIVE);

    expect(
      await prisma.testimonial.count({ where: { portfolioId } }),
    ).toBe(1);
  });

  it("refuses every owner action on a deleted portfolio", async () => {
    const { actor } = await publishedPortfolioWithContent("refuses-actions");

    await portfolioService.delete({ actor });

    await expectAuthorizationCode(
      portfolioService.updateProfile({ actor, dto: { headline: "x" } }),
      AuthorizationCode.RESOURCE_DELETED,
    );
    await expectAuthorizationCode(
      portfolioService.changeVisibility({
        actor,
        dto: { visibility: PortfolioVisibility.PRIVATE },
      }),
      AuthorizationCode.RESOURCE_DELETED,
    );
    await expectAuthorizationCode(
      portfolioService.delete({ actor }),
      AuthorizationCode.RESOURCE_DELETED,
    );
  });

  it("does not let the owner create a replacement while the deleted one exists", async () => {
    const { actor } = await publishedPortfolioWithContent("no-replacement");

    await portfolioService.delete({ actor });

    const error = await portfolioService.create({ actor }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(PortfolioDeletedError);
    expect((error as PortfolioDeletedError).code).toBe(
      PortfolioErrorCode.DELETED,
    );
    expect((error as PortfolioDeletedError).status).toBe(409);
  });

  it("still reports a live portfolio as already existing", async () => {
    const user = await createUser("already-exists");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    await expect(portfolioService.create({ actor })).rejects.toBeInstanceOf(
      PortfolioAlreadyExistsError,
    );
  });

  it("restores losslessly and always PRIVATE", async () => {
    const { user, actor, portfolioId, resume } =
      await publishedPortfolioWithContent("restore");

    await portfolioService.delete({ actor });

    const restored = await portfolioService.restore({ actor });

    // Was PUBLIC when deleted; comes back unpublished.
    expect(restored.visibility).toBe(PortfolioVisibility.PRIVATE);
    expect(restored.id).toBe(portfolioId);
    expect(restored.resumeAsset?.id).toBe(resume.id);

    const row = await prisma.portfolio.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(row.deletedAt).toBeNull();

    // Editor works again, public stays a 404 until the owner republishes.
    await expect(portfolioService.findMine({ actor })).resolves.not.toBeNull();
    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });
    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).resolves.toMatchObject({ user: { username: user.username } });
  });

  it("refuses to restore a portfolio that is not deleted", async () => {
    const user = await createUser("restore-live");
    const actor = actorFor(user.id);
    await portfolioService.create({ actor });

    await expect(portfolioService.restore({ actor })).rejects.toBeInstanceOf(
      PortfolioNotDeletedError,
    );
  });

  it("refuses a banned owner delete and restore", async () => {
    const user = await createUser("lifecycle-banned", { banned: true });
    await prisma.portfolio.create({
      data: { displayName: "Banned", userId: user.id },
    });
    const actor = actorFor(user.id, { banned: true });

    await expectAuthorizationCode(
      portfolioService.delete({ actor }),
      AuthorizationCode.ACCOUNT_BANNED,
    );
    await expectAuthorizationCode(
      portfolioService.restore({ actor }),
      AuthorizationCode.ACCOUNT_BANNED,
    );
  });

  it("reports delete and restore of a missing portfolio as not found", async () => {
    const user = await createUser("lifecycle-none");
    const actor = actorFor(user.id);

    await expect(portfolioService.delete({ actor })).rejects.toBeInstanceOf(
      PortfolioNotFoundError,
    );
    await expect(portfolioService.restore({ actor })).rejects.toBeInstanceOf(
      PortfolioNotFoundError,
    );
  });
});

describe("HTTP contract", () => {
  function request(method: string, body?: unknown): NextRequest {
    return new NextRequest("http://localhost/api/v1/portfolio", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }

  it("walks the whole lifecycle through the routes' controller with stable codes", async () => {
    const user = await createUser("http");
    session.actorId = user.id;

    // No portfolio yet: 404 means "create one".
    const none = await PortfolioController.findMine(request("GET"));
    expect(none.status).toBe(404);

    const created = await PortfolioController.create(request("POST"));
    expect(created.status).toBe(201);
    expect((await created.json()).data.visibility).toBe("PRIVATE");

    const published = await PortfolioController.changeVisibility(
      request("PATCH", { visibility: "PUBLIC" }),
    );
    expect(published.status).toBe(200);
    expect((await published.json()).data.visibility).toBe("PUBLIC");

    // Only the two stored levels are accepted.
    const invalid = await PortfolioController.changeVisibility(
      request("PATCH", { visibility: "UNLISTED" }),
    );
    expect(invalid.status).toBe(422);

    const deleted = await PortfolioController.delete(request("DELETE"));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).data).toEqual({ deleted: true });

    // Deleted: 403 RESOURCE_DELETED — distinguishable from "none yet".
    const mine = await PortfolioController.findMine(request("GET"));
    expect(mine.status).toBe(403);
    expect((await mine.json()).error.code).toBe("RESOURCE_DELETED");

    // Recreating is refused with a restore hint.
    const recreate = await PortfolioController.create(request("POST"));
    expect(recreate.status).toBe(409);
    expect((await recreate.json()).error.code).toBe("PORTFOLIO_DELETED");

    const restored = await PortfolioController.restore(request("POST"));
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.visibility).toBe("PRIVATE");

    const again = await PortfolioController.restore(request("POST"));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("PORTFOLIO_NOT_DELETED");

    const back = await PortfolioController.findMine(request("GET"));
    expect(back.status).toBe(200);
  });
});
