/**
 * Standing regression suite for the public Project discovery listing
 * (`src/lib/search` + `projectSearchDefinition`), mirroring
 * `verify-search-invariants.ts` (the Competition equivalent) but focused on
 * the property that actually matters for this module: an UNLISTED or
 * PRIVATE project, or a DRAFT one, must never reach `/projects` — not
 * through the base listing, not through search, not through a filter, not
 * through sorting, not through pagination, and not through the reported
 * count.
 *
 * There is no test runner in this repository yet, so this is a standalone
 * script. Run with:
 *
 *   pnpm exec tsx scripts/verify-project-search.ts
 *
 * It seeds real rows (a Category, a Technology, four Projects spanning
 * every visibility/status combination that matters) and always cleans them
 * up in a `finally`, so a failed run does not leave fixture data behind.
 */

import {
  PrismaClient,
  ProjectStatus,
  ProjectVisibility,
} from "../src/generated/prisma";
import { buildSearchQuery, parsePagination } from "../src/lib/search";
import {
  PROJECT_FILTER_SPECS,
  PROJECT_SORT_OPTIONS,
} from "../src/modules/projects/search/ui";
import { projectSearchDefinition } from "../src/modules/projects/search/definition";

const prisma = new PrismaClient();

let failures = 0;
let checks = 0;

function report(label: string, ok: boolean, detail?: string): void {
  checks += 1;

  if (ok) {
    console.log(`  ok   ${label}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

const FIXTURE_PREFIX = "__verify_project_search__";
const SHARED_TITLE = `${FIXTURE_PREFIX} shared title`;

interface Fixture {
  categorySlug: string;
  technologySlug: string;
  visibleProjectId: string;
  hiddenProjectIds: string[];
}

async function seed(): Promise<Fixture> {
  const category = await prisma.category.create({
    data: {
      name: `${FIXTURE_PREFIX} category`,
      slug: `${FIXTURE_PREFIX}-category`,
    },
  });

  const technology = await prisma.technology.create({
    data: {
      name: `${FIXTURE_PREFIX} technology`,
      slug: `${FIXTURE_PREFIX}-technology`,
      type: "OTHER",
    },
  });

  // Every combination of visibility × status that could plausibly leak.
  // Only the first is expected to ever appear in a public search result.
  const combos: { visibility: ProjectVisibility; status: ProjectStatus }[] = [
    { visibility: "PUBLIC", status: "PUBLISHED" }, // the one visible row
    { visibility: "PUBLIC", status: "DRAFT" }, // public but not yet published
    { visibility: "UNLISTED", status: "PUBLISHED" },
    { visibility: "PRIVATE", status: "PUBLISHED" },
    { visibility: "UNLISTED", status: "DRAFT" },
    { visibility: "PRIVATE", status: "DRAFT" },
  ];

  const created = await Promise.all(
    combos.map((combo, index) =>
      prisma.project.create({
        data: {
          title: SHARED_TITLE,
          slug: `${FIXTURE_PREFIX}-${index}`,
          shortDescription: `${FIXTURE_PREFIX} description`,
          visibility: combo.visibility,
          status: combo.status,
          categories: {
            create: [{ categoryId: category.id }],
          },
          technologies: {
            create: [{ technologyId: technology.id }],
          },
        },
      }),
    ),
  );

  return {
    categorySlug: category.slug,
    technologySlug: technology.slug,
    visibleProjectId: created[0].id,
    hiddenProjectIds: created.slice(1).map((p) => p.id),
  };
}

async function cleanup(): Promise<void> {
  await prisma.project.deleteMany({
    where: { slug: { startsWith: `${FIXTURE_PREFIX}-` } },
  });

  await prisma.category.deleteMany({
    where: { slug: `${FIXTURE_PREFIX}-category` },
  });

  await prisma.technology.deleteMany({
    where: { slug: `${FIXTURE_PREFIX}-technology` },
  });
}

/**
 * Runs one public-scope query against the real database and returns the
 * ids of every row it matched, alongside the count the same `where` would
 * report — the same pair `ProjectService.search` computes, built from one
 * query object exactly as that method does.
 */
async function runPublicQuery(
  params: Record<string, string>,
): Promise<{ ids: string[]; total: number }> {
  const query = buildSearchQuery({
    definition: projectSearchDefinition,
    params,
    scope: "public",
    context: {},
  });

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where: query.where,
      orderBy: query.orderBy,
      skip: query.skip,
      take: query.take,
      select: { id: true },
    }),
    prisma.project.count({ where: query.where }),
  ]);

  return { ids: rows.map((r) => r.id), total };
}

async function verifyVisibilityIsNeverLeaked(fixture: Fixture): Promise<void> {
  console.log("\n== Invariant: only PUBLIC + PUBLISHED rows ever appear ==");

  const cases: { label: string; params: Record<string, string> }[] = [
    { label: "bare listing", params: {} },
    { label: "search matching the shared title", params: { search: SHARED_TITLE } },
    { label: "category filter matching every fixture row", params: { categories: fixture.categorySlug } },
    { label: "technology filter matching every fixture row", params: { technologies: fixture.technologySlug } },
    {
      label: "search + category + technology combined",
      params: {
        search: SHARED_TITLE,
        categories: fixture.categorySlug,
        technologies: fixture.technologySlug,
      },
    },
  ];

  for (const sortOption of PROJECT_SORT_OPTIONS) {
    cases.push({
      label: `sort=${sortOption.key}`,
      params: { search: SHARED_TITLE, sort: sortOption.key },
    });
  }

  for (const { label, params } of cases) {
    const { ids, total } = await runPublicQuery(params);

    const fixtureIdsReturned = ids.filter((id) =>
      [fixture.visibleProjectId, ...fixture.hiddenProjectIds].includes(id),
    );

    report(
      `${label}: only the PUBLIC+PUBLISHED fixture row is returned`,
      fixtureIdsReturned.length === 1 &&
        fixtureIdsReturned[0] === fixture.visibleProjectId,
      `returned fixture ids: ${JSON.stringify(fixtureIdsReturned)}`,
    );

    // The two rows sharing every filterable attribute with the visible one
    // (PUBLIC+DRAFT, UNLISTED+PUBLISHED, PRIVATE+PUBLISHED, ...) must never
    // inflate the count either — a total of 6 here would mean the count
    // query and the row query disagree about what the guard allows.
    if (params.search || params.categories || params.technologies) {
      report(
        `${label}: total matches exactly the visible fixture row (not the other 5)`,
        total === 1,
        `total was ${total}`,
      );
    }
  }
}

/** Values that must not exist as filter keys, because they are scope-only. */
function verifyGuardedKeysAreNotFilters(): void {
  console.log("\n== Invariant: visibility/status are scope-only, never filters ==");

  const filterKeys = new Set(
    projectSearchDefinition.filters.map((f) => f.key),
  );

  report('"visibility" is not a registered filter key', !filterKeys.has("visibility"));
  report('"status" is not a registered filter key', !filterKeys.has("status"));
  report('"statuses" is not a registered filter key', !filterKeys.has("statuses"));

  // A caller crafting a request with these names must find they are simply
  // ignored, never partially honoured.
  const specKeys = new Set(PROJECT_FILTER_SPECS.map((s) => s.key));
  report('"visibility" is not in the public filter spec list either', !specKeys.has("visibility"));
  report('"status" is not in the public filter spec list either', !specKeys.has("status"));
}

async function verifyCraftedRequestsCannotWiden(fixture: Fixture): Promise<void> {
  console.log("\n== Invariant: a hand-crafted request cannot widen the guard ==");

  const attempts: Record<string, string>[] = [
    { visibility: "UNLISTED" },
    { visibility: "PRIVATE" },
    { status: "DRAFT" },
    { statuses: "DRAFT" },
    { search: SHARED_TITLE, visibility: "PRIVATE" },
    { search: SHARED_TITLE, status: "DRAFT" },
  ];

  for (const params of attempts) {
    const { ids } = await runPublicQuery({ search: SHARED_TITLE, ...params });

    const leaked = ids.some((id) => fixture.hiddenProjectIds.includes(id));

    report(
      `?${new URLSearchParams(params).toString()} does not leak a hidden row`,
      !leaked,
    );
  }
}

function verifyUnknownScopeThrows(): void {
  console.log("\n== Invariant: an unknown scope id throws ==");

  let threw = false;

  try {
    buildSearchQuery({
      definition: projectSearchDefinition,
      params: {},
      scope: "does-not-exist",
      context: {},
    });
  } catch {
    threw = true;
  }

  report("unknown scope id throws rather than falling back", threw);
}

function verifySortDeterminism(): void {
  console.log("\n== Invariant: every resolved sort ends in the tiebreaker ==");

  for (const option of PROJECT_SORT_OPTIONS) {
    const query = buildSearchQuery({
      definition: projectSearchDefinition,
      params: { sort: option.key },
      scope: "public",
      context: {},
    });

    const last = query.orderBy[query.orderBy.length - 1];

    report(
      `sort=${option.key} ends in the { id: "asc" } tiebreaker`,
      JSON.stringify(last) === JSON.stringify({ id: "asc" }),
      `orderBy was ${JSON.stringify(query.orderBy)}`,
    );
  }

  const unknownQuery = buildSearchQuery({
    definition: projectSearchDefinition,
    params: { sort: "not-a-real-sort" },
    scope: "public",
    context: {},
  });

  report(
    "an unknown sort token degrades to the default rather than throwing",
    unknownQuery.orderBy.length > 0,
  );
}

function verifyPaginationClamps(): void {
  console.log("\n== Invariant: page/limit clamp rather than error ==");

  const pagination = parsePagination({ page: "-5", limit: "99999" });

  report("a negative page clamps to 1", pagination.page === 1);
  report(
    "an absurd limit clamps to the configured maximum",
    pagination.limit <= 100,
  );
}

async function main(): Promise<void> {
  const fixture = await seed();

  try {
    verifyGuardedKeysAreNotFilters();
    verifyUnknownScopeThrows();
    verifySortDeterminism();
    verifyPaginationClamps();
    await verifyVisibilityIsNeverLeaked(fixture);
    await verifyCraftedRequestsCannotWiden(fixture);
  } finally {
    await cleanup();
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);

  await prisma.$disconnect();

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
