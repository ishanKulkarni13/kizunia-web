// prisma/seed/data/projects.ts
// Sample projects submitted to competitions, with varied statuses and categories.

import type {
  ProjectVisibility,
  ProjectStatus,
  ProjectRole,
} from "../../../src/generated/prisma";

interface ProjectSeed {
  title: string;
  slug: string;
  shortDescription: string;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  createdByIndex: number;
  categorySlugs: string[];
  technologySlugs: string[];
  members: { userIndex: number; role: ProjectRole }[];
  // Competition slugs this project was submitted to
  competitionSlugs: string[];
}

export const projects: ProjectSeed[] = [
  {
    title: "MediScan AI",
    slug: "mediscan-ai",
    shortDescription: "AI-powered medical image analysis tool for early disease detection.",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    createdByIndex: 7, // James (data scientist)
    categorySlugs: ["healthtech", "ai", "ml"],
    technologySlugs: ["python", "pytorch", "fastapi", "react", "docker"],
    members: [
      { userIndex: 7, role: "OWNER" },
      { userIndex: 1, role: "CONTRIBUTOR" },
    ],
    competitionSlugs: ["medhack-healthcare-2026"],
  },
  {
    title: "DeFi Swap Protocol",
    slug: "defi-swap-protocol",
    shortDescription: "Decentralized token swap protocol with minimal slippage on Solana.",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    createdByIndex: 2, // Sara (blockchain)
    categorySlugs: ["web3", "fintech"],
    technologySlugs: ["solana", "rust", "react", "nodejs"],
    members: [
      { userIndex: 2, role: "OWNER" },
      { userIndex: 4, role: "CONTRIBUTOR" },
    ],
    competitionSlugs: ["solana-summer-2025", "defi-builders-summit-2026"],
  },
  {
    title: "EcoTracker",
    slug: "ecotracker",
    shortDescription: "Track your carbon footprint with IoT sensors and a beautiful dashboard.",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    createdByIndex: 3, // Rahul
    categorySlugs: ["sustainability", "iot", "mobile-dev"],
    technologySlugs: ["flutter", "firebase", "arduino", "python"],
    members: [
      { userIndex: 3, role: "OWNER" },
      { userIndex: 6, role: "MAINTAINER" },
    ],
    competitionSlugs: ["google-solution-challenge-2026"],
  },
  {
    title: "DevFlow",
    slug: "devflow",
    shortDescription: "AI-powered developer productivity tool with smart code suggestions.",
    visibility: "PUBLIC",
    status: "DRAFT",
    createdByIndex: 1, // Arjun
    categorySlugs: ["dev-tools", "ai", "genai-llms"],
    technologySlugs: ["python", "langchain", "openai-api", "react", "nextjs"],
    members: [
      { userIndex: 1, role: "OWNER" },
    ],
    competitionSlugs: ["mlh-ghw-ai-2026"],
  },
  {
    title: "CloudGuard",
    slug: "cloudguard",
    shortDescription: "Automated cloud security scanner with real-time threat detection.",
    visibility: "UNLISTED",
    status: "PUBLISHED",
    createdByIndex: 4, // Emily
    categorySlugs: ["cybersecurity", "cloud-devops"],
    technologySlugs: ["python", "aws", "terraform", "docker", "kubernetes"],
    members: [
      { userIndex: 4, role: "OWNER" },
      { userIndex: 5, role: "CONTRIBUTOR" },
    ],
    competitionSlugs: ["aws-gameday-2026"],
  },
  {
    title: "LearnLoop",
    slug: "learnloop",
    shortDescription: "Gamified learning platform for kids to learn programming through puzzles.",
    visibility: "PUBLIC",
    status: "PUBLISHED",
    createdByIndex: 6, // Aisha
    categorySlugs: ["edtech", "design-ux", "web-dev"],
    technologySlugs: ["react", "nextjs", "tailwindcss", "figma", "supabase"],
    members: [
      { userIndex: 6, role: "OWNER" },
      { userIndex: 3, role: "CONTRIBUTOR" },
    ],
    competitionSlugs: ["first-hack-beginners"],
  },
];
