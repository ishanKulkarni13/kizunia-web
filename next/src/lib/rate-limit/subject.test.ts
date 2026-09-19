import { describe, expect, it } from "vitest";

import {
  credentialSubject,
  encodeSubjectSegment,
  globalSubject,
  ipSubject,
  resolveSubjectsForStrategies,
  resolveTrustedClientIp,
  subjectFromRequest,
  userSubject,
} from "./subject";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://kizunia.test/api/v1/example", { headers });
}

describe("resolveTrustedClientIp", () => {
  it("prefers x-real-ip when present", () => {
    const request = requestWithHeaders({
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });

    expect(resolveTrustedClientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to the LAST hop of x-forwarded-for, not the first", () => {
    // The first hop is client-controlled (spoofable); the last hop is the
    // one Vercel's edge appends. This is the fix over the prior
    // implementation, which trusted the first (spoofable) hop.
    const request = requestWithHeaders({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.55",
    });

    expect(resolveTrustedClientIp(request)).toBe("203.0.113.55");
  });

  it("handles a single-hop x-forwarded-for", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.1" });

    expect(resolveTrustedClientIp(request)).toBe("203.0.113.1");
  });

  it("handles an IPv6 address without mis-splitting it", () => {
    const request = requestWithHeaders({
      "x-forwarded-for": "2001:db8::1",
    });

    expect(resolveTrustedClientIp(request)).toBe("2001:db8::1");
  });

  it("falls back to 'unknown' when no proxy header is present", () => {
    const request = requestWithHeaders({});

    expect(resolveTrustedClientIp(request)).toBe("unknown");
  });
});

describe("encodeSubjectSegment", () => {
  it("encodes colons so an IPv6 address cannot straddle key boundaries", () => {
    const encoded = encodeSubjectSegment("2001:db8::1");

    expect(encoded).not.toContain(":");
  });

  it("round-trips distinct values to distinct encodings (no collision)", () => {
    const a = encodeSubjectSegment("2001:db8::1");
    const b = encodeSubjectSegment("2001");

    expect(a).not.toBe(b);
  });

  it("leaves an ordinary IPv4 address readable", () => {
    expect(encodeSubjectSegment("203.0.113.5")).toBe("203.0.113.5");
  });
});

describe("subjectFromRequest", () => {
  it("prefers the authenticated user over IP", () => {
    const request = requestWithHeaders({ "x-real-ip": "203.0.113.5" });

    const subject = subjectFromRequest(request, { id: "user_123" });

    expect(subject).toEqual(userSubject("user_123"));
  });

  it("falls back to IP when there is no actor", () => {
    const request = requestWithHeaders({ "x-real-ip": "203.0.113.5" });

    const subject = subjectFromRequest(request, null);

    expect(subject).toEqual(ipSubject("203.0.113.5"));
  });
});

describe("resolveSubjectsForStrategies", () => {
  it("resolves one subject per strategy, in order", () => {
    const request = requestWithHeaders({ "x-real-ip": "203.0.113.5" });

    const subjects = resolveSubjectsForStrategies(["ip", "credential"], {
      request,
      credential: "person@example.com",
    });

    expect(subjects).toEqual([
      ipSubject("203.0.113.5"),
      credentialSubject("person@example.com"),
    ]);
  });

  it("resolves 'global' without needing a request", () => {
    const subjects = resolveSubjectsForStrategies(["global"], {});

    expect(subjects).toEqual([globalSubject()]);
  });

  it("resolves 'user' without needing a request", () => {
    const subjects = resolveSubjectsForStrategies(["user"], {
      actor: { id: "user_42" },
    });

    expect(subjects).toEqual([userSubject("user_42")]);
  });

  it("throws when 'user' is configured but no actor is provided", () => {
    expect(() => resolveSubjectsForStrategies(["user"], {})).toThrow();
  });

  it("throws when 'credential' is configured but none is provided", () => {
    expect(() =>
      resolveSubjectsForStrategies(["credential"], {}),
    ).toThrow();
  });

  it("throws when 'ip' is configured but no request is provided", () => {
    expect(() => resolveSubjectsForStrategies(["ip"], {})).toThrow();
  });

  it("normalizes credential casing and whitespace", () => {
    const subjects = resolveSubjectsForStrategies(["credential"], {
      credential: "  Person@Example.com  ",
    });

    expect(subjects).toEqual([credentialSubject("person@example.com")]);
  });
});
