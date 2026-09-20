import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformRole } from "@/authorization/platform/roles";
import { ForbiddenError } from "@/lib/errors";

import { McpScopeError } from "../errors/mcp-error";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";

/**
 * This test exercises the REAL `PlatformAuthorizer` / `PlatformPolicy` /
 * `CompetitionAuthorizer` / `CompetitionPolicy` chain — the whole point of
 * the use case is that it defers to Kizunia's existing authorization rather
 * than reimplementing it, so the test has to prove that chain actually runs
 * and actually decides, not just that some function was called.
 *
 * Only the database-touching leaves are mocked: the two context resolvers
 * (`PlatformContextResolver`/`CompetitionContextResolver` — each already has
 * its own tests and does nothing but a couple of `prisma` reads) and
 * `CompetitionService`'s mutating methods (which need a real Postgres
 * connection and are covered by the module's own
 * `*.integration.test.ts` suite already).
 */

const platformResolveMock = vi.fn();
const competitionResolveMock = vi.fn();
const serviceCreateMock = vi.fn();
const serviceUpdateMock = vi.fn();

vi.mock("@/authorization/platform/resolver", () => ({
  PlatformContextResolver: {
    resolve: (...args: unknown[]) => platformResolveMock(...args),
  },
}));

vi.mock("@/modules/competitions/backend/authorization/context-resolver", () => ({
  CompetitionContextResolver: {
    resolve: (...args: unknown[]) => competitionResolveMock(...args),
  },
}));

vi.mock("@/modules/competitions/backend/service", () => ({
  CompetitionService: {
    create: (...args: unknown[]) => serviceCreateMock(...args),
    update: (...args: unknown[]) => serviceUpdateMock(...args),
  },
}));

 
import { CreateCompetitionUseCase } from "./create-competition.usecase";

function contextFor(role: string, scopes: McpScope[] = [McpScope.COMPETITIONS_WRITE]): McpRequestContext {
  return {
    principal: {
      userId: "user-1",
      clientId: "client-1",
      grantedScopes: new Set(scopes),
    },
    actor: { id: "user-1", role, banned: false },
    requestId: "req-1",
  };
}

const CREATED_COMPETITION = {
  id: "comp-1",
  slug: "hack-the-future",
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  platformResolveMock.mockImplementation(async (actor: { id: string; role: string; banned: boolean }) => ({
    actor,
  }));

  competitionResolveMock.mockResolvedValue({
    actor: { id: "user-1", role: "superadmin", banned: false },
    competition: CREATED_COMPETITION,
    membership: null,
  });

  serviceCreateMock.mockResolvedValue(CREATED_COMPETITION);
  serviceUpdateMock.mockResolvedValue({ ...CREATED_COMPETITION, title: "Hack the Future" });
});

describe("CreateCompetitionUseCase — MCP scope gate", () => {
  it("refuses before touching the domain when the token lacks competitions:write", async () => {
    const context = contextFor(PlatformRole.SUPER_ADMIN, [McpScope.COMPETITIONS_READ]);

    await expect(
      CreateCompetitionUseCase.execute(context, { title: "Hack the Future" }),
    ).rejects.toBeInstanceOf(McpScopeError);

    expect(platformResolveMock).not.toHaveBeenCalled();
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });
});

describe("CreateCompetitionUseCase — Kizunia authorization (real policy chain)", () => {
  it("SUPER_ADMIN with the write scope succeeds and reaches CompetitionService", async () => {
    const context = contextFor(PlatformRole.SUPER_ADMIN);

    const result = await CreateCompetitionUseCase.execute(context, {
      title: "Hack the Future",
    });

    expect(serviceCreateMock).toHaveBeenCalledTimes(1);
    expect(serviceUpdateMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ...CREATED_COMPETITION, title: "Hack the Future" });
  });

  it("an ordinary USER holding the write scope is still denied by PlatformPolicy", async () => {
    const context = contextFor(PlatformRole.USER);

    await expect(
      CreateCompetitionUseCase.execute(context, { title: "Hack the Future" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The scope check passed; the domain WAS reached and it was Kizunia's
    // own authorization — not the MCP layer — that refused.
    expect(platformResolveMock).toHaveBeenCalledTimes(1);
    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("a banned SUPER_ADMIN is denied (ACCOUNT_BANNED short-circuits the platform override)", async () => {
    platformResolveMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.SUPER_ADMIN, banned: true },
    });

    const context = contextFor(PlatformRole.SUPER_ADMIN);

    await expect(
      CreateCompetitionUseCase.execute(context, { title: "Hack the Future" }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(serviceCreateMock).not.toHaveBeenCalled();
  });

  it("re-reads the actor from the database rather than trusting context.actor.role", async () => {
    // The MCP request context claims SUPER_ADMIN (as if a stale/forged
    // token said so), but the freshly-resolved platform context says USER.
    // The real, current role must win.
    const context = contextFor(PlatformRole.SUPER_ADMIN);

    platformResolveMock.mockResolvedValueOnce({
      actor: { id: "user-1", role: PlatformRole.USER, banned: false },
    });

    await expect(
      CreateCompetitionUseCase.execute(context, { title: "Hack the Future" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
