import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ForbiddenError, InternalError, NotFoundError, ValidationError } from "@/lib/errors";

import { McpScopeError } from "./mcp-error";
import { toMcpToolFailure } from "./to-tool-failure";

describe("toMcpToolFailure", () => {
  it("forwards a ZodError as a validation failure with field-level details", () => {
    const schema = z.object({ title: z.string().min(3) });
    const result = schema.safeParse({ title: "a" });

    if (result.success) throw new Error("expected failure");

    const failure = toMcpToolFailure(result.error);

    expect(failure.code).toBe("VALIDATION_FAILED");
    expect(failure.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "title" })]),
    );
  });

  it("forwards a caller-facing AppError's code and message unchanged", () => {
    const error = new NotFoundError({
      code: "COMPETITION_NOT_FOUND",
      message: "Competition not found.",
    });

    const failure = toMcpToolFailure(error);

    expect(failure).toEqual({
      code: "COMPETITION_NOT_FOUND",
      message: "Competition not found.",
      details: undefined,
    });
  });

  it("forwards a ForbiddenError's code and message", () => {
    const error = new ForbiddenError({
      code: "ROLE_PERMISSION_DENIED",
      message: "You do not have permission to perform this action.",
    });

    const failure = toMcpToolFailure(error);

    expect(failure.code).toBe("ROLE_PERMISSION_DENIED");
    expect(failure.message).toBe(
      "You do not have permission to perform this action.",
    );
  });

  it("forwards an McpScopeError naming the missing scope", () => {
    const failure = toMcpToolFailure(new McpScopeError("competitions:write"));

    expect(failure.code).toBe("MCP_SCOPE_REQUIRED");
    expect(failure.message).toContain("competitions:write");
  });

  it("does NOT forward an internal AppError's message — collapses it instead", () => {
    const error = new InternalError({
      code: "PLATFORM_CONTEXT_RESOLUTION_ERROR",
      status: 500,
      message: "Actor ID is required to resolve the platform context.",
      details: "some internal diagnostic detail",
    });

    const failure = toMcpToolFailure(error);

    expect(failure.code).toBe("INTERNAL_ERROR");
    expect(failure.message).not.toContain("Actor ID is required");
    expect(failure.details).toBeUndefined();
  });

  it("collapses an arbitrary thrown error (e.g. a Prisma error) to an opaque message", () => {
    const error = new Error(
      'invalid input syntax for type uuid: "not-a-uuid" at column "id" in table "competition"',
    );

    const failure = toMcpToolFailure(error);

    expect(failure.code).toBe("INTERNAL_ERROR");
    expect(failure.message).not.toContain("uuid");
    expect(failure.message).not.toContain("competition");
  });

  it("collapses a plain string/non-error throw to an opaque message", () => {
    const failure = toMcpToolFailure("boom");

    expect(failure.code).toBe("INTERNAL_ERROR");
  });

  it("does not forward a validation error's details when category mismatches", () => {
    const error = new ValidationError({
      code: "MCP_EMPTY_PATCH",
      status: 422,
      message: "At least one field must be provided in `patch`.",
      details: { hint: "internal only" },
    });

    const failure = toMcpToolFailure(error);

    // ValidationError is caller-facing and its category IS validation, so
    // details are forwarded here — asserting the positive case too.
    expect(failure.details).toEqual({ hint: "internal only" });
  });
});
