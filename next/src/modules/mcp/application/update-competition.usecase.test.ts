import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformRole } from "@/authorization/platform/roles";
import { CompetitionVisibility } from "@/generated/prisma";
import { ForbiddenError, ValidationError } from "@/lib/errors";

import { McpScopeError } from "../errors/mcp-error";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";

const resolveBySlugMock = vi.fn();
const serviceUpdateMock = vi.fn();

vi.mock("@/modules/competitions/backend/authorization/context-resolver", () => ({
  CompetitionContextResolver: {
    resolveBySlug: (...args: unknown[]) => resolveBySlugMock(...args),
  },
}));

vi.mock("@/modules/competitions/backend/service", () => ({
  CompetitionService: {
    update: (...args: unknown[]) => serviceUpdateMock(...args),
  },
}));

 
import { UpdateCompetitionUseCase } from "./update-competition.usecase";

function contextFor(role: string, actorId = "user-1"): McpRequestContext {
  return {
    principal: {
      userId: actorId,
      clientId: "client-1",
      grantedScopes: new Set([McpScope.COMPETITIONS_WRITE]),
    },
    actor: { id: actorId, role, banned: false },
    requestId: "req-1",
  };
}

const TARGET_COMPETITION = {
  id: "comp-1",
  slug: "hack-the-future",
  visibility: CompetitionVisibility.PRIVATE,
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  serviceUpdateMock.mockResolvedValue({ ...TARGET_COMPETITION, prizePool: "$5,000" });
});

describe("UpdateCompetitionUseCase — MCP scope gate", () => {
  it("refuses without the write scope before any lookup happens", async () => {
    const context: McpRequestContext = {
      ...contextFor(PlatformRole.SUPER_ADMIN),
      principal: {
        userId: "user-1",
        clientId: "client-1",
        grantedScopes: new Set([McpScope.COMPETITIONS_READ]),
      },
    };

    await expect(
      UpdateCompetitionUseCase.execute(context, {
        target: { slug: "hack-the-future" },
        patch: { prizePool: "$5,000" },
      }),
    ).rejects.toBeInstanceOf(McpScopeError);

    expect(resolveBySlugMock).not.toHaveBeenCalled();
  });
});

describe("UpdateCompetitionUseCase — input validation", () => {
  it("rejects an empty patch before resolving the competition", async () => {
    const context = contextFor(PlatformRole.SUPER_ADMIN);

    await expect(
      UpdateCompetitionUseCase.execute(context, {
        target: { slug: "hack-the-future" },
        patch: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(resolveBySlugMock).not.toHaveBeenCalled();
  });
});

describe("UpdateCompetitionUseCase — Kizunia authorization (real policy chain)", () => {
  it("SUPER_ADMIN can update a competition they are not a member of (platform override)", async () => {
    resolveBySlugMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.SUPER_ADMIN, banned: false },
      competition: TARGET_COMPETITION,
      membership: null,
    });

    const context = contextFor(PlatformRole.SUPER_ADMIN);

    const result = await UpdateCompetitionUseCase.execute(context, {
      target: { slug: "hack-the-future" },
      patch: { prizePool: "$5,000" },
    });

    expect(serviceUpdateMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ prizePool: "$5,000" });
  });

  it("denies an ordinary USER with no membership on the target (IDOR guard)", async () => {
    // A different, unrelated user attempting to edit someone else's
    // competition purely by knowing its slug.
    resolveBySlugMock.mockResolvedValueOnce({
      actor: { id: "attacker-1", role: PlatformRole.USER, banned: false },
      competition: TARGET_COMPETITION,
      membership: null,
    });

    const context = contextFor(PlatformRole.USER, "attacker-1");

    await expect(
      UpdateCompetitionUseCase.execute(context, {
        target: { slug: "hack-the-future" },
        patch: { prizePool: "$999,999" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it("allows a MAINTAINER member to edit the competition they belong to", async () => {
    resolveBySlugMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: false },
      competition: TARGET_COMPETITION,
      membership: { role: "MAINTAINER" },
    });

    const context = contextFor(PlatformRole.USER);

    await UpdateCompetitionUseCase.execute(context, {
      target: { slug: "hack-the-future" },
      patch: { prizePool: "$5,000" },
    });

    expect(serviceUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("denies a banned member even with an OWNER membership", async () => {
    resolveBySlugMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: true },
      competition: TARGET_COMPETITION,
      membership: { role: "OWNER" },
    });

    const context = contextFor(PlatformRole.USER);

    await expect(
      UpdateCompetitionUseCase.execute(context, {
        target: { slug: "hack-the-future" },
        patch: { prizePool: "$5,000" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies editing a soft-deleted competition for a non-admin member", async () => {
    // `platformOverride()` runs before the deleted-competition check, so
    // SUPER_ADMIN's bypass is intentionally absolute (see
    // `CompetitionAction.RESTORE`'s docstring); the deleted-row guard is
    // what protects an ordinary OWNER/MAINTAINER from managing a
    // soft-deleted row they still have a membership on.
    resolveBySlugMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: false },
      competition: { ...TARGET_COMPETITION, deletedAt: new Date() },
      membership: { role: "OWNER" },
    });

    const context = contextFor(PlatformRole.USER);

    await expect(
      UpdateCompetitionUseCase.execute(context, {
        target: { slug: "hack-the-future" },
        patch: { prizePool: "$5,000" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
