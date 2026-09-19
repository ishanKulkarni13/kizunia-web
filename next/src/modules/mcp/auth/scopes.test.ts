import { describe, expect, it } from "vitest";

import { McpScope, isMcpScope, parseGrantedScopes } from "./scopes";

describe("isMcpScope", () => {
  it("recognises every declared capability scope", () => {
    expect(isMcpScope(McpScope.COMPETITIONS_READ)).toBe(true);
    expect(isMcpScope(McpScope.COMPETITIONS_WRITE)).toBe(true);
  });

  it("rejects identity scopes and unknown strings", () => {
    expect(isMcpScope("openid")).toBe(false);
    expect(isMcpScope("profile")).toBe(false);
    expect(isMcpScope("admin:everything")).toBe(false);
    expect(isMcpScope("")).toBe(false);
  });
});

describe("parseGrantedScopes", () => {
  it("returns an empty set for null/undefined/empty input", () => {
    expect(parseGrantedScopes(null).size).toBe(0);
    expect(parseGrantedScopes(undefined).size).toBe(0);
    expect(parseGrantedScopes("").size).toBe(0);
  });

  it("parses a space-separated scope string, ignoring identity scopes", () => {
    const granted = parseGrantedScopes("openid profile competitions:read");

    expect(granted.has(McpScope.COMPETITIONS_READ)).toBe(true);
    expect(granted.size).toBe(1);
  });

  it("parses every declared capability scope", () => {
    const granted = parseGrantedScopes("competitions:read competitions:write");

    expect(granted.has(McpScope.COMPETITIONS_READ)).toBe(true);
    expect(granted.has(McpScope.COMPETITIONS_WRITE)).toBe(true);
    expect(granted.size).toBe(2);
  });

  it("tolerates a comma-separated scope string", () => {
    const granted = parseGrantedScopes("competitions:read,competitions:write");

    expect(granted.size).toBe(2);
  });

  it("silently discards unknown scope strings rather than throwing", () => {
    const granted = parseGrantedScopes("competitions:read totally:unknown");

    expect(granted.has(McpScope.COMPETITIONS_READ)).toBe(true);
    expect(granted.size).toBe(1);
  });

  it("never grants a write scope from a malformed/partial match", () => {
    const granted = parseGrantedScopes("competitions:writex");

    expect(granted.has(McpScope.COMPETITIONS_WRITE)).toBe(false);
    expect(granted.size).toBe(0);
  });
});
