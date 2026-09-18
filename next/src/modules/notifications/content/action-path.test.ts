import { describe, expect, it } from "vitest";

import {
  competitionPath,
  isSafeActionPath,
  safeActionPathOrNull,
} from "./action-path";

describe("isSafeActionPath", () => {
  it.each([
    "/competitions/ai-hackathon-2026",
    "/user/notifications",
    "/",
    "/competitions/x?from=notification",
    "/competitions/x#details",
  ])("accepts the site-relative path %s", (value) => {
    expect(isSafeActionPath(value)).toBe(true);
  });

  it.each([
    // Absolute URLs leave the site entirely.
    "https://evil.example/login",
    "http://evil.example",
    // Protocol-relative: a browser reads this as a host, not a path.
    "//evil.example",
    // Backslash variants several browsers normalise into a host.
    "/\\evil.example",
    "\\\\evil.example",
    // Script and data schemes.
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    // Unrooted, so it resolves differently depending on the current page.
    "competitions/x",
    // Traversal.
    "/../../etc/passwd",
    // A scheme smuggled into the first segment.
    "/javascript:alert(1)",
    // Whitespace and control characters.
    "/competitions/ x",
    "/competitions/\nx",
  ])("rejects %s", (value) => {
    expect(isSafeActionPath(value)).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isSafeActionPath("")).toBe(false);
  });
});

describe("safeActionPathOrNull", () => {
  it("passes a safe path through", () => {
    expect(safeActionPathOrNull("/competitions/x")).toBe("/competitions/x");
  });

  it("returns null for anything unsafe rather than throwing", () => {
    // Callers building paths from internal data use this as a last assertion;
    // losing a link is strictly better than storing an off-site one.
    expect(safeActionPathOrNull("https://evil.example")).toBeNull();
  });

  it("treats absent input as absent, not as an error", () => {
    expect(safeActionPathOrNull(null)).toBeNull();
    expect(safeActionPathOrNull(undefined)).toBeNull();
    expect(safeActionPathOrNull("")).toBeNull();
  });
});

describe("competitionPath", () => {
  it("produces a path the validator accepts", () => {
    const path = competitionPath("ai-hackathon-2026");

    expect(path).toBe("/competitions/ai-hackathon-2026");
    expect(isSafeActionPath(path)).toBe(true);
  });
});
