import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isReservedUsername, RESERVED_USERNAMES } from "./reserved-usernames";
import { usernameSchema } from "./validation";

const PORTFOLIO_API_DIR = join(process.cwd(), "src/app/api/v1/portfolio");

const APP_DIR = join(process.cwd(), "src/app");

/** Directory names in `dir` that are real URL segments (no route groups,
 * no dynamic segments, no private folders). */
function staticSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        !name.startsWith("(") &&
        !name.startsWith("[") &&
        !name.startsWith("_") &&
        !name.startsWith("@"),
    );
}

describe("reserved usernames", () => {
  it("rejects each reserved name, in any case", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(isReservedUsername(name)).toBe(true);
      expect(isReservedUsername(name.toUpperCase())).toBe(true);
    }

    // The case that motivated normalising: Better Auth validates the
    // username as typed, so a literal comparison let this through.
    expect(isReservedUsername("Admin")).toBe(true);
  });

  it("does not reserve ordinary usernames", () => {
    for (const name of ["ada", "sara_chen", "aisha.p", "user123", "meow"]) {
      expect(isReservedUsername(name)).toBe(false);
    }
  });

  it("only lists names that could otherwise pass username validation", () => {
    // A reserved entry that usernameSchema already rejects is dead weight
    // and hides which names genuinely needed protecting.
    for (const name of RESERVED_USERNAMES) {
      expect(usernameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it("reserves every static segment beside api/v1/portfolio/[username]", () => {
    // A static sibling of a dynamic segment wins, so a user with that name
    // could never have their portfolio resolved. Adding a route here without
    // reserving it fails this test.
    const segments = staticSegments(PORTFOLIO_API_DIR);

    expect(segments.length).toBeGreaterThan(0);

    for (const segment of segments) {
      if (!usernameSchema.safeParse(segment).success) continue;

      expect(isReservedUsername(segment), segment).toBe(true);
    }
  });

  it("reserves every top-level route segment that a username could collide with", () => {
    for (const segment of staticSegments(APP_DIR)) {
      if (!usernameSchema.safeParse(segment).success) continue;

      expect(isReservedUsername(segment), segment).toBe(true);
    }
  });

  it("needs no entry for the public page prefix: `u` cannot be a username", () => {
    // `/u/[username]` lives under its own prefix, so nothing beside it can
    // collide; and `u` itself is too short to be registered.
    expect(usernameSchema.safeParse("u").success).toBe(false);
  });
});
