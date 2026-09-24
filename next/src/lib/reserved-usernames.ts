/**
 * Usernames nobody may take, because a username is a URL path segment and
 * these already mean something else there.
 *
 * A Portfolio lives at `/api/v1/portfolio/[username]` (and its public page at
 * `/u/[username]`). A static sibling of a dynamic segment always wins, so a
 * user named `projects` could never have their portfolio resolved: the
 * request would land on the projects route instead. Reserving the names keeps
 * the namespace unambiguous *before* the public page exists.
 *
 * This is the single list. `usernameValidator` in lib/auth.ts consults it —
 * it is the same Better Auth validation path every username write goes
 * through, not a second username system — and a test fails if a new static
 * segment appears beside `[username]` without being added here.
 *
 * Only names that can actually pass `usernameSchema` (letters, digits, `.`,
 * `_`, 3–30 characters) belong here: `sign-in` or `.well-known` can never be
 * usernames, so listing them would only add noise. The public page prefix `u`
 * is too short to be one for the same reason, so `/u/[username]` needs no
 * entry.
 *
 * Existing accounts that already hold one of these names are not migrated.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Static segments beside `api/v1/portfolio/[username]`. (`me` is another,
  // but at two characters it can never pass `usernameSchema`, so it cannot
  // be taken and needs no entry.)
  "profile",
  "projects",
  "technologies",
  "testimonials",
  "visibility",
  "restore",

  // Top-level routes and route namespaces (`src/app`).
  "admin",
  "api",
  "portfolio",
  "competitions",
  "legal",
  "internal",
  "user",
  "mdxeditor",

  // Files served from the site root, which contain a dot and so do pass
  // `usernameSchema`.
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
]);

/** Case-insensitive: usernames are stored lowercase, but validated as typed. */
export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}
