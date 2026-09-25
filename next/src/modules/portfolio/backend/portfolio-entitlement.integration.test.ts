/**
 * Portfolio creation gate and downgrade behavior (Subscription Phase II,
 * IB-4 / IB-5 / IB-7) against a real database, driven by grants.
 *
 * - FREE cannot create a portfolio (`UPGRADE_REQUIRED`); PRO and PRO+ can.
 * - Platform admins pass the interactive gate; a moderator does not.
 * - Losing the capability deletes nothing and writes nothing: the portfolio
 *   stays fully editable by its owner, `visibility` is unchanged, and only
 *   public display goes away. Regaining it restores public display with no
 *   data change.
 * - The role gate (`CREATE_PORTFOLIO`) and the public read path stay
 *   independent of each other.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationCode, type StrictAuthorizationActor } from "@/authorization";
import { PlatformRole } from "@/authorization/platform/roles";
import { PortfolioVisibility } from "@/generated/prisma";
import { ForbiddenError } from "@/lib/errors";
import prisma from "@/lib/prisma";
import {
  deleteGrantsForEmailPrefix,
  insertGrant,
  revokeGrants,
} from "@/testing/entitlement-fixtures";

import { PortfolioNotFoundError } from "../errors";
import { portfolioService } from "./service";

const PREFIX = "__vitest_portfolio_entitlement__";

let counter = 0;
let granterId: string;

async function createUser(name: string, role: string = PlatformRole.USER) {
  counter += 1;
  const id = `${PREFIX}_${name}_${Date.now()}_${counter}`;

  return prisma.user.create({
    data: {
      id,
      name: "Portfolio Entitlement User",
      email: `${id}@example.test`,
      emailVerified: true,
      username: id.toLowerCase(),
      role,
    },
  });
}

function actorFor(userId: string, role: string = PlatformRole.USER): StrictAuthorizationActor {
  return { id: userId, role, banned: false };
}

async function expectUpgradeRequired(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(ForbiddenError);
  expect((error as ForbiddenError).code).toBe(AuthorizationCode.UPGRADE_REQUIRED);
}

beforeAll(async () => {
  granterId = (await createUser("granter")).id;
});

afterAll(async () => {
  await prisma.portfolio.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
  await deleteGrantsForEmailPrefix(PREFIX);
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("PortfolioService.create — entitlement gate", () => {
  it("refuses a FREE user with UPGRADE_REQUIRED and creates nothing", async () => {
    const user = await createUser("free");

    await expectUpgradeRequired(portfolioService.create({ actor: actorFor(user.id) }));

    expect(await prisma.portfolio.count({ where: { userId: user.id } })).toBe(0);
  });

  it("allows a PRO user", async () => {
    const user = await createUser("pro");
    await insertGrant(user.id, granterId, { plan: "PRO" });

    const dto = await portfolioService.create({ actor: actorFor(user.id) });

    expect(dto.visibility).toBe(PortfolioVisibility.PRIVATE);
  });

  it("allows a PRO+ user", async () => {
    const user = await createUser("plus");
    await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });

    await expect(portfolioService.create({ actor: actorFor(user.id) })).resolves.toBeDefined();
  });

  it("refuses a user whose grant has expired, by the clock alone", async () => {
    const user = await createUser("expired");
    await insertGrant(user.id, granterId, {
      plan: "PRO",
      validFrom: new Date(Date.now() - 10 * 86_400_000),
      validUntil: new Date(Date.now() - 1000),
    });

    await expectUpgradeRequired(portfolioService.create({ actor: actorFor(user.id) }));
  });

  it("refuses a user whose grant was revoked", async () => {
    const user = await createUser("revoked");
    await insertGrant(user.id, granterId, { plan: "PRO" });
    await revokeGrants(user.id, granterId);

    await expectUpgradeRequired(portfolioService.create({ actor: actorFor(user.id) }));
  });

  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])(
    "lets a %s create without a grant (interactive bypass, IB-7)",
    async (role) => {
      const admin = await createUser(`admin-${role}`, role);

      await expect(portfolioService.create({ actor: actorFor(admin.id, role) })).resolves.toBeDefined();
    },
  );

  it("does not let a moderator create without a grant", async () => {
    const moderator = await createUser("moderator", PlatformRole.MODERATOR);

    await expectUpgradeRequired(
      portfolioService.create({ actor: actorFor(moderator.id, PlatformRole.MODERATOR) }),
    );
  });

  it("does not make an admin's portfolio publicly visible: display follows the owner's access, not role", async () => {
    const admin = await createUser("admin-public", PlatformRole.ADMIN);
    const actor = actorFor(admin.id, PlatformRole.ADMIN);

    await portfolioService.create({ actor });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    await expect(
      portfolioService.findPublicByUsername({ username: admin.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);
  });
});

describe("Portfolio — downgrade and regrant (SB-DP-01, SB-DP-02)", () => {
  it("keeps the portfolio, its visibility and its editability when access is lost; regaining restores public display with no write", async () => {
    const user = await createUser("downgrade");
    const actor = actorFor(user.id);
    await insertGrant(user.id, granterId, { plan: "PRO" });

    await portfolioService.create({ actor });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });
    await portfolioService.findPublicByUsername({ username: user.username! });

    // Downgrade.
    await revokeGrants(user.id, granterId);

    // Hidden publicly — indistinguishable from "no such portfolio".
    await expect(
      portfolioService.findPublicByUsername({ username: user.username! }),
    ).rejects.toBeInstanceOf(PortfolioNotFoundError);

    // Still there, still the owner's, still editable.
    expect(await portfolioService.findMine({ actor })).not.toBeNull();
    const edited = await portfolioService.updateProfile({
      actor,
      dto: { headline: "Edited after downgrade" },
    });
    expect(edited.headline).toBe("Edited after downgrade");
    expect(edited.visibility).toBe(PortfolioVisibility.PUBLIC);

    // Nothing deleted, `visibility` never written by the entitlement change.
    const during = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
    expect(during.deletedAt).toBeNull();
    expect(during.visibility).toBe(PortfolioVisibility.PUBLIC);

    // The owner may still change visibility (a preference, not a paid action).
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PRIVATE },
    });
    await portfolioService.changeVisibility({
      actor,
      dto: { visibility: PortfolioVisibility.PUBLIC },
    });

    // Regrant: public again, with no other change to the row.
    await insertGrant(user.id, granterId, { plan: "PRO" });

    const dto = await portfolioService.findPublicByUsername({ username: user.username! });
    expect(dto.user.username).toBe(user.username);

    const after = await prisma.portfolio.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.visibility).toBe(PortfolioVisibility.PUBLIC);
    expect(after.headline).toBe("Edited after downgrade");
  });

  it("does not let a downgraded user create a second portfolio, and the existing one still blocks it", async () => {
    const user = await createUser("downgrade-again");
    const actor = actorFor(user.id);
    await insertGrant(user.id, granterId, { plan: "PRO" });
    await portfolioService.create({ actor });

    await revokeGrants(user.id, granterId);

    // The entitlement gate answers first; either way nothing new is created.
    await expectUpgradeRequired(portfolioService.create({ actor }));
    expect(await prisma.portfolio.count({ where: { userId: user.id } })).toBe(1);
  });
});
