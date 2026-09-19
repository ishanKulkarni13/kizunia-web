// prisma/seed/seeders/suggestions.seeder.ts
// Seeds a handful of CompetitionSuggestion records to test the suggestion workflow.
import { PrismaClient } from "../../../src/generated/prisma";

interface Maps {
  catMap: Record<string, string>;
  techMap: Record<string, string>;
  userIdList: string[];
  competitionMap: Record<string, string>;
}

export async function seedSuggestions(
  prisma: PrismaClient,
  { catMap, techMap, userIdList, competitionMap }: Maps
) {
  console.log("  💡 Seeding competition suggestions...");
console.log("  Suggestions seeding is currently disabled. Uncomment the code in prisma/seed/seeders/suggestions.seeder.ts to enable it.");
  // const suggestions = [
  //   // 1. New competition suggestion — DRAFT
  //   {
  //     submittedByIndex: 3, // Rahul
  //     reviewedByIndex: null,
  //     competitionSlug: null, // new competition
  //     status: "DRAFT" as const,
  //     title: "Flutter India Summit Hack",
  //     shortDescription: "A 24-hour Flutter-only competition for Indian developers.",
  //     organizer: "Flutter India",
  //     mode: "HYBRID" as const,
  //     location: "Pune, India",
  //     startDate: new Date("2026-12-20T09:00:00Z"),
  //     endDate: new Date("2026-12-21T18:00:00Z"),
  //     registrationDeadline: new Date("2026-12-10T23:59:00Z"),
  //     prizePool: "₹2,00,000",
  //     minTeamSize: 1,
  //     maxTeamSize: 3,
  //     categorySlugs: ["mobile-dev", "open-source"],
  //     technologySlugs: ["flutter", "firebase", "dart"],
  //   },
  //   // 2. Edit suggestion on existing competition — UNDER_REVIEW
  //   {
  //     submittedByIndex: 1, // Arjun
  //     reviewedByIndex: null,
  //     competitionSlug: "sih-2026",
  //     status: "UNDER_REVIEW" as const,
  //     title: null,
  //     shortDescription: "Updated description to clarify AI/ML tracks.",
  //     organizer: null,
  //     mode: null,
  //     location: null,
  //     startDate: null,
  //     endDate: null,
  //     registrationDeadline: null,
  //     prizePool: null,
  //     minTeamSize: null,
  //     maxTeamSize: null,
  //     categorySlugs: ["ai", "ml"],
  //     technologySlugs: ["python", "tensorflow", "pytorch"],
  //   },
  //   // 3. New competition suggestion — APPROVED
  //   {
  //     submittedByIndex: 5, // Karthik
  //     reviewedByIndex: 0, // Priya (admin)
  //     competitionSlug: null,
  //     status: "APPROVED" as const,
  //     title: "Null Byte CTF 2026",
  //     shortDescription: "Beginner-friendly CTF for students new to cybersecurity.",
  //     organizer: "NIT Trichy ACM",
  //     mode: "ONLINE" as const,
  //     location: null,
  //     startDate: new Date("2026-11-20T09:00:00Z"),
  //     endDate: new Date("2026-11-21T21:00:00Z"),
  //     registrationDeadline: new Date("2026-11-15T23:59:00Z"),
  //     prizePool: "₹50,000",
  //     minTeamSize: 1,
  //     maxTeamSize: 3,
  //     categorySlugs: ["cybersecurity"],
  //     technologySlugs: ["python", "docker"],
  //   },
  //   // 4. Rejected suggestion
  //   {
  //     submittedByIndex: 6, // Aisha
  //     reviewedByIndex: 0, // Priya
  //     competitionSlug: null,
  //     status: "REJECTED" as const,
  //     title: "Design Only Competition",
  //     shortDescription: "Pure design challenge — no code.",
  //     organizer: "DesignCo",
  //     mode: "ONLINE" as const,
  //     location: null,
  //     startDate: new Date("2026-10-10T00:00:00Z"),
  //     endDate: new Date("2026-10-12T23:59:00Z"),
  //     registrationDeadline: new Date("2026-10-08T23:59:00Z"),
  //     prizePool: "$1,000",
  //     minTeamSize: 1,
  //     maxTeamSize: 2,
  //     categorySlugs: ["design-ux"],
  //     technologySlugs: ["figma"],
  //   },
  //   // 5. Changes requested
  //   {
  //     submittedByIndex: 2, // Sara
  //     reviewedByIndex: 0,
  //     competitionSlug: "ethglobal-new-delhi-2026",
  //     status: "CHANGES_REQUESTED" as const,
  //     title: null,
  //     shortDescription: "Add Solana and Polkadot to prize tracks.",
  //     organizer: null,
  //     mode: null,
  //     location: null,
  //     startDate: null,
  //     endDate: null,
  //     registrationDeadline: null,
  //     prizePool: "$200,000",
  //     minTeamSize: null,
  //     maxTeamSize: null,
  //     categorySlugs: ["web3"],
  //     technologySlugs: ["solana", "solidity", "rust"],
  //   },
  // ];

  // for (const s of suggestions) {
  //   const submittedById = userIdList[s.submittedByIndex];
  //   const reviewedById = s.reviewedByIndex !== null ? userIdList[s.reviewedByIndex] : null;
  //   const competitionId = s.competitionSlug ? competitionMap[s.competitionSlug] : null;

  //   const suggestion = await prisma.competitionSuggestion.create({
  //     data: {
  //       status: s.status,
  //       submittedById,
  //       reviewedById,
  //       competitionId,
  //       submittedAt: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(s.status)
  //         ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 3)
  //         : null,
  //       reviewedAt: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(s.status)
  //         ? new Date(Date.now() - 1000 * 60 * 60 * 24)
  //         : null,
  //       reviewNotes: s.status === "REJECTED"
  //         ? "Does not meet the minimum requirements for a competition listing."
  //         : s.status === "CHANGES_REQUESTED"
  //         ? "Please verify prize breakdown and add official registration link."
  //         : null,
  //       title: s.title,
  //       shortDescription: s.shortDescription,
  //       organizer: s.organizer,
  //       mode: s.mode,
  //       location: s.location,
  //       startDate: s.startDate,
  //       endDate: s.endDate,
  //       registrationDeadline: s.registrationDeadline,
  //       prizePool: s.prizePool,
  //       minTeamSize: s.minTeamSize,
  //       maxTeamSize: s.maxTeamSize,
  //     },
  //   });

  //   // Categories
  //   for (const slug of s.categorySlugs) {
  //     const catId = catMap[slug];
  //     if (!catId) continue;
  //     await prisma.competitionSuggestionCategory
  //       .create({ data: { suggestionId: suggestion.id, categoryId: catId } })
  //       .catch(() => {});
  //   }

  //   // Technologies
  //   for (const slug of s.technologySlugs) {
  //     const techId = techMap[slug];
  //     if (!techId) continue;
  //     await prisma.competitionSuggestionTechnology
  //       .create({ data: { suggestionId: suggestion.id, technologyId: techId } })
  //       .catch(() => {});
  //   }

  //   console.log(`     ✓ Suggestion: "${s.title ?? "(edit)"}" [${s.status}]`);
  // }
}
