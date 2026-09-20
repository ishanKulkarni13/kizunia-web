import { beforeEach, describe, expect, it, vi } from "vitest";

import { CompetitionNotFoundError } from "@/modules/competitions/errors";

import { McpScopeError } from "../errors/mcp-error";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";

const findPublicBySlugMock = vi.fn();

vi.mock("@/modules/competitions/backend/service", () => ({
  CompetitionService: {
    findPublicBySlug: (...args: unknown[]) => findPublicBySlugMock(...args),
  },
}));

 
import { GetCompetitionUseCase } from "./get-competition.usecase";

function contextWithScopes(scopes: McpScope[]): McpRequestContext {
  return {
    principal: { userId: "user-1", clientId: "client-1", grantedScopes: new Set(scopes) },
    actor: { id: "user-1", role: "user", banned: false },
    requestId: "req-1",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("GetCompetitionUseCase", () => {
  it("refuses without the read scope", async () => {
    const context = contextWithScopes([]);

    await expect(
      GetCompetitionUseCase.execute(context, { slug: "hack-the-future" }),
    ).rejects.toBeInstanceOf(McpScopeError);
    expect(findPublicBySlugMock).not.toHaveBeenCalled();
  });

  it("returns the competition when found", async () => {
    const competition = { id: "comp-1", slug: "hack-the-future" };
    findPublicBySlugMock.mockResolvedValueOnce(competition);

    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    const result = await GetCompetitionUseCase.execute(context, {
      slug: "hack-the-future",
    });

    expect(result).toBe(competition);
    expect(findPublicBySlugMock).toHaveBeenCalledWith("hack-the-future");
  });

  it("throws CompetitionNotFoundError when the service returns null (not found, or PRIVATE to this caller)", async () => {
    findPublicBySlugMock.mockResolvedValueOnce(null);

    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    await expect(
      GetCompetitionUseCase.execute(context, { slug: "does-not-exist" }),
    ).rejects.toBeInstanceOf(CompetitionNotFoundError);
  });
});
