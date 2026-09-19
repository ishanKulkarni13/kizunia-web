import { describe, expect, it } from "vitest";

import {
  rateLimitErrorHeaders,
  rateLimitHeaders,
  rateLimitRejectionHeaders,
} from "./headers";

describe("rateLimitHeaders", () => {
  it("renders the three standard success headers", () => {
    expect(
      rateLimitHeaders({ limit: 30, remaining: 12, resetSeconds: 45 }),
    ).toEqual({
      "RateLimit-Limit": "30",
      "RateLimit-Remaining": "12",
      "RateLimit-Reset": "45",
    });
  });
});

describe("rateLimitRejectionHeaders", () => {
  it("adds Retry-After on top of the standard headers", () => {
    const headers = rateLimitRejectionHeaders({
      limit: 30,
      remaining: 0,
      resetSeconds: 12,
    });

    expect(headers["Retry-After"]).toBe("12");
    expect(headers["RateLimit-Limit"]).toBe("30");
    expect(headers["RateLimit-Remaining"]).toBe("0");
    expect(headers["RateLimit-Reset"]).toBe("12");
  });
});

describe("rateLimitErrorHeaders", () => {
  it("renders every header when the error carries full info", () => {
    const headers = rateLimitErrorHeaders({
      retryAfterSeconds: 7,
      limit: 10,
      remaining: 0,
    });

    expect(headers).toEqual({
      "Retry-After": "7",
      "RateLimit-Reset": "7",
      "RateLimit-Limit": "10",
      "RateLimit-Remaining": "0",
    });
  });

  it("tolerates an error with only retryAfterSeconds set", () => {
    const headers = rateLimitErrorHeaders({ retryAfterSeconds: 5 });

    expect(headers).toEqual({ "Retry-After": "5", "RateLimit-Reset": "5" });
  });

  it("returns an empty object for an error with no rate-limit fields", () => {
    expect(rateLimitErrorHeaders({})).toEqual({});
  });
});
