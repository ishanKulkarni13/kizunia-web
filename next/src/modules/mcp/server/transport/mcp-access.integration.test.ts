/**
 * MCP subscription gate (Subscription Phase II) against a real database, with
 * the REAL entitlement resolver and real grants.
 *
 * Only two things are faked, both upstream of the gate: the access-token to
 * actor step (`buildMcpRequestContext`, whose own behavior has its own unit
 * tests) and the tool registry (so no domain tool needs data). Everything the
 * gate touches — dispatch, `McpAccess`, `AuthorizationEvaluator`, the rate
 * limiter, `lib/entitlements`, the database — is real.
 *
 * Proves: Free and Pro are refused with `UPGRADE_REQUIRED`, Pro+ is allowed,
 * platform admins pass (interactive bypass, IB-7), a downgrade takes effect
 * on the very next call while the token stays valid, and a re-grant restores
 * access with nothing to reconnect.
 *
 * Requires a reachable test database — see docs/testing/database.md.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { OAuthAccessToken } from "better-auth/plugins";

const { contextFor, echoTool } = vi.hoisted(() => ({
  contextFor: { current: null as null | { userId: string; role: string } },
  echoTool: {
    name: "echo",
    description: "Echoes its input.",
    inputSchema: undefined as unknown,
    rateLimitPolicy: undefined as unknown,
    execute: undefined as unknown,
  },
}));

vi.mock("../context/build-request-context", () => ({
  buildMcpRequestContext: vi.fn(async () => ({
    principal: {
      userId: contextFor.current!.userId,
      clientId: "client-1",
      grantedScopes: new Set(),
    },
    actor: { id: contextFor.current!.userId, role: contextFor.current!.role, banned: false },
    requestId: "req-1",
  })),
}));

vi.mock("../../tools/registry", () => ({
  MCP_TOOLS: new Map([["echo", echoTool]]),
}));

import { PlatformRole } from "@/authorization/platform/roles";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import prisma from "@/lib/prisma";
import {
  deleteGrantsForUsers,
  insertGrant,
  revokeGrants,
} from "@/testing/entitlement-fixtures";

Object.assign(echoTool, {
  inputSchema: z.object({ value: z.string() }),
  rateLimitPolicy: RateLimitPolicyId.MCP_TOOLS_READ,
  execute: vi.fn(async (_context: unknown, input: { value: string }) => ({ echoed: input.value })),
});

import { dispatchMcpRequest } from "./dispatch";

const PREFIX = "__vitest_mcp_access__";
let counter = 0;
let granterId: string;

async function createUser(name: string, role: string = PlatformRole.USER) {
  counter += 1;
  const id = `${PREFIX}_${name}_${Date.now()}_${counter}`;
  await prisma.user.create({ data: { id, name: "MCP Access User", email: `${id}@example.test`, role } });
  return { id, role };
}

function token(userId: string): OAuthAccessToken {
  return {
    accessToken: "t",
    refreshToken: "r",
    accessTokenExpiresAt: new Date(Date.now() + 60_000),
    refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    clientId: "client-1",
    userId,
    scopes: "competitions:read",
  };
}

async function call(user: { id: string; role: string }, accessToken = token(user.id)) {
  contextFor.current = { userId: user.id, role: user.role };

  const response = await dispatchMcpRequest(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { value: "hi" } } },
    accessToken,
  );

  if (!("result" in response)) throw new Error("expected a JSON-RPC result");
  const result = response.result as { isError?: boolean; content: Array<{ text: string }> };

  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) as Record<string, unknown> };
}

async function list(user: { id: string; role: string }) {
  contextFor.current = { userId: user.id, role: user.role };

  const response = await dispatchMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, token(user.id));

  if (!("result" in response)) throw new Error("expected a JSON-RPC result");
  return (response.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } });
  await deleteGrantsForUsers(users.map((user) => user.id));
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: PREFIX } } });
}

beforeEach(async () => {
  await cleanup();
  granterId = (await createUser("granter")).id;
  vi.mocked(echoTool.execute as ReturnType<typeof vi.fn>).mockClear();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("MCP subscription gate — real grants", () => {
  it("refuses a FREE user with UPGRADE_REQUIRED and never runs the tool", async () => {
    const user = await createUser("free");

    const { isError, body } = await call(user);

    expect(isError).toBe(true);
    expect(body.code).toBe("UPGRADE_REQUIRED");
    expect(echoTool.execute).not.toHaveBeenCalled();
  });

  it("refuses a PRO user (MCP is Pro+)", async () => {
    const user = await createUser("pro");
    await insertGrant(user.id, granterId, { plan: "PRO" });

    expect((await call(user)).body.code).toBe("UPGRADE_REQUIRED");
    expect(echoTool.execute).not.toHaveBeenCalled();
  });

  it("allows a PRO_PLUS user", async () => {
    const user = await createUser("plus");
    await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });

    const { isError, body } = await call(user);

    expect(isError).toBe(false);
    expect(body).toEqual({ echoed: "hi" });
  });

  it.each([PlatformRole.ADMIN, PlatformRole.SUPER_ADMIN])(
    "allows a platform %s without any grant (interactive bypass, IB-7)",
    async (role) => {
      const admin = await createUser(`admin-${role}`, role);

      expect((await call(admin)).isError).toBe(false);
    },
  );

  it("does not let a moderator through without a grant", async () => {
    const moderator = await createUser("moderator", PlatformRole.MODERATOR);

    expect((await call(moderator)).body.code).toBe("UPGRADE_REQUIRED");
  });

  it("applies a downgrade on the very next call with the same token, and a re-grant restores access", async () => {
    const user = await createUser("downgrade");
    await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });
    const accessToken = token(user.id);
    const snapshot = structuredClone(accessToken);

    expect((await call(user, accessToken)).isError).toBe(false);

    await revokeGrants(user.id, granterId);
    expect((await call(user, accessToken)).body.code).toBe("UPGRADE_REQUIRED");

    await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });
    expect((await call(user, accessToken)).isError).toBe(false);

    // The connection itself was never touched: the same token worked before,
    // during and after, and was not modified.
    expect(accessToken).toEqual(snapshot);
  });

  it("follows an expired grant by the clock alone", async () => {
    const user = await createUser("expired");
    const grant = await insertGrant(user.id, granterId, { plan: "PRO_PLUS" });

    expect((await call(user)).isError).toBe(false);

    await prisma.entitlementGrant.update({
      where: { id: grant.id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });

    expect((await call(user)).body.code).toBe("UPGRADE_REQUIRED");
  });

  it("lists tools only to actors who can call them", async () => {
    const free = await createUser("list-free");
    const plus = await createUser("list-plus");
    const admin = await createUser("list-admin", PlatformRole.ADMIN);
    await insertGrant(plus.id, granterId, { plan: "PRO_PLUS" });

    expect(await list(free)).toEqual([]);
    expect(await list(plus)).toEqual(["echo"]);
    expect(await list(admin)).toEqual(["echo"]);
  });

  it("keeps the rate limit in front of the gate: a refused call still spends the tool's read budget", async () => {
    const user = await createUser("ratelimit");

    // If the gate ran before (or instead of) the limiter, a refused call would
    // leave no trace in the tool's budget. Counting rows, not exhausting the
    // window, keeps this deterministic across a window boundary.
    const spent = () =>
      prisma.rateLimit.findMany({ where: { key: { contains: user.id } } }).then((rows) =>
        rows.reduce((total, row) => total + row.count, 0),
      );

    expect(await spent()).toBe(0);

    expect((await call(user)).body.code).toBe("UPGRADE_REQUIRED");
    expect((await call(user)).body.code).toBe("UPGRADE_REQUIRED");

    expect(await spent()).toBe(2);
  });
});
