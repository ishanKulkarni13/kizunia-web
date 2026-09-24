/**
 * A push click acknowledges its notification in the service worker, not in the
 * page it opens (#93).
 *
 * The competition page is statically revalidated and served from the CDN. The
 * moment it learned which notification opened it, it would have to vary per
 * request — per user, and per session — and the cache would be gone. So the
 * boundary is checked, not just intended: the page and everything beside it
 * must stay ignorant of notifications, and must stay revalidated rather than
 * forced dynamic.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PAGE_DIR = path.join(
  process.cwd(),
  "src",
  "app",
  "(dashboard)",
  "(competition)",
  "competitions",
  "[slug]",
);

const sources = readdirSync(PAGE_DIR)
  .filter((file) => /\.(ts|tsx)$/.test(file))
  .map((file) => ({
    file,
    text: readFileSync(path.join(PAGE_DIR, file), "utf8"),
  }));

describe("competition page stays notification-agnostic", () => {
  it("finds the route's sources", () => {
    expect(sources.map((s) => s.file)).toContain("page.tsx");
  });

  it.each(sources)("$file does not mention notifications", ({ text }) => {
    expect(text).not.toMatch(/notification/i);
  });

  it("stays statically revalidated instead of becoming per-request", () => {
    const page = sources.find((s) => s.file === "page.tsx")!.text;

    expect(page).toMatch(/export const revalidate = \d+/);
    expect(page).not.toMatch(/force-dynamic/);
    expect(page).not.toMatch(/from "next\/headers"/);
    expect(page).not.toMatch(/\bcookies\(\)/);
  });
});
