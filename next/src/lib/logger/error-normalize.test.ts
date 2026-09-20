import { describe, expect, it } from "vitest";

import { NotFoundError } from "@/lib/errors/not-found-error";
import { ExternalServiceError } from "@/lib/errors/external-service-error";

import { normalizeError } from "./error-normalize";

describe("normalizeError", () => {
  it("extracts code/category/retryable/status from an AppError", () => {
    const error = new NotFoundError({ code: "COMPETITION_NOT_FOUND", message: "Not found" });

    const normalized = normalizeError(error);

    expect(normalized.code).toBe("COMPETITION_NOT_FOUND");
    expect(normalized.category).toBe("resource");
    expect(normalized.retryable).toBe(false);
    expect(normalized.status).toBe(404);
    expect(normalized.message).toBe("Not found");
    expect(normalized.name).toBe("NotFoundError");
  });

  it("defaults retryable per the AppError subclass (ExternalServiceError defaults to true)", () => {
    const error = new ExternalServiceError({ code: "CLOUDINARY_DOWN", message: "Down" });

    expect(normalizeError(error).retryable).toBe(true);
  });

  it("captures a stack for AppError and plain Error alike", () => {
    expect(normalizeError(new NotFoundError({ code: "X", message: "x" })).stack).toBeDefined();
    expect(normalizeError(new Error("plain")).stack).toBeDefined();
  });

  it("normalizes a plain Error without AppError-specific fields", () => {
    const normalized = normalizeError(new Error("boom"));

    expect(normalized.message).toBe("boom");
    expect(normalized.name).toBe("Error");
    expect(normalized.code).toBeUndefined();
    expect(normalized.category).toBeUndefined();
  });

  it("walks a native Error.cause chain", () => {
    const root = new Error("root cause");
    const wrapped = new Error("wrapper", { cause: root });

    const normalized = normalizeError(wrapped);

    expect(normalized.cause?.message).toBe("root cause");
  });

  it("walks an AppError's cause into a normalized shape too", () => {
    const root = new Error("db exploded");
    const error = new ExternalServiceError({ code: "X", message: "wrapped", cause: root });

    expect(normalizeError(error).cause?.message).toBe("db exploded");
  });

  it("degrades a string throw safely", () => {
    const normalized = normalizeError("just a string");

    expect(normalized.message).toBe("just a string");
    expect(normalized.name).toBe("NonErrorThrow");
  });

  it("degrades an arbitrary non-Error object safely, carrying it as raw", () => {
    const normalized = normalizeError({ weird: true });

    expect(normalized.name).toBe("NonErrorThrow");
    expect(normalized.raw).toEqual({ weird: true });
  });

  it("degrades undefined/null safely", () => {
    expect(normalizeError(undefined).name).toBe("NonErrorThrow");
    expect(normalizeError(null).name).toBe("NonErrorThrow");
  });

  it("bounds cause-chain recursion so a pathological chain cannot recurse forever", () => {
    let current = new Error("root");
    for (let i = 0; i < 20; i++) {
      current = new Error(`level ${i}`, { cause: current });
    }

    expect(() => normalizeError(current)).not.toThrow();
  });
});
