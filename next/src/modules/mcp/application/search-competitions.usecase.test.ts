import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpScopeError } from "../errors/mcp-error";
import { McpScope } from "../auth/scopes";
import type { McpRequestContext } from "../server/context/request-context";

const searchMock = vi.fn();

vi.mock("@/modules/competitions/backend/service", () => ({
  CompetitionService: {
    search: (...args: unknown[]) => searchMock(...args),
  },
}));

 
import { SearchCompetitionsUseCase } from "./search-competitions.usecase";

function contextWithScopes(scopes: McpScope[]): McpRequestContext {
  return {
    principal: { userId: "user-1", clientId: "client-1", grantedScopes: new Set(scopes) },
    actor: { id: "user-1", role: "user", banned: false },
    requestId: "req-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  searchMock.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } });
});

describe("SearchCompetitionsUseCase", () => {
  it("refuses without the read scope", async () => {
    const context = contextWithScopes([]);

    await expect(SearchCompetitionsUseCase.execute(context, {})).rejects.toBeInstanceOf(
      McpScopeError,
    );
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("translates structured input into RawSearchParams and delegates to CompetitionService.search", async () => {
    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    await SearchCompetitionsUseCase.execute(context, {
      query: "hackathon",
      modes: ["ONLINE"],
      page: 2,
      limit: 10,
    });

    expect(searchMock).toHaveBeenCalledWith({
      search: "hackathon",
      modes: "ONLINE",
      page: "2",
      limit: "10",
    });
  });

  it("omits filters that were not supplied", async () => {
    const context = contextWithScopes([McpScope.COMPETITIONS_READ]);

    await SearchCompetitionsUseCase.execute(context, {});

    expect(searchMock).toHaveBeenCalledWith({});
  });
});
